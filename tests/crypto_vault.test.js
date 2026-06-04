const test = require('node:test')
const assert = require('node:assert/strict')

const CryptoVault = require('../crypto_vault.js')

const payload = {
  backupSchemaVersion: 3,
  source: 'money-tracker-v2',
  exportedAt: '2026-06-04T00:00:00.000Z',
  transactions: [{ id: 'tx1', amount: 1250, merchant: 'Secret cafe' }],
  wallets: [{ id: 'wallet1', name: 'Main', balance: 25000 }],
}

test('encrypts and decrypts a vault payload with a passphrase-derived data key', async () => {
  const salt = CryptoVault.randomBytes(16)
  const passphraseKey = await CryptoVault.deriveKey('correct horse battery staple', salt, { iterations: 1000 })
  const dataKey = await CryptoVault.generateDataKey()
  const wrapped = await CryptoVault.wrapDataKey(dataKey, passphraseKey)
  const unwrapped = await CryptoVault.unwrapDataKey(wrapped.wrappedKey, passphraseKey, wrapped.iv)
  const encrypted = await CryptoVault.encryptVault(payload, unwrapped)
  const decrypted = await CryptoVault.decryptVault(encrypted.ciphertext, unwrapped, encrypted.iv, encrypted.checksum)

  assert.deepEqual(decrypted, payload)
  assert.equal(encrypted.schemaVersion, 3)
  assert.equal(typeof encrypted.checksum, 'string')
})

test('rejects a wrong passphrase before exposing vault plaintext', async () => {
  const salt = CryptoVault.randomBytes(16)
  const correctKey = await CryptoVault.deriveKey('right passphrase', salt, { iterations: 1000 })
  const wrongKey = await CryptoVault.deriveKey('wrong passphrase', salt, { iterations: 1000 })
  const dataKey = await CryptoVault.generateDataKey()
  const wrapped = await CryptoVault.wrapDataKey(dataKey, correctKey)

  await assert.rejects(
    () => CryptoVault.unwrapDataKey(wrapped.wrappedKey, wrongKey, wrapped.iv),
    /decrypt|operation|authentic/i,
  )
})

test('uses a fresh IV so the same payload encrypts to different ciphertext', async () => {
  const dataKey = await CryptoVault.generateDataKey()
  const first = await CryptoVault.encryptVault(payload, dataKey)
  const second = await CryptoVault.encryptVault(payload, dataKey)

  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.equal(first.checksum, second.checksum)
})
