const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const release = require('../release_manifest.js')

const root = path.join(__dirname, '..')
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const demoHtml = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const sw = fs.readFileSync(path.join(root, 'service-worker_v2.js'), 'utf8')

test('gold helper loads before app_v2 in production and demo HTML', () => {
  assert.ok(indexHtml.indexOf('gold_market.js') > -1, 'index.html missing gold_market.js')
  assert.ok(indexHtml.indexOf('gold_market.js') < indexHtml.indexOf('app_v2.js'), 'index.html loads gold helper after app_v2')
  assert.ok(demoHtml.indexOf('gold_market.js') > -1, 'demo/index.html missing gold_market.js')
  assert.ok(demoHtml.indexOf('gold_market.js') < demoHtml.indexOf('app_v2.js'), 'demo/index.html loads gold helper after app_v2')
})

test('CSP allows Apps Script JSONP gold proxy hosts', () => {
  assert.ok(indexHtml.includes('https://script.google.com'), 'index CSP missing script.google.com')
  assert.ok(indexHtml.includes('https://script.googleusercontent.com'), 'index CSP missing script.googleusercontent.com')
  assert.ok(demoHtml.includes('https://script.google.com'), 'demo CSP missing script.google.com')
  assert.ok(demoHtml.includes('https://script.googleusercontent.com'), 'demo CSP missing script.googleusercontent.com')
})

test('service worker treats gold_market.js as core cached code', () => {
  assert.ok(release.coreAssets.includes('./gold_market.js'), 'release manifest missing gold_market.js precache asset')
  assert.ok(release.networkFirstFiles.includes('gold_market.js'), 'release manifest missing gold_market.js core code marker')
  assert.match(sw, /self\.MT_RELEASE\.version/, 'service worker does not use the shared release version')
})

test('app delegates Thai gold sync to shared helper', () => {
  assert.ok(app.includes('window.MTGoldMarket.fetchThaiGoldViaSource'), 'app does not delegate gold sync to shared helper')
  assert.ok(app.includes('window.MTGoldMarket.normaliseGoldPayload'), 'app does not expose helper normalizer')
})
