const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')

function extractBlock() {
  const start = app.indexOf(';(function _patchHistoryBackNav()')
  assert.ok(start >= 0, '_patchHistoryBackNav block not found')
  const end = app.indexOf('\n})()', start)
  assert.ok(end > start, '_patchHistoryBackNav block end not found')
  return app.slice(start, end + '\n})()'.length)
}

function makeEl() {
  const listeners = []
  return {
    addEventListener(type, fn) { if (type === 'click') listeners.push(fn) },
    click() { for (const fn of [...listeners]) fn({ target: this }) },
  }
}

// Minimal DOM/history harness: history.back() fires popstate asynchronously, like a browser.
function setup() {
  const popListeners = []
  const hist = { length: 1, index: 0 }
  const history = {
    pushState() { hist.index++; hist.length = hist.index + 1 },
    back() {
      setTimeout(() => {
        if (hist.index <= 0) return
        hist.index--
        for (const fn of popListeners) fn({})
      }, 0)
    },
  }
  const state = { subScreenOpen: false, confirmEl: null }
  const subScreen = {
    classList: { contains: c => c === 'open' && state.subScreenOpen },
    querySelector: () => null,
  }
  const document = {
    getElementById(id) {
      if (id === 'v23-confirm-overlay') return state.confirmEl
      if (id === 'sub-screen') return subScreen
      return null
    },
    querySelectorAll: () => [],
  }
  const App = {
    openOverlay() {},
    closeOverlay() {},
    openSubScreen() { state.subScreenOpen = true },
    closeSubScreen() { state.subScreenOpen = false },
    showConfirm() {
      const ok = makeEl(); const cancel = makeEl(); const el = makeEl()
      const close = () => { state.confirmEl = null }
      ok.addEventListener('click', close)
      cancel.addEventListener('click', close)
      el.querySelector = sel => (sel === '.v23-ok-btn' ? ok : sel === '.v23-cancel-btn' ? cancel : null)
      state.confirmEl = el
    },
  }
  const window = { addEventListener(type, fn) { if (type === 'popstate') popListeners.push(fn) } }
  const ctx = { App, window, document, history, location: { href: 'http://x/' }, queueMicrotask, setTimeout }
  vm.runInNewContext(extractBlock(), ctx)
  const browserBack = () => history.back()
  return { App, state, hist, browserBack }
}

const settle = () => new Promise(r => setTimeout(r, 10))

for (const btn of ['.v23-ok-btn', '.v23-cancel-btn']) {
  test(`confirm ${btn} over a sub-screen closes only the confirm`, async () => {
    const { App, state, hist } = setup()
    App.openSubScreen('<div></div>')
    await settle()
    App.showConfirm({ title: 't', body: 'b', onConfirm() {} })
    await settle()
    assert.equal(hist.index, 2)
    state.confirmEl.querySelector(btn).click()
    await settle()
    assert.equal(state.confirmEl, null, 'confirm should be closed')
    assert.equal(state.subScreenOpen, true, 'sub-screen must stay open — our own history.back() echo must not close it')
    assert.equal(hist.index, 1)
  })
}

test('browser back still closes confirm, then sub-screen, in order', async () => {
  const { App, state, hist, browserBack } = setup()
  App.openSubScreen('<div></div>')
  await settle()
  App.showConfirm({ title: 't', body: 'b', onConfirm() {} })
  await settle()
  browserBack()
  await settle()
  assert.equal(state.confirmEl, null, 'first back closes the confirm')
  assert.equal(state.subScreenOpen, true, 'sub-screen stays open after first back')
  browserBack()
  await settle()
  assert.equal(state.subScreenOpen, false, 'second back closes the sub-screen')
  assert.equal(hist.index, 0)
})

test('same-tick close/open swap still nets to no history navigation', async () => {
  const { App, state, hist } = setup()
  App.openSubScreen('<div></div>')
  await settle()
  App.closeSubScreen()
  App.openSubScreen('<div></div>')
  await settle()
  assert.equal(hist.index, 1)
  assert.equal(state.subScreenOpen, true)
})
