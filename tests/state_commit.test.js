const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const StateCommit = require('../state_commit.js')

test('State Commit prepares, writes, then notifies through one Interface', () => {
  const events = []
  const state = { transactions: [] }
  const commit = StateCommit.create({
    readState: () => state,
    storage: {
      saveAll(value) {
        assert.equal(value, state)
        events.push('write')
        return true
      },
    },
    beforeCommit: [value => { value.prepared = true; events.push('prepare') }],
    afterCommit: [value => { assert.equal(value.prepared, true); events.push('notify') }],
  })

  assert.deepEqual(commit.commit({ reason: 'test' }), { ok: true, reason: 'test', observerErrors: [] })
  assert.deepEqual(events, ['prepare', 'write', 'notify'])
})

test('State Commit never notifies when durable storage rejects a write', () => {
  let notified = false
  const commit = StateCommit.create({
    readState: () => ({}),
    storage: { saveAll: () => false },
    afterCommit: [() => { notified = true }],
  })

  const result = commit.commit({ reason: 'rejected' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'WRITE_FAILED')
  assert.equal(notified, false)
})

test('State Commit reports hydration and preparation failures without writing', () => {
  let writes = 0
  const notReady = StateCommit.create({
    readState: () => ({}),
    isReady: () => false,
    storage: { saveAll: () => { writes++; return true } },
  })
  assert.equal(notReady.commit().error.code, 'NOT_READY')

  const invalid = StateCommit.create({
    readState: () => ({}),
    storage: { saveAll: () => { writes++; return true } },
    beforeCommit: [() => { throw new Error('bad normalization') }],
  })
  assert.equal(invalid.commit().error.code, 'PREPARE_FAILED')
  assert.equal(writes, 0)
})

test('App.saveAll stays the stable State Commit Interface instead of a wrapper chain', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
  assert.match(app, /saveAll\(reason = 'app'\) \{ return persist\(reason\) \}/)
  assert.doesNotMatch(app, /App\.saveAll\s*=/)
  assert.match(app, /addAfterCommit\(/)
})
