/* ============================================================
   Quick Capture — voice / free-text transaction entry
   Loads after app_v2.js. Relies on globals: S, App, toast,
   moneyFmt, getTODAY, SpeechRecognition / webkitSpeechRecognition.
   ============================================================ */
;(function () {
  'use strict'

  // ── Utilities ─────────────────────────────────────────────
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10))
  const esc   = v  => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
  const money = n  => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : `฿${(Number(n)||0).toLocaleString('en-US')}`)
  const primaryWallet = () =>
    (S.wallets || []).find(w => w.type !== 'credit' && !w.archived)?.id ||
    (S.wallets || [])[0]?.id || ''

  // ── Parser: Thai digit / word normalization ────────────────
  function normalizeThaiDigits(s) {
    return s.replace(/[๐-๙]/g, d => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
  }

  // Compound Thai number words — longest first to avoid partial collisions
  const THAI_NUM_WORDS = [
    ['เก้าสิบเก้า',99],['เก้าสิบแปด',98],['เก้าสิบเจ็ด',97],['เก้าสิบหก',96],
    ['เก้าสิบห้า',95],['เก้าสิบสี่',94],['เก้าสิบสาม',93],['เก้าสิบสอง',92],
    ['เก้าสิบหนึ่ง',91],['แปดสิบเก้า',89],['แปดสิบแปด',88],['แปดสิบเจ็ด',87],
    ['แปดสิบหก',86],['แปดสิบห้า',85],['แปดสิบสี่',84],['แปดสิบสาม',83],
    ['แปดสิบสอง',82],['แปดสิบหนึ่ง',81],['เจ็ดสิบเก้า',79],['เจ็ดสิบแปด',78],
    ['เจ็ดสิบเจ็ด',77],['เจ็ดสิบหก',76],['เจ็ดสิบห้า',75],['เจ็ดสิบสี่',74],
    ['เจ็ดสิบสาม',73],['เจ็ดสิบสอง',72],['เจ็ดสิบหนึ่ง',71],['หกสิบเก้า',69],
    ['หกสิบแปด',68],['หกสิบเจ็ด',67],['หกสิบหก',66],['หกสิบห้า',65],
    ['หกสิบสี่',64],['หกสิบสาม',63],['หกสิบสอง',62],['หกสิบหนึ่ง',61],
    ['ห้าสิบเก้า',59],['ห้าสิบแปด',58],['ห้าสิบเจ็ด',57],['ห้าสิบหก',56],
    ['ห้าสิบห้า',55],['ห้าสิบสี่',54],['ห้าสิบสาม',53],['ห้าสิบสอง',52],
    ['ห้าสิบหนึ่ง',51],['สี่สิบเก้า',49],['สี่สิบแปด',48],['สี่สิบเจ็ด',47],
    ['สี่สิบหก',46],['สี่สิบห้า',45],['สี่สิบสี่',44],['สี่สิบสาม',43],
    ['สี่สิบสอง',42],['สี่สิบหนึ่ง',41],['สามสิบเก้า',39],['สามสิบแปด',38],
    ['สามสิบเจ็ด',37],['สามสิบหก',36],['สามสิบห้า',35],['สามสิบสี่',34],
    ['สามสิบสาม',33],['สามสิบสอง',32],['สามสิบหนึ่ง',31],['ยี่สิบเก้า',29],
    ['ยี่สิบแปด',28],['ยี่สิบเจ็ด',27],['ยี่สิบหก',26],['ยี่สิบห้า',25],
    ['ยี่สิบสี่',24],['ยี่สิบสาม',23],['ยี่สิบสอง',22],['ยี่สิบหนึ่ง',21],
    ['สิบเก้า',19],['สิบแปด',18],['สิบเจ็ด',17],['สิบหก',16],['สิบห้า',15],
    ['สิบสี่',14],['สิบสาม',13],['สิบสอง',12],['สิบเอ็ด',11],
    ['หนึ่งร้อย',100],['สองร้อย',200],['สามร้อย',300],['สี่ร้อย',400],
    ['ห้าร้อย',500],['หกร้อย',600],['เจ็ดร้อย',700],['แปดร้อย',800],['เก้าร้อย',900],
    ['หนึ่งพัน',1000],['สองพัน',2000],['สามพัน',3000],['สี่พัน',4000],
    ['ห้าพัน',5000],['หกพัน',6000],['เจ็ดพัน',7000],['แปดพัน',8000],['เก้าพัน',9000],
    ['ยี่สิบ',20],['สามสิบ',30],['สี่สิบ',40],['ห้าสิบ',50],
    ['หกสิบ',60],['เจ็ดสิบ',70],['แปดสิบ',80],['เก้าสิบ',90],
    ['สิบ',10],['ร้อย',100],['พัน',1000],['หมื่น',10000],['แสน',100000],['ล้าน',1000000],
    ['ศูนย์',0],['หนึ่ง',1],['สอง',2],['สาม',3],['สี่',4],
    ['ห้า',5],['หก',6],['เจ็ด',7],['แปด',8],['เก้า',9],
  ]

  function replaceThaiNumbers(s) {
    for (const [word, val] of THAI_NUM_WORDS) {
      s = s.replace(new RegExp(word, 'g'), ` ${val} `)
    }
    return s
  }

  // ── Parser: Type keywords ─────────────────────────────────
  const INCOME_KW = [
    'ได้รับเงิน','รายรับ','ได้รับ','รับเงิน','เงินเดือน',
    'โบนัส','ค่าจ้าง','income','received','ได้เงิน','รับ',
  ]

  // ── Parser: Category keyword groups ──────────────────────
  // ids[] = candidate category ids / label substrings, in priority order
  const CAT_GROUPS = [
    { ids: ['food','อาหาร','eatery','restaurant','meal','กินดื่ม'],
      words: ['กาแฟ','ชา','ข้าว','อาหาร','ก๋วยเตี๋ยว','ส้มตำ','ผัดไทย','ต้มยำ','ข้าวมัน',
              'ราดหน้า','มาม่า','สเต็ก','พิซซ่า','เบอร์เกอร์','ซูชิ','ชาบู','บุฟเฟต์',
              'โจ๊ก','ขนม','เค้ก','ไอศกรีม','ก๋วยจั๊บ','ลาบ','แกง','กะเพรา','ผัด',
              'ต้ม','ย่าง','ปลา','หมู','ไก่','กุ้ง','ซีฟู้ด','บะหมี่','สลัด',
              'แซนวิช','คาเฟ่','cafe','coffee','milk tea','ชานม','ร้านอาหาร'] },
    { ids: ['transport','การเดินทาง','travel','commute','เดินทาง'],
      words: ['grab','bolt','lineman','แท็กซี่','แกร็บ','taxi','bts','mrt','รถไฟ',
              'รถเมล์','แอร์พอร์ต','ค่าน้ำมัน','จอดรถ','ที่จอดรถ','uber','indriver',
              'ค่าทาง','วิน','มอเตอร์ไซค์','สายการบิน','ตั๋วเครื่องบิน','airasia',
              'thaiairways','lion','scoot','nok','bangkokair'] },
    { ids: ['entertainment','บันเทิง','leisure','สันทนาการ'],
      words: ['netflix','spotify','youtube','disney','hbo','prime','ดูหนัง','โรงหนัง',
              'เกม','steam','concert','คอนเสิร์ต','cinema','major','sf','game',
              'playstation','xbox','nintendo','twitch','karaoke','คาราโอเกะ'] },
    { ids: ['utilities','ค่าสาธารณูปโภค','bill','สาธารณูปโภค'],
      words: ['ค่าไฟ','ค่าน้ำ','ค่าอินเทอร์เน็ต','internet','ais','dtac','true','nt',
              'ค่าโทรศัพท์','ค่าโทร','ค่าเน็ต','wifi','electricity','water','pea','mea','pwa'] },
    { ids: ['health','สุขภาพ','medical','ยารักษาโรค'],
      words: ['ยา','หมอ','โรงพยาบาล','คลินิก','ฟัน','แว่น','วิตามิน','ออกกำลัง',
              'ฟิตเนส','gym','hospital','pharmacy','เภสัช','พยาบาล','ตรวจสุขภาพ','นวด','spa'] },
    { ids: ['shopping','ช้อปปิ้ง','retail','การช้อปปิ้ง'],
      words: ['shopee','lazada','amazon','ห้าง','central','สยาม','มาบุญครอง','mbk',
              'terminal21','เสื้อผ้า','รองเท้า','กระเป๋า','นาฬิกา','ช้อปปิ้ง',
              'robinson','bigc','big c','lotus','tops','makro','ikea','uniqlo','zara','h&m'] },
  ]

  function inferCategoryId(text, type) {
    const lower = text.toLowerCase()
    const cats  = (type === 'income' ? S.categories?.income : S.categories?.expense) || []

    for (const g of CAT_GROUPS) {
      if (!g.words.some(w => lower.includes(w.toLowerCase()))) continue
      for (const k of g.ids) {
        const c = cats.find(c =>
          c.id === k ||
          c.label.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(c.label.toLowerCase())
        )
        if (c) return c.id
      }
    }
    return ''
  }

  // ── Parser: Relative date ─────────────────────────────────
  function extractDate(text) {
    const t = today()
    const d = new Date(t + 'T00:00:00')
    let   c = text

    const patterns = [
      { re: /เมื่อวานซืน|2\s*วันก่อน/,               days: -2 },
      { re: /เมื่อวาน|yesterday/,                      days: -1 },
      { re: /เมื่อกี้นี้|เมื่อกี้|ตะกี้|just now|เพิ่งเมื่อกี้/, days: 0 },
      { re: /ตอนนี้|ตอนเช้า|เช้านี้|เที่ยงนี้|เย็นนี้|คืนนี้/, days: 0 },
    ]
    for (const { re, days } of patterns) {
      if (re.test(c)) {
        d.setDate(d.getDate() + days)
        c = c.replace(re, '').replace(/\s+/g, ' ').trim()
        return { date: d.toISOString().slice(0, 10), clean: c }
      }
    }
    const mDays = c.match(/(\d+)\s*วันก่อน/)
    if (mDays) {
      d.setDate(d.getDate() - parseInt(mDays[1], 10))
      c = c.replace(mDays[0], '').replace(/\s+/g, ' ').trim()
      return { date: d.toISOString().slice(0, 10), clean: c }
    }
    return { date: t, clean: c }
  }

  // ── Parser: Wallet match ──────────────────────────────────
  function matchWallet(text, wallets) {
    const lower     = text.toLowerCase()
    const spendable = (wallets || [])
      .filter(w => !w.archived && ['bank','cash','ewallet','saving','credit'].includes(String(w.type || '')))
      .sort((a, b) => (b.name || '').length - (a.name || '').length) // longest name first

    for (const w of spendable) {
      const name = String(w.name || '').toLowerCase()
      if (!name || !lower.includes(name)) continue
      const safeRe = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      return { walletId: w.id, clean: text.replace(safeRe, '').replace(/\s+/g, ' ').trim() }
    }
    return null
  }

  // ── Parser: Amount extraction ─────────────────────────────
  function extractAmount(text) {
    const re      = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g
    const matches = [...text.matchAll(re)]
    if (!matches.length) return null

    const nums = matches
      .map(m => ({ raw: m[0], val: parseFloat(m[0].replace(/,/g, '')), idx: m.index }))
      // Exclude likely years (4-digit 2000–2100) and zeroes
      .filter(n => n.val > 0 && !(n.val >= 2000 && n.val <= 2100 && n.raw.replace(/,/g,'').length === 4))

    if (!nums.length) return null
    return [...nums].sort((a, b) => b.val - a.val)[0] // largest = most likely amount
  }

  // ── Main parser ───────────────────────────────────────────
  function parseQuickCapture(raw) {
    if (!raw || !raw.trim()) return null

    let text = normalizeThaiDigits(raw.trim())
    text = replaceThaiNumbers(text)
    text = text.replace(/\s+/g, ' ').trim()

    // 1. Type
    let type = 'expense'
    for (const kw of INCOME_KW) {
      if (new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i').test(text)) {
        type = 'income'
        text = text.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').replace(/\s+/g, ' ').trim()
        break
      }
    }

    // 2. Date
    const { date, clean: afterDate } = extractDate(text)
    text = afterDate

    // 3. Wallet
    let walletId = ''
    const wm = matchWallet(text, S.wallets || [])
    if (wm) { walletId = wm.walletId; text = wm.clean }

    // 4. Amount
    const amountMatch = extractAmount(text)
    if (!amountMatch) {
      return { amount: 0, type, date, walletId, merchant: '', categoryId: '', note: raw.trim(), confidence: 'low' }
    }
    const amount = Math.round(amountMatch.val * 100) / 100
    text = (text.slice(0, amountMatch.idx) + text.slice(amountMatch.idx + amountMatch.raw.length))
      .replace(/\s+/g, ' ').trim()

    // 5. Merchant + category from remaining text
    let merchant   = ''
    let categoryId = ''
    const remaining = text.trim()

    if (remaining) {
      const suggestion = App.getMerchantSuggestion?.(remaining)
      if (suggestion?.merchant) {
        merchant   = suggestion.merchant
        categoryId = suggestion.categoryId || ''
        if (!walletId && suggestion.walletId) walletId = suggestion.walletId
      } else {
        // Partial match against known merchants (longest name first)
        const lRem    = remaining.toLowerCase()
        const knownM  = (S.merchants || [])
          .sort((a, b) => (b.name || '').length - (a.name || '').length)
          .find(m => {
            const mn = String(m.name || '').toLowerCase()
            return mn && (lRem.includes(mn) || mn.includes(lRem))
          })
        if (knownM) {
          merchant = knownM.name
          const sug2 = App.getMerchantSuggestion?.(knownM.name)
          if (sug2?.categoryId) categoryId = sug2.categoryId
        } else {
          merchant = remaining
        }
      }
    }

    // 6. Infer category from keywords over the full raw input if still empty
    if (!categoryId) categoryId = inferCategoryId(raw, type)

    // 7. For income: make sure we pick an income category, not an expense one
    if (type === 'income' && categoryId) {
      const expCats = S.categories?.expense || []
      const incCats = S.categories?.income  || []
      const inExp   = expCats.find(c => c.id === categoryId)
      const inInc   = incCats.find(c => c.id === categoryId)
      if (inExp && !inInc) categoryId = incCats[0]?.id || ''
    }

    // 8. Wallet fallback
    if (!walletId) walletId = primaryWallet()

    const canQuickSave = amount > 0 && !!categoryId
    const confidence   = canQuickSave
      ? (merchant ? 'high' : 'medium')
      : 'low_nocat'

    return { amount, type, merchant, categoryId, walletId, note: '', date, confidence, rawInput: raw.trim() }
  }

  // ── Speech API ────────────────────────────────────────────
  let _recognition = null
  let _isListening = false

  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  }

  function startListening(onResult, onError, onEnd) {
    if (_isListening) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { onError?.('ไม่รองรับการรับเสียงในเบราว์เซอร์นี้'); return }
    try {
      _recognition          = new SR()
      _recognition.lang     = 'th-TH'
      _recognition.interimResults  = false
      _recognition.maxAlternatives = 1
      _recognition.continuous      = false
      _isListening = true

      _recognition.onresult = e => {
        _isListening = false
        onResult?.(e.results[0]?.[0]?.transcript || '')
      }
      _recognition.onerror = e => {
        _isListening = false
        const msg = e.error === 'not-allowed' ? 'กรุณาอนุญาตการเข้าถึงไมค์'
                  : e.error === 'no-speech'   ? 'ไม่ได้ยินเสียง — ลองอีกครั้ง'
                  : 'รับเสียงไม่สำเร็จ'
        onError?.(msg)
      }
      _recognition.onend = () => { _isListening = false; onEnd?.() }
      _recognition.start()
    } catch (_) {
      _isListening = false
      onError?.('ไม่สามารถเปิดไมค์ได้')
    }
  }

  function stopListening() {
    try { _recognition?.stop() } catch (_) {}
    _isListening = false
  }

  // ── Overlay ───────────────────────────────────────────────
  const QC_OVERLAY_ID = 'overlay-quick-capture'

  function getOrCreateOverlay() {
    let el = document.getElementById(QC_OVERLAY_ID)
    if (!el) {
      el = document.createElement('div')
      el.className = 'overlay'
      el.id        = QC_OVERLAY_ID
      el.setAttribute('role', 'dialog')
      el.setAttribute('aria-modal', 'true')
      el.setAttribute('aria-label', 'บันทึกเร็ว')
      el.innerHTML = `
        <div class="overlay-backdrop" onclick="App.closeQuickCapture()" aria-hidden="true"></div>
        <div class="sheet" id="qc-sheet" style="max-height:90dvh">
          <div class="sheet-handle" style="width:36px;height:4px;border-radius:2px;margin:10px auto 0;flex-shrink:0;background:var(--border)"></div>
          <div id="qc-content" style="flex:1;overflow-y:auto;display:flex;flex-direction:column"></div>
        </div>`
      document.body.appendChild(el)
    }
    return el
  }

  function _qcSetContent(html) {
    const box = document.getElementById('qc-content')
    if (box) box.innerHTML = html
  }

  // ── State ─────────────────────────────────────────────────
  let _qcResult = null

  // ── UI helpers ────────────────────────────────────────────
  function _dateLabel(iso) {
    const t = today()
    if (iso === t) return 'วันนี้'
    const yd = new Date(t + 'T00:00:00')
    yd.setDate(yd.getDate() - 1)
    if (iso === yd.toISOString().slice(0, 10)) return 'เมื่อวาน'
    const [y, m, d] = (iso || '').split('-')
    return (d && m && y) ? `${d}/${m}/${y}` : (iso || '')
  }

  // ── UI: Input screen ──────────────────────────────────────
  function _qcRenderInput(prefill, errorMsg) {
    const hasSpeech = speechSupported()
    _qcSetContent(`
      <div style="padding:16px 16px 10px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <h2 style="margin:0;font-size:17px;font-weight:700">บันทึกเร็ว</h2>
        <button class="btn-icon" onclick="App.closeQuickCapture()" aria-label="ปิด">✕</button>
      </div>
      <div style="padding:0 16px 28px;flex:1">
        <div style="position:relative;margin-bottom:8px">
          <input id="qc-input" class="form-input" type="text" inputmode="text"
            placeholder="เช่น กาแฟ 65 · Grab 120 · ข้าว 80 เมื่อวาน"
            value="${esc(prefill || '')}"
            style="padding-right:${hasSpeech ? '50px' : '12px'};font-size:16px;height:50px"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            onkeydown="if(event.key==='Enter'){event.preventDefault();App._qcSubmit()}">
          ${hasSpeech ? `
            <button id="qc-mic-btn" type="button" aria-label="กดค้างเพื่อพูด"
              style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
                     background:none;border:none;padding:8px;cursor:pointer;
                     color:var(--muted);font-size:22px;line-height:1;border-radius:8px;
                     -webkit-tap-highlight-color:transparent;user-select:none"
              onpointerdown="App._qcMicStart(event)"
              onpointerup="App._qcMicStop()"
              onpointercancel="App._qcMicStop()">🎤</button>` : ''}
        </div>
        ${errorMsg
          ? `<div style="color:var(--expense);font-size:13px;margin-bottom:10px;
                         padding:8px 12px;background:rgba(220,38,38,.08);border-radius:8px">
               ⚠️ ${esc(errorMsg)}</div>`
          : ''}
        <div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.7">
          พิมพ์ฟรีฟอร์ม หรือกดค้าง 🎤 แล้วพูด<br>
          <span style="opacity:.7">รองรับ: ยอดเงิน · ร้านค้า · กระเป๋า · "เมื่อวาน"</span>
        </div>
        <button class="btn btn-primary" onclick="App._qcSubmit()" style="margin-bottom:10px">ถัดไป →</button>
        <button class="btn btn-secondary" onclick="App._qcOpenFull()">เปิดฟอร์มเต็ม</button>
      </div>`)

    requestAnimationFrame(() => {
      const inp = document.getElementById('qc-input')
      if (!inp) return
      inp.focus()
      inp.setSelectionRange(inp.value.length, inp.value.length)
    })
  }

  // ── UI: Preview screen ────────────────────────────────────
  function _qcRenderPreview(result) {
    const allCats = [
      ...(S.categories?.expense || []),
      ...(S.categories?.income  || []),
    ]
    const cat    = allCats.find(c => c.id === result.categoryId)
    const wallet = (S.wallets || []).find(w => w.id === result.walletId)
    const noCat  = !cat
    const sign   = result.type === 'income' ? '+' : '-'
    const col    = result.type === 'income' ? 'var(--income)' : 'var(--expense)'

    const row = (icon, label, value, clickable) => `
      <div ${clickable ? 'onclick="App._qcEdit()"' : ''}
        style="display:flex;align-items:center;gap:10px;padding:11px 0;
               border-bottom:1px solid var(--border);
               ${clickable ? 'cursor:pointer' : ''}">
        <span style="font-size:20px;width:28px;text-align:center;flex-shrink:0">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--muted);margin-bottom:1px">${label}</div>
          <div style="font-weight:600;font-size:14px;white-space:nowrap;
                      overflow:hidden;text-overflow:ellipsis">${value}</div>
        </div>
        ${clickable ? '<span style="color:var(--muted);font-size:16px;flex-shrink:0">›</span>' : ''}
      </div>`

    const catDisplay  = noCat
      ? '<span style="color:var(--expense)">ยังไม่ระบุ — กรุณาแก้ไข</span>'
      : `${esc(cat.icon || '📦')} ${esc(cat.label)}`
    const descDisplay = esc(result.merchant || result.note || '-')

    _qcSetContent(`
      <div style="padding:14px 16px 10px;display:flex;align-items:center;gap:8px;flex-shrink:0">
        <button class="btn-icon" onclick="App._qcBack()" aria-label="กลับ" style="flex-shrink:0">←</button>
        <h2 style="margin:0;font-size:17px;font-weight:700;flex:1">ตรวจสอบ</h2>
        <button class="btn-icon" onclick="App.closeQuickCapture()" aria-label="ปิด">✕</button>
      </div>
      <div style="padding:0 16px 28px;flex:1">
        <div style="text-align:center;padding:10px 0 16px">
          <div style="font-size:38px;font-weight:800;color:${col};letter-spacing:-1px">
            ${sign}${money(result.amount)}
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">
            ${result.type === 'income' ? 'รายรับ' : 'รายจ่าย'}
          </div>
        </div>

        <div style="margin-bottom:14px">
          ${row(noCat ? '❓' : esc(cat.icon || '📦'), 'หมวดหมู่', catDisplay, true)}
          ${row('🏪', result.merchant ? 'ร้านค้า' : 'โน้ต', descDisplay, true)}
          ${row(esc(wallet?.icon || '👛'), 'กระเป๋าเงิน',
            wallet ? `${esc(wallet.icon || '👛')} ${esc(wallet.name)}` : 'ไม่ระบุ', true)}
          ${row('📅', 'วันที่', _dateLabel(result.date), true)}
        </div>

        ${noCat
          ? `<div style="font-size:12px;color:var(--amber);background:rgba(217,119,6,.1);
                         border-radius:8px;padding:9px 12px;margin-bottom:14px;text-align:center">
               ⚠️ ยังไม่มีหมวดหมู่ — กด <strong>แก้ไข</strong> ก่อนบันทึก
             </div>`
          : ''}

        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="App._qcEdit()" style="flex:1">แก้ไข</button>
          <button class="btn btn-primary" onclick="App._qcConfirm()"
            style="flex:2" ${noCat ? 'disabled' : ''}>✓ บันทึก</button>
        </div>
      </div>`)
  }

  // ── Mic visual state ──────────────────────────────────────
  function _setMicListening(on) {
    const btn = document.getElementById('qc-mic-btn')
    const inp = document.getElementById('qc-input')
    if (btn) btn.style.color = on ? 'var(--expense)' : ''
    if (inp) inp.placeholder = on
      ? 'กำลังฟัง...'
      : 'เช่น กาแฟ 65 · Grab 120 · ข้าว 80 เมื่อวาน'
  }

  // ── Public API ─────────────────────────────────────────────
  App.openQuickCapture = function () {
    _qcResult = null
    const overlay = getOrCreateOverlay()
    // Re-trigger slide-up animation on each open
    const sheet = document.getElementById('qc-sheet')
    if (sheet) {
      sheet.style.animation = 'none'
      void sheet.offsetHeight  // force reflow
      sheet.style.animation    = ''
    }
    overlay.classList.add('open')
    _qcRenderInput()
  }

  App.closeQuickCapture = function () {
    stopListening()
    document.getElementById(QC_OVERLAY_ID)?.classList.remove('open')
    _qcResult = null
  }

  App._qcSubmit = function () {
    const raw = document.getElementById('qc-input')?.value?.trim() || ''
    if (!raw) { _qcRenderInput('', 'กรุณากรอกข้อมูล'); return }

    const result = parseQuickCapture(raw)
    if (!result || result.amount <= 0) {
      _qcRenderInput(raw, 'ไม่พบจำนวนเงิน — ลองพิมพ์ใหม่ เช่น "กาแฟ 65"')
      return
    }

    _qcResult = result
    _qcRenderPreview(result)
  }

  App._qcBack = function () {
    const prev = _qcResult?.rawInput || ''
    _qcResult  = null
    _qcRenderInput(prev)
  }

  App._qcConfirm = function () {
    if (!_qcResult || !_qcResult.categoryId) return
    _applyToSxState(_qcResult)
    App.closeQuickCapture()
    App.saveTx()
  }

  App._qcEdit = function () {
    if (!_qcResult) return
    _applyToSxState(_qcResult)
    App.closeQuickCapture()
    App.openOverlay('overlay-add-tx')
    App._renderAddTxDetail()
  }

  App._qcOpenFull = function () {
    App.closeQuickCapture()
    App.openAddTx()
  }

  App._qcMicStart = function (e) {
    e?.preventDefault()
    if (_isListening) { stopListening(); _setMicListening(false); return }
    _setMicListening(true)
    startListening(
      transcript => {
        _setMicListening(false)
        const inp = document.getElementById('qc-input')
        if (inp) { inp.value = transcript; inp.focus() }
        if (transcript.trim()) setTimeout(() => App._qcSubmit(), 350)
      },
      errMsg => { _setMicListening(false); toast(errMsg, 'error') },
      ()      => _setMicListening(false)
    )
  }

  App._qcMicStop = function () {
    if (_isListening) stopListening()
  }

  // ── S.tx pre-fill ─────────────────────────────────────────
  function _applyToSxState(result) {
    S.txMode      = 'add'
    S.editingTxId = null
    S.tx = {
      step:               'detail',
      type:               result.type        || 'expense',
      amount:             String(result.amount),
      calcOp:             '',
      calcLeft:           '',
      walletId:           result.walletId    || primaryWallet(),
      toWalletId:         '',
      categoryId:         result.categoryId  || '',
      merchant:           result.merchant    || '',
      channel:            '',
      note:               result.note        || '',
      date:               result.date        || today(),
      isRecurring:        false,
      isInstallment:      false,
      installmentMonths:  '',
      rewardRuleIds:      [],
      txSuggestedFields:  {},
      rewardEstimate:     null,
      rewardIncludePoints:   true,
      rewardIncludeCashback: true,
    }
  }

  // ── FAB mic button ────────────────────────────────────────
  function _injectMicFab() {
    if (document.getElementById('fab-mic')) return
    const fab = document.getElementById('fab')
    if (!fab) return
    const btn      = document.createElement('button')
    btn.id         = 'fab-mic'
    btn.type       = 'button'
    btn.setAttribute('aria-label', 'บันทึกเร็ว (Quick Capture)')
    btn.onclick    = () => App.openQuickCapture()
    btn.innerHTML  = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3"/>
      <path d="M5 10a7 7 0 0 0 14 0"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="8"  y1="22" x2="16" y2="22"/>
    </svg>`
    fab.insertAdjacentElement('beforebegin', btn)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectMicFab)
  } else {
    setTimeout(_injectMicFab, 0)
  }

})()
