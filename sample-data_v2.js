// Use functions so date stays correct if app is open past midnight
function _localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function _localMonthStr(d) { return _localDateStr(d).slice(0, 7) }

// These are still constants for backward-compat (seeding default data only).
// App logic should call getTODAY() / getTHISMONTH() for runtime dates.
const TODAY      = _localDateStr(new Date())
const THIS_MONTH = _localMonthStr(new Date())
const LAST_MONTH = (() => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return _localMonthStr(d)
})()
const TOMORROW = (() => {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return _localDateStr(d)
})()
const IN_THREE_DAYS = (() => {
  const d = new Date(); d.setDate(d.getDate() + 3)
  return _localDateStr(d)
})()
const TWO_DAYS_AGO = (() => {
  const d = new Date(); d.setDate(d.getDate() - 2)
  return _localDateStr(d)
})()

function getTODAY()     { return _localDateStr(new Date()) }
function getTHISMONTH() { return _localMonthStr(new Date()) }

const DEFAULT_CATEGORIES = {
  expense: [
    { id: 'food',          label: 'อาหาร',     icon: '🍔', color: '#EF4444' },
    { id: 'transport',     label: 'เดินทาง',    icon: '🚗', color: '#F59E0B' },
    { id: 'shopping',      label: 'ช้อปปิ้ง',   icon: '🛍', color: '#8B5CF6' },
    { id: 'health',        label: 'สุขภาพ',     icon: '💊', color: '#10B981' },
    { id: 'entertainment', label: 'บันเทิง',    icon: '🎬', color: '#3B82F6' },
    { id: 'utility',       label: 'ค่าบริการ',  icon: '💡', color: '#6366F1' },
    { id: 'education',     label: 'การศึกษา',   icon: '📚', color: '#EC4899' },
    { id: 'other_expense', label: 'อื่นๆ',      icon: '📦', color: '#6B7280' },
  ],
  income: [
    { id: 'salary',       label: 'เงินเดือน',  icon: '💼', color: '#10B981' },
    { id: 'freelance',    label: 'ฟรีแลนซ์',   icon: '💻', color: '#3B82F6' },
    { id: 'investment',   label: 'ลงทุน',      icon: '📈', color: '#F59E0B' },
    { id: 'other_income', label: 'อื่นๆ',      icon: '💰', color: '#6B7280' },
  ],
}

const DEFAULT_WALLETS = [
  { id: 'w1', name: 'ธ.ไทยพาณิชย์', type: 'bank',    icon: '🏦', color: '#6D28D9', balance: 28500 },
  { id: 'w2', name: 'เงินสด',        type: 'cash',    icon: '💵', color: '#059669', balance: 3200  },
  { id: 'w3', name: 'TrueMoney',      type: 'ewallet', icon: '📱', color: '#F59E0B', balance: 1800  },
  { id: 'w4', name: 'KTC Cashback',   type: 'credit',  icon: '💳', color: '#DC2626', balance: -12900, limit: 50000, dueDay: 5, cycleDay: 25, dueAfterCycleDays: 10 },
  { id: 'w5', name: 'ทองคำ',         type: 'gold',    icon: '🥇', color: '#D97706', balance: 15000, symbol: 'XAU' },
  { id: 'w6', name: 'Bitcoin',       type: 'crypto',  icon: '₿', color: '#F59E0B', balance: 12000, symbol: 'BTC' },
  { id: 'w7', name: 'FCD USD',       type: 'fcd',     icon: '💱', color: '#0891B2', balance: 10000, symbol: 'USD', currency: 'USD' },
]

const DEFAULT_TRANSACTIONS = [
  { id: 't1', type: 'expense',    amount: 85,    walletId: 'w2', categoryId: 'food',          merchant: 'ข้าวแกง',  note: '',              date: TODAY },
  { id: 't2', type: 'expense',    amount: 45,    walletId: 'w2', categoryId: 'transport',      merchant: 'Grab',     note: '',              date: TODAY },
  { id: 't3', type: 'income',     amount: 35000, walletId: 'w1', categoryId: 'salary',         merchant: '',         note: 'เงินเดือนเม.ย.',date: THIS_MONTH + '-25' },
  { id: 't4', type: 'expense',    amount: 599,   walletId: 'w4', categoryId: 'entertainment',  merchant: 'Netflix',  note: '',              date: THIS_MONTH + '-01' },
  { id: 't5', type: 'expense',    amount: 1200,  walletId: 'w4', categoryId: 'shopping',       merchant: 'Shopee',   note: '',              date: THIS_MONTH + '-10' },
  { id: 't6', type: 'expense',    amount: 350,   walletId: 'w1', categoryId: 'utility',        merchant: 'ค่าไฟ',   note: '',              date: THIS_MONTH + '-05' },
  { id: 't7', type: 'transfer',   amount: 3000,  walletId: 'w1', toWalletId: 'w2',             merchant: '',         note: 'เติมเงินสด',   date: THIS_MONTH + '-15' },
  { id: 't8', type: 'expense',    amount: 250,   walletId: 'w2', categoryId: 'food',           merchant: 'สุกี้',   note: '',              date: THIS_MONTH + '-20' },
  { id: 't9', type: 'expense',    amount: 120,   walletId: 'w3', categoryId: 'food',           merchant: 'Grab Food',note: '',              date: LAST_MONTH + '-28' },
  { id: 't10',type: 'income',     amount: 35000, walletId: 'w1', categoryId: 'salary',         merchant: '',         note: 'เงินเดือนมี.ค.',date: LAST_MONTH + '-25' },
]

const DEFAULT_BUDGETS = [
  { categoryId: 'food',          monthlyLimit: 4000  },
  { categoryId: 'transport',     monthlyLimit: 2000  },
  { categoryId: 'entertainment', monthlyLimit: 1500  },
  { categoryId: 'shopping',      monthlyLimit: 3000  },
]

const DEFAULT_SETTINGS = {
  darkMode: false,
  accentColor: '#2563EB',
}

const DEFAULT_RECURRING = []

const DEFAULT_UPCOMING_BILLS = [
  {
    id: 'bill_sample_electric',
    title: 'ค่าไฟ',
    amount: 1250,
    amountType: 'fixed',
    dueDate: IN_THREE_DAYS,
    categoryId: 'utility',
    walletId: 'w1',
    merchantId: null,
    merchant: 'MEA',
    status: 'pending',
    reminderDaysBefore: [7, 3, 1],
    note: 'บิลเดือนล่าสุด',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paidAt: null,
    transactionId: null,
  },
  {
    id: 'bill_sample_rent',
    title: 'ค่าเช่าห้อง',
    amount: 8500,
    amountType: 'fixed',
    dueDate: TOMORROW,
    categoryId: 'other_expense',
    walletId: null,
    merchantId: null,
    merchant: '',
    status: 'pending',
    reminderDaysBefore: [3, 1],
    note: 'ยังไม่เลือกกระเป๋า',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paidAt: null,
    transactionId: null,
  },
  {
    id: 'bill_sample_phone',
    title: 'ค่าโทรศัพท์',
    amount: 699,
    amountType: 'estimated',
    dueDate: TWO_DAYS_AGO,
    categoryId: 'utility',
    walletId: 'w3',
    merchantId: null,
    merchant: 'True Move H',
    status: 'pending',
    reminderDaysBefore: [1],
    note: '',
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paidAt: null,
    transactionId: null,
  },
]

const DEFAULT_MERCHANTS = [
  { id: 'ms1', name: 'Grab',         emoji: '🚗', color: '#10B981' },
  { id: 'ms2', name: 'Shopee',        emoji: '🛍', color: '#F97316' },
  { id: 'ms3', name: 'Netflix',       emoji: '🎬', color: '#DC2626' },
  { id: 'ms4', name: 'LINE Man',      emoji: '🍔', color: '#06B6D4' },
  { id: 'ms5', name: 'True Move H',   emoji: '📱', color: '#6366F1' },
]


const DEFAULT_CC_BENEFITS = {
  w4: {
    enabled: true,
    points: {
      bahtPerPoint: 25,
      pointPerBahtEvery: 0,
      multiplier: 1,
      maxPerTxn: 0,
      maxPerCycle: 0,
    },
    cashback: {
      percent: 1,
      minSpend: 0,
      tierThreshold: 0,
      everyBaht: 1,
      maxPerTxn: 0,
      maxPerCycle: 500,
    },
  },
}

const DEFAULT_INCOME_BUDGETS = [
  { categoryId: 'salary', monthlyLimit: 35000 },
]

const DEFAULT_CRYPTO_PRESETS = [
  { symbol: 'BTC',  name: 'Bitcoin',          coinGeckoId: 'bitcoin',           type: 'coin',  network: 'Bitcoin',  decimals: 8,  icon: '₿',  color: '#F7931A' },
  { symbol: 'ETH',  name: 'Ethereum',         coinGeckoId: 'ethereum',          type: 'coin',  network: 'Ethereum', decimals: 8,  icon: 'Ξ',  color: '#627EEA' },
  { symbol: 'BNB',  name: 'BNB',              coinGeckoId: 'binancecoin',       type: 'coin',  network: 'BNB',      decimals: 8,  icon: 'BNB', color: '#F3BA2F' },
  { symbol: 'SOL',  name: 'Solana',           coinGeckoId: 'solana',            type: 'coin',  network: 'Solana',   decimals: 8,  icon: 'SOL', color: '#14F195' },
  { symbol: 'XRP',  name: 'XRP',              coinGeckoId: 'ripple',            type: 'coin',  network: 'XRP',      decimals: 6,  icon: 'XRP', color: '#23292F' },
  { symbol: 'ADA',  name: 'Cardano',          coinGeckoId: 'cardano',           type: 'coin',  network: 'Cardano',  decimals: 6,  icon: 'ADA', color: '#0033AD' },
  { symbol: 'DOGE', name: 'Dogecoin',         coinGeckoId: 'dogecoin',          type: 'coin',  network: 'Dogecoin', decimals: 4,  icon: 'Ð',  color: '#C2A633' },
  { symbol: 'USDT', name: 'Tether',           coinGeckoId: 'tether',            type: 'token', network: 'Ethereum', decimals: 2,  icon: '₮',  color: '#26A17B' },
  { symbol: 'USDC', name: 'USD Coin',         coinGeckoId: 'usd-coin',          type: 'token', network: 'Ethereum', decimals: 2,  icon: 'USDC', color: '#2775CA' },
  { symbol: 'TON',  name: 'Toncoin',          coinGeckoId: 'the-open-network',  type: 'coin',  network: 'TON',      decimals: 6,  icon: 'TON', color: '#0098EA' },
  { symbol: 'AVAX', name: 'Avalanche',        coinGeckoId: 'avalanche-2',       type: 'coin',  network: 'Avalanche',decimals: 6,  icon: 'AVAX', color: '#E84142' },
  { symbol: 'DOT',  name: 'Polkadot',         coinGeckoId: 'polkadot',          type: 'coin',  network: 'Polkadot', decimals: 6,  icon: 'DOT', color: '#E6007A' },
  { symbol: 'LINK', name: 'Chainlink',        coinGeckoId: 'chainlink',         type: 'token', network: 'Ethereum', decimals: 6,  icon: 'LINK', color: '#2A5ADA' },
  { symbol: 'POL',  name: 'Polygon Ecosystem',coinGeckoId: 'polygon-ecosystem-token', type: 'token', network: 'Polygon', decimals: 6, icon: 'POL', color: '#8247E5' },
  { symbol: 'MATIC',name: 'Polygon',          coinGeckoId: 'matic-network',     type: 'token', network: 'Polygon',  decimals: 6,  icon: 'MATIC', color: '#8247E5' },
]

const DEFAULT_CRYPTO_ASSETS = []
const DEFAULT_CRYPTO_HOLDINGS = []
const DEFAULT_CRYPTO_TRANSACTIONS = []
const DEFAULT_GOALS = []
const DEFAULT_PRIVILEGES = [
  {
    id: 'priv_shopee_payday10',
    title: 'Shopee 10% OFF',
    type: 'discount_code',
    platform: 'Shopee',
    merchant: '',
    code: 'PAYDAY10',
    valueType: 'percent',
    value: 10,
    minSpend: 500,
    maxDiscount: 80,
    freeItemName: '',
    quantity: 1,
    expiryDate: IN_THREE_DAYS,
    estimatedSaving: 80,
    actualSaving: null,
    status: 'active',
    usedAt: null,
    note: 'ใช้กับร้านที่ร่วมรายการ ช่วงเงินเดือนออก',
    tags: ['shopping'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'priv_lineman_free_delivery',
    title: 'LINE MAN ส่งฟรี',
    type: 'free_shipping',
    platform: 'LINE MAN',
    merchant: '',
    code: 'LMFREE',
    valueType: 'free_shipping',
    value: 0,
    minSpend: 0,
    maxDiscount: 40,
    freeItemName: '',
    quantity: 1,
    expiryDate: TOMORROW,
    estimatedSaving: 40,
    actualSaving: null,
    status: 'active',
    usedAt: null,
    note: 'โค้ดค่าส่งฟรีสำหรับสั่งอาหารช่วงเย็น',
    tags: ['food', 'delivery'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'priv_lazada_bonus80',
    title: 'Lazada Voucher ลด 80 บาท',
    type: 'voucher',
    platform: 'Lazada',
    merchant: '',
    code: 'LAZ80',
    valueType: 'amount',
    value: 80,
    minSpend: 699,
    maxDiscount: 80,
    freeItemName: '',
    quantity: 1,
    expiryDate: `${THIS_MONTH}-28`,
    estimatedSaving: 80,
    actualSaving: null,
    status: 'active',
    usedAt: null,
    note: '',
    tags: ['shopping'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'priv_cafe_bogo_used',
    title: 'ซื้อ 1 แถม 1 กาแฟ',
    type: 'free_item',
    platform: 'Cafe Amazon',
    merchant: 'Cafe Amazon',
    code: '',
    valueType: 'free_item',
    value: 0,
    minSpend: 0,
    maxDiscount: 0,
    freeItemName: 'อเมริกาโน่เย็น',
    quantity: 1,
    expiryDate: TWO_DAYS_AGO,
    estimatedSaving: 65,
    actualSaving: 70,
    status: 'used',
    usedAt: TWO_DAYS_AGO,
    note: 'ใช้สิทธิ์ผ่านแอปสมาชิก',
    tags: ['drink'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
const DEFAULT_MIGRATIONS = {
  cryptoCentralizedV1: false,
}
