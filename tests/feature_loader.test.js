const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const loader = fs.readFileSync(path.join(root, 'feature_loader.js'), 'utf8')
const manifest = require('../release_manifest.js')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const demo = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
const worker = fs.readFileSync(path.join(root, 'service-worker_v2.js'), 'utf8')

test('feature loader exposes ordered, coalesced group loading with readiness state', () => {
  assert.match(loader, /MTFeatureLoader/)
  assert.match(loader, /function load\(group(?:, options = \{\})?\)/)
  assert.match(loader, /pending\.get\(group\)/)
  assert.match(loader, /ready\(group\)/)
  assert.match(loader, /script\.onerror/)
})

test('deferred feature groups batch their startup redraw into one request', () => {
  assert.match(loader, /load\(group, options = \{\}\)/)
  assert.match(loader, /options\.render !== false/)
  assert.match(loader, /load\(group, \{ render:false \}\)/)
  assert.match(loader, /optional-features-ready/)
  assert.match(loader, /if \(shouldRender\)[\s\S]{0,120}root\.App\?\.requestRender/)
})

test('release manifest keeps deferred modules offline-cacheable', () => {
  assert.ok(Array.isArray(manifest.deferredAssets))
  assert.ok(manifest.deferredAssets.includes('./notifications_v2.js'))
  assert.ok(manifest.deferredAssets.includes('./quick_capture.js'))
  for (const asset of manifest.deferredAssets) assert.ok(manifest.coreAssets.includes(asset), `${asset} must remain precached`)
  for (const html of [index, demo]) {
    assert.doesNotMatch(html, /<script\s+defer[^>]+(?:notifications_v2|quick_capture|split_bill|loans_v2|onboarding)\.js/)
  }
})

test('immutable release assets use cache-first with background revalidation', () => {
  assert.match(worker, /cacheFirstImmutable/)
  assert.match(worker, /background.*revalidat/i)
  assert.match(worker, /isImmutableAsset/)
  assert.match(worker, /cacheFirstImmutable\(request\)/)
})
