;(function (root) {
  'use strict'

  const DEFAULT_KDF_PARAMS = Object.freeze({
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 310000,
  })

  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()

  function subtle() {
    const api = root.crypto?.subtle
    if (!api) throw new Error('Web Crypto is required for secure cloud sync')
    return api
  }

  function cryptoObj() {
    if (!root.crypto?.getRandomValues) throw new Error('Secure random generator is unavailable')
    return root.crypto
  }

  function bytesToBase64(bytes) {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    if (typeof Buffer !== 'undefined') return Buffer.from(array).toString('base64')
    let binary = ''
    array.forEach(byte => { binary += String.fromCharCode(byte) })
    return btoa(binary)
  }

  function base64ToBytes(value) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(value || ''), 'base64'))
    const binary = atob(String(value || ''))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }

  function randomBytes(length = 32) {
    const bytes = new Uint8Array(length)
    cryptoObj().getRandomValues(bytes)
    return bytes
  }

  function normalizeKdfParams(params = {}) {
    return {
      ...DEFAULT_KDF_PARAMS,
      ...params,
      iterations: Math.max(1000, Number(params.iterations || DEFAULT_KDF_PARAMS.iterations)),
    }
  }

  function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`
  }

  async function sha256Base64(text) {
    const digest = await subtle().digest('SHA-256', textEncoder.encode(String(text)))
    return bytesToBase64(digest)
  }

  async function deriveKey(passphrase, salt, params = {}) {
    const normalized = normalizeKdfParams(params)
    const raw = await subtle().importKey(
      'raw',
      textEncoder.encode(String(passphrase || '')),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return subtle().deriveKey({
      name: 'PBKDF2',
      salt: typeof salt === 'string' ? base64ToBytes(salt) : salt,
      iterations: normalized.iterations,
      hash: normalized.hash,
    }, raw, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
  }

  async function generateDataKey() {
    return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'])
  }

  async function wrapDataKey(dataKey, passphraseKey) {
    const iv = randomBytes(12)
    const wrapped = await subtle().wrapKey('raw', dataKey, passphraseKey, { name: 'AES-GCM', iv })
    return { wrappedKey: bytesToBase64(wrapped), iv: bytesToBase64(iv) }
  }

  async function unwrapDataKey(wrappedKey, passphraseKey, iv) {
    return subtle().unwrapKey(
      'raw',
      base64ToBytes(wrappedKey),
      passphraseKey,
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    )
  }

  async function encryptVault(payload, dataKey) {
    const iv = randomBytes(12)
    const plaintext = canonicalStringify(payload)
    const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, dataKey, textEncoder.encode(plaintext))
    return {
      schemaVersion: Number(payload?.backupSchemaVersion || 3),
      ciphertext: bytesToBase64(ciphertext),
      iv: bytesToBase64(iv),
      checksum: await sha256Base64(plaintext),
    }
  }

  async function decryptVault(ciphertext, dataKey, iv, expectedChecksum = '') {
    const plaintextBytes = await subtle().decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      dataKey,
      base64ToBytes(ciphertext),
    )
    const plaintext = textDecoder.decode(plaintextBytes)
    if (expectedChecksum) {
      const actual = await sha256Base64(plaintext)
      if (actual !== expectedChecksum) throw new Error('Vault checksum mismatch')
    }
    return JSON.parse(plaintext)
  }

  const api = {
    DEFAULT_KDF_PARAMS,
    base64ToBytes,
    bytesToBase64,
    canonicalStringify,
    decryptVault,
    deriveKey,
    encryptVault,
    generateDataKey,
    normalizeKdfParams,
    randomBytes,
    unwrapDataKey,
    wrapDataKey,
  }

  root.MTCryptoVault = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
