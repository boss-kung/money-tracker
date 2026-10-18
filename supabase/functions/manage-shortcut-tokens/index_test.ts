import { createManageShortcutTokensHandler } from './index.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  }
}

function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function request(method: string, path = '/manage-shortcut-tokens', body?: unknown) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function tokenFixture(id = '11111111-1111-4111-8111-111111111111') {
  return {
    token: `mtst_v1.${id}.${'s'.repeat(43)}`,
    tokenId: id,
    secret: 's'.repeat(43),
    secretPrefix: 'ssssssss',
  }
}

function database(options: {
  rows?: Record<string, unknown>[]
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  revoke?: { data: unknown; error: unknown }
}) {
  const calls: { method: string; args?: unknown }[] = []
  const rows = options.rows ?? []
  const client = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc:${name}`, args })
      return options.rpc ? options.rpc(name, args) : { data: args.p_token_id, error: null }
    },
    from(table: string) {
      equal(table, 'mt_shortcut_tokens', 'table')
      const query: Record<string, any> = {}
      query.select = (...args: unknown[]) => { calls.push({ method: 'select', args }); return query }
      query.eq = (...args: unknown[]) => { calls.push({ method: 'eq', args }); return query }
      query.is = (...args: unknown[]) => { calls.push({ method: 'is', args }); return query }
      query.order = (...args: unknown[]) => { calls.push({ method: 'order', args }); return query }
      query.update = (...args: unknown[]) => { calls.push({ method: 'update', args }); return query }
      query.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null })
      query.maybeSingle = async () => {
        calls.push({ method: 'maybeSingle' })
        return options.revoke ?? { data: null, error: null }
      }
      return query
    },
  }
  return client
}

function deps(options: {
  user?: string
  admin?: ReturnType<typeof database>
  token?: ReturnType<typeof tokenFixture>
  pepper?: string
}) {
  const pepper = options.pepper ?? 'pepper'.repeat(4)
  let adminCalls = 0
  return {
    adminCalls: () => adminCalls,
    deps: {
      requireUser: async () => {
        if (!options.user) throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' })
        return options.user
      },
      createAdminClient: () => {
        adminCalls++
        if (!options.admin) throw new Error('admin should not be called')
        return options.admin
      },
      generateToken: () => options.token ?? tokenFixture(),
      makeVerifier: async (secret: string, pepper: string) => new TextEncoder().encode(`${secret}:${pepper}`),
      getEnv: (name: string) => name === 'MT_SHORTCUT_TOKEN_PEPPER_V1' ? pepper : undefined,
      now: () => new Date('2026-10-18T00:00:00Z'),
    },
  }
}

Deno.test('auth is required before admin access and list never exposes verifiers', async () => {
  const noAuth = deps({ admin: database({}) })
  const unauthenticated = createManageShortcutTokensHandler(noAuth.deps)
  const denied = await unauthenticated(request('GET'))
  equal(denied.status, 401)
  equal(noAuth.adminCalls(), 0)

  const db = database({ rows: [{ id: 'token-1', user_id: 'user-1', label: 'iPhone', secret_verifier: 'private', secret_prefix: 'abc', created_at: 'now' }] })
  const authenticated = createManageShortcutTokensHandler(deps({ user: 'user-1', admin: db }).deps)
  const response = await authenticated(request('GET'))
  equal(response.status, 200)
  const body = await json(response)
  equal(body.tokens, [{ id: 'token-1', label: 'iPhone', secret_prefix: 'abc', created_at: 'now', last_used_at: undefined, revoked_at: undefined }])
  if (JSON.stringify(body).includes('secret_verifier')) throw new Error('verifier leaked')
})

Deno.test('create trims a safe label and returns the plaintext token once', async () => {
  const db = database({})
  const token = tokenFixture()
  const setup = deps({ user: 'user-1', admin: db, token })
  const handler = createManageShortcutTokensHandler(setup.deps)
  const response = await handler(request('POST', '/manage-shortcut-tokens', { label: '  My iPhone  ' }))
  equal(response.status, 201)
  equal(await json(response), { id: token.tokenId, label: 'My iPhone', token: token.token })
  equal(db.calls.find(call => call.method === 'rpc:mt_shortcut_create_token')?.args, {
    p_user_id: 'user-1', p_token_id: token.tokenId, p_label: 'My iPhone', p_secret_verifier: new TextEncoder().encode(`${token.secret}:${'pepper'.repeat(4)}`), p_secret_prefix: 'ssssssss',
  })
})

Deno.test('invalid labels and active-token limit have stable client errors', async () => {
  const invalid = deps({ user: 'user-1', admin: database({}) })
  const handler = createManageShortcutTokensHandler(invalid.deps)
  for (const label of ['', '   ', 'x'.repeat(65), '💳'.repeat(65)]) {
    const response = await handler(request('POST', '/manage-shortcut-tokens', { label }))
    equal(response.status, 400)
  }

  const limitedDb = database({ rpc: async () => ({ data: null, error: { message: 'active_token_limit', code: 'P0001' } }) })
  const limited = createManageShortcutTokensHandler(deps({ user: 'user-1', admin: limitedDb }).deps)
  const response = await limited(request('POST', '/manage-shortcut-tokens', { label: 'sixth' }))
  equal(response.status, 409)
  equal(await json(response), { error: 'active_token_limit', code: 'active_token_limit' })
})

Deno.test('revoke is owner-scoped and idempotent', async () => {
  const db = database({ revoke: { data: null, error: null } })
  const handler = createManageShortcutTokensHandler(deps({ user: 'user-1', admin: db }).deps)
  const response = await handler(request('POST', '/manage-shortcut-tokens/33333333-3333-4333-8333-333333333333/revoke'))
  equal(response.status, 200)
  equal(await json(response), { ok: true })
  if (!db.calls.some(call => call.method === 'eq' && JSON.stringify(call.args) === JSON.stringify(['user_id', 'user-1']))) {
    throw new Error('revoke must scope by authenticated owner')
  }
  equal((await handler(request('POST', '/manage-shortcut-tokens/not-a-uuid/revoke'))).status, 400)
})

