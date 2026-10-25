import { createShortcutParserProfilesHandler } from './index.ts'

function equal(actual: unknown, expected: unknown, message = '') { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`) }
function json(response: Response) { return response.json() as Promise<Record<string, unknown>> }
function request(method: string, path = '/shortcut-parser-profiles', body?: unknown) { return new Request(`https://example.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) }
const rule = { format_version: 1, variants: [{ id: 'purchase', direction: 'debit', mustContain: ['uchoose'], mustNotContain: [], amount: { before: 'amount ', occurrence: 1, valueType: 'thb_amount', maxLength: 32 } }] }

function database(row?: Record<string, unknown>) {
  const calls: string[] = []
  const client = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) { calls.push(`rpc:${name}`); return { data: name.includes('create') ? args.p_profile_id : Number(args.p_expected_version || 1) + 1, error: null } },
    from() {
      const query: Record<string, any> = {}
      query.select = () => query; query.eq = () => query; query.order = () => query
      query.maybeSingle = async () => ({ data: row || null, error: null })
      query.then = (resolve: (value: unknown) => unknown) => resolve({ data: row ? [row] : [], error: null })
      return query
    },
  }
  return client
}

function setup(options: { user?: string; row?: Record<string, unknown> } = {}) {
  const db = database(options.row)
  let adminCalls = 0; let encryptCalls = 0
  const deps = {
    requireUser: async () => { if (!options.user) throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' }); return options.user },
    createAdminClient: () => { adminCalls++; return db },
    loadKeyring: async () => ({ currentVersion: 1, keys: new Map() }),
    encrypt: async () => { encryptCalls++; return { ciphertext: new Uint8Array([1, 2]), iv: new Uint8Array(12), keyVersion: 1 } },
    decrypt: async () => rule,
    uuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    randomBytes: () => new Uint8Array([1, 2, 3, 4, 5, 6]),
    now: () => new Date('2026-10-25T00:00:00Z'),
  }
  return { db, deps, adminCalls: () => adminCalls, encryptCalls: () => encryptCalls }
}

Deno.test('profile endpoint authenticates before admin client and lists safe metadata', async () => {
  const denied = setup(); const handler = createShortcutParserProfilesHandler(denied.deps)
  equal((await handler(request('GET'))).status, 401); equal(denied.adminCalls(), 0)
  const row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', short_code: 'ABC234', name: 'UChoose', app_label: 'UCHOOSE', enabled: true, disabled_at: null, format_version: 1, profile_version: 1, rule_ciphertext: '\\xdeadbeef', rule_iv: '\\x000000000000000000000000', rule_encryption_key_version: 1, created_at: 'now', updated_at: 'now' }
  const listed = setup({ user: 'user-1', row }); const response = await createShortcutParserProfilesHandler(listed.deps)(request('GET'))
  equal(response.status, 200); const body = await json(response); equal(body.profiles, [{ id: row.id, short_code: row.short_code, name: row.name, app_label: row.app_label, enabled: row.enabled, disabled_at: row.disabled_at, format_version: row.format_version, profile_version: row.profile_version, created_at: row.created_at, updated_at: row.updated_at }])
  if (JSON.stringify(body).includes('ciphertext')) throw new Error('ciphertext leaked')
})

Deno.test('create rejects sample payloads before encryption or database mutation', async () => {
  const setupState = setup({ user: 'user-1' }); const handler = createShortcutParserProfilesHandler(setupState.deps)
  const response = await handler(request('POST', undefined, { name: 'UChoose', samples: ['secret'], compiled_rule: rule }))
  equal(response.status, 400); equal(setupState.encryptCalls(), 0); equal(setupState.db.calls, [])
})

Deno.test('create validates and stores only encrypted compiled rules', async () => {
  const setupState = setup({ user: 'user-1' }); const handler = createShortcutParserProfilesHandler(setupState.deps)
  const response = await handler(request('POST', undefined, { name: 'UChoose', app_label: 'UCHOOSE', enabled: true, compiled_rule: rule }))
  equal(response.status, 201); equal(setupState.encryptCalls(), 1); equal(setupState.db.calls, ['rpc:mt_shortcut_create_profile'])
  const body = await json(response); if (!JSON.stringify(body).includes('compiled_rule')) throw new Error('created profile should return the rule to owner')
})
