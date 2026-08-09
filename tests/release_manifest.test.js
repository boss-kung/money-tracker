const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const release = require('../release_manifest.js')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('app and service worker consume the shared Release Interface', () => {
  assert.match(read('app_v2.js'), /window\.MT_RELEASE\?\.version/)
  assert.match(read('service-worker_v2.js'), /importScripts\('\.\/release_manifest\.js'\)/)
  assert.match(read('service-worker_v2.js'), /self\.MT_RELEASE\.coreAssets/)
})

test('all local HTML JS/CSS cache keys match the release version', () => {
  for (const file of ['index.html', 'demo/index.html']) {
    const versions = [...read(file).matchAll(/(?:src|href)="(?:\.\.\/|\.\/)?(?!https?:\/\/)[^"?#]+\.(?:js|css)\?v=([^"]+)"/g)]
      .map(match => match[1])
    assert.ok(versions.length > 0, file)
    assert.deepEqual([...new Set(versions)], [release.version], file)
  }
})

test('every production JavaScript dependency is in the offline shell', () => {
  const scripts = [...read('index.html').matchAll(/src="([^"?]+\.js)(?:\?[^"?]*)?"/g)]
    .map(match => `./${match[1].replace(/^\.\//, '')}`)
  for (const script of scripts) assert.ok(release.coreAssets.includes(script), script)
})
