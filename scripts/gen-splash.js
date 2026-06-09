#!/usr/bin/env node
/*
 * Generates solid-colour iOS PWA launch (apple-touch-startup-image) PNGs.
 *
 * iOS paints a native launch screen on cold start, BEFORE the WebView runs any
 * HTML/CSS/JS. Without startup images it falls back to the manifest
 * background_color (near-white) -> the "white flash" before the in-app skeleton.
 * These solid PNGs match the skeleton background (#EEF6FF light / #09111F dark)
 * so there is no perceptible white, then the in-app #mt-boot-screen skeleton
 * takes over seamlessly.
 *
 * Run: node scripts/gen-splash.js
 * Outputs: assets/splash/splash-<w>x<h>-<theme>.png
 *
 * Also prints the <link rel="apple-touch-startup-image"> tags to paste into
 * index.html.
 */
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, '..', 'assets', 'splash')

// Skeleton background colours — keep in sync with index.html html/body background.
const THEMES = {
  light: [0xee, 0xf6, 0xff], // #EEF6FF
  dark: [0x09, 0x11, 0x1f], // #09111F
}

// Portrait iPhone launch sizes: [cssWidth, cssHeight, dpr]. Covers SE..iPhone 16 Pro Max.
const DEVICES = [
  [320, 568, 2], // SE (1st gen)
  [375, 667, 2], // 8, SE 2/3
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [402, 874, 3], // 16 Pro
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [440, 956, 3], // 16 Pro Max
]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB
  // 10-12 = compression/filter/interlace = 0

  const rowBytes = w * 3
  const raw = Buffer.alloc((rowBytes + 1) * h)
  for (let y = 0; y < h; y++) {
    const off = y * (rowBytes + 1)
    raw[off] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const links = []
for (const [cw, ch, dpr] of DEVICES) {
  const pw = cw * dpr
  const ph = ch * dpr
  for (const theme of Object.keys(THEMES)) {
    const file = `splash-${pw}x${ph}-${theme}.png`
    fs.writeFileSync(path.join(OUT_DIR, file), solidPng(pw, ph, THEMES[theme]))
    links.push(
      `  <link rel="apple-touch-startup-image" ` +
        `media="screen and (device-width: ${cw}px) and (device-height: ${ch}px) ` +
        `and (-webkit-device-pixel-ratio: ${dpr}) and (prefers-color-scheme: ${theme}) ` +
        `and (orientation: portrait)" ` +
        `href="./assets/splash/${file}">`
    )
  }
}

console.log(`Generated ${DEVICES.length * 2} splash PNGs in ${OUT_DIR}`)
console.log('\n--- paste into index.html <head> ---\n')
console.log(links.join('\n'))
