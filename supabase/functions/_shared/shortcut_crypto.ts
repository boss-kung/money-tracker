const encoder = new TextEncoder()

export type DeviceToken = { token: string; tokenId: string; secret: string; secretPrefix: string }
export type InboxKeyring = { currentVersion: number; keys: Map<number, CryptoKey> }
export type EncryptionContext = { captureId: string; userId: string; schemaVersion: string }
export type JsonEncryptionContext = {
  objectId: string
  userId: string
  objectType: 'capture' | 'profile_rule'
  objectVersion: string
}
export type EncryptedCapture = { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number }

function randomBytes(length: number) { return crypto.getRandomValues(new Uint8Array(length)) }

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function aad(context: EncryptionContext, keyVersion: number): Uint8Array {
  return encoder.encode(`${context.captureId}|${context.userId}|${context.schemaVersion}|${keyVersion}`)
}

function jsonAad(context: JsonEncryptionContext, keyVersion: number): Uint8Array {
  if (context.objectType === 'capture') return aad({ captureId: context.objectId, userId: context.userId, schemaVersion: context.objectVersion }, keyVersion)
  return encoder.encode(`profile_rule|${context.objectId}|${context.userId}|${context.objectVersion}|${keyVersion}`)
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function generateDeviceToken(): DeviceToken {
  const tokenId = crypto.randomUUID()
  const secret = bytesToBase64Url(randomBytes(32))
  return { token: `mtst_v1.${tokenId}.${secret}`, tokenId, secret, secretPrefix: secret.slice(0, 8) }
}

export function parseDeviceToken(token: string): { tokenId: string; secret: string } {
  const match = /^mtst_v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(String(token || '').trim())
  if (!match) throw new Error('invalid_token')
  return { tokenId: match[1], secret: match[2] }
}

export async function tokenVerifier(secret: string, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(secret)))
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function loadInboxKeyring(getEnv: (name: string) => string | undefined): Promise<InboxKeyring> {
  const keys = new Map<number, CryptoKey>()
  for (let version = 1; version <= 32; version++) {
    const encoded = getEnv(`MT_SHORTCUT_INBOX_KEY_V${version}`)
    if (!encoded) continue
    const bytes = base64UrlToBytes(encoded.trim())
    if (bytes.byteLength !== 32) throw new Error(`invalid_inbox_key_v${version}`)
    keys.set(version, await crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']))
  }
  if (!keys.size) throw new Error('inbox_key_missing')
  return { currentVersion: Math.max(...keys.keys()), keys }
}

export async function encryptShortcutJson(payload: unknown, context: JsonEncryptionContext, keyring: InboxKeyring): Promise<EncryptedCapture> {
  const keyVersion = keyring.currentVersion
  const key = keyring.keys.get(keyVersion)
  if (!key) throw new Error('inbox_key_missing')
  const iv = randomBytes(12)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(jsonAad(context, keyVersion)), tagLength: 128 },
    key,
    buffer(encoder.encode(JSON.stringify(payload))),
  ))
  return { ciphertext, iv, keyVersion }
}

export async function decryptShortcutJson(record: EncryptedCapture, context: JsonEncryptionContext, keyring: InboxKeyring): Promise<any> {
  const key = keyring.keys.get(record.keyVersion)
  if (!key) throw new Error('inbox_key_missing')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buffer(record.iv), additionalData: buffer(jsonAad(context, record.keyVersion)), tagLength: 128 },
    key,
    buffer(record.ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext))
}

export async function encryptCapture(payload: unknown, context: EncryptionContext, keyring: InboxKeyring): Promise<EncryptedCapture> {
  return encryptShortcutJson(payload, { objectId: context.captureId, userId: context.userId, objectType: 'capture', objectVersion: context.schemaVersion }, keyring)
}

export async function decryptCapture(record: EncryptedCapture, context: EncryptionContext, keyring: InboxKeyring): Promise<any> {
  return decryptShortcutJson(record, { objectId: context.captureId, userId: context.userId, objectType: 'capture', objectVersion: context.schemaVersion }, keyring)
}
