const fs = require('node:fs')
const path = require('node:path')
const release = require('../release_manifest.js')

const root = path.join(__dirname, '..')
const htmlFiles = ['index.html', 'demo/index.html']
const localAsset = /((?:src|href)="(?:\.\.\/|\.\/)?(?!https?:\/\/)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"/g

for (const relativePath of htmlFiles) {
  const file = path.join(root, relativePath)
  const before = fs.readFileSync(file, 'utf8')
  const after = before.replace(localAsset, `$1?v=${release.version}"`)
  fs.writeFileSync(file, after)
}

console.log(`Updated local JS/CSS asset versions to ${release.version}`)
