import {
  decryptCapture,
  encryptCapture,
  generateDeviceToken,
  loadInboxKeyring,
  parseDeviceToken,
  timingSafeEqual,
  tokenVerifier,
} from './shortcut_crypto.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (actual !== expected) throw new Error(`${message} ${String(actual)} !== ${String(expected)}`)
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64Key(bytes: Uint8Array) { return bytesToBase64Url(bytes) }

Deno.test('generates and parses a high-entropy device token', () => {
  const first = generateDeviceToken()
  const second = generateDeviceToken()
  if (first.token === second.token) throw new Error('device tokens must be random')
  if (!/^mtst_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(first.token)) throw new Error('unexpected token format')
  const parsed = parseDeviceToken(first.token)
  equal(parsed.tokenId, first.tokenId)
  equal(parsed.secret, first.secret)
  equal(first.secret.length, 43)
})

Deno.test('uses fixed-length comparison for token verifiers', async () => {
  const left = await tokenVerifier('secret-a', 'pepper')
  const same = await tokenVerifier('secret-a', 'pepper')
  const different = await tokenVerifier('secret-b', 'pepper')
  if (!timingSafeEqual(left, same)) throw new Error('equal verifiers must compare equal')
  if (timingSafeEqual(left, different)) throw new Error('different verifiers must compare different')
  if (timingSafeEqual(left, new Uint8Array(left.length - 1))) throw new Error('different lengths must compare different')
})

Deno.test('encrypts with fresh IVs and rejects wrong AAD', async () => {
  const keyV1 = crypto.getRandomValues(new Uint8Array(32))
  const keyring = await loadInboxKeyring((name: string) => name === 'MT_SHORTCUT_INBOX_KEY_V1' ? base64Key(keyV1) : undefined)
  const payload = { raw_text: 'secret bank text', amount: '80.00' }
  const context = { captureId: 'capture-1', userId: 'user-1', schemaVersion: 'money-tracker.capture.v1' }
  const first = await encryptCapture(payload, context, keyring)
  const second = await encryptCapture(payload, context, keyring)
  if (bytesToBase64Url(first.iv) === bytesToBase64Url(second.iv)) throw new Error('IV must be fresh')
  if (new TextDecoder().decode(first.ciphertext).includes('secret bank text')) throw new Error('plaintext leaked')
  equal((await decryptCapture(first, context, keyring)).raw_text, 'secret bank text')
  await (async () => {
    try {
      await decryptCapture(first, { ...context, userId: 'other-user' }, keyring)
    } catch (_) { return }
    throw new Error('wrong AAD must fail')
  })()
})

Deno.test('selects the highest configured key version for new writes', async () => {
  const keyV1 = crypto.getRandomValues(new Uint8Array(32))
  const keyV2 = crypto.getRandomValues(new Uint8Array(32))
  const keyring = await loadInboxKeyring((name: string) => ({
    MT_SHORTCUT_INBOX_KEY_V1: base64Key(keyV1),
    MT_SHORTCUT_INBOX_KEY_V2: base64Key(keyV2),
  } as Record<string, string | undefined>)[name])
  const encrypted = await encryptCapture({ value: 2 }, { captureId: 'capture-2', userId: 'user-2', schemaVersion: 'money-tracker.capture.v1' }, keyring)
  equal(encrypted.keyVersion, 2)
  equal((await decryptCapture(encrypted, { captureId: 'capture-2', userId: 'user-2', schemaVersion: 'money-tracker.capture.v1' }, keyring)).value, 2)
})
