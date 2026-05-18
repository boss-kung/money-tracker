'use strict'

const AskMyMoneyCore = (() => {
  function parseRange(q, opts) {
    const month = opts.now()
    if (/เดือนก่อน|เดือนที่แล้ว|previous month/.test(q) && !/เทียบเดือนก่อน/.test(q)) return { kind:'month', month:opts.prevMonth(month), label:`เดือน${opts.monthLabel(opts.prevMonth(month))}` }
    if (/3 เดือน|สามเดือน/.test(q)) return { kind:'window', months:opts.getMonths(3), label:'3 เดือนล่าสุด' }
    if (/6 เดือน|หกเดือน/.test(q)) return { kind:'window', months:opts.getMonths(6), label:'6 เดือนล่าสุด' }
    if (/สิ้นเดือน|ปลายเดือน/.test(q)) return { kind:'forecast', month, label:`สิ้นเดือน${opts.monthLabel(month)}` }
    return { kind:'month', month, label:`เดือน${opts.monthLabel(month)}` }
  }

  function parseIntent(q, { category, merchant, lastIntent } = {}) {
    if (/หารบิล|ค้างเรา|เราค้าง|ค่าใช้จ่ายร่วม|การเงินร่วม|shared/.test(q)) return 'shared_finance'
    if (/ลองสถานการณ์|scenario|ถ้า.*รายได้ลด|ถ้า.*ซื้อ/.test(q)) return 'scenario'
    if (/ช่วยทำอะไรได้บ้าง|เสนอให้ทำ|action ที่ควรทำ/.test(q)) return 'actions'
    if (/เหตุการณ์เดือนนี้|บันทึกอะไรไว้|บริบทเดือนนี้/.test(q)) return 'memory'
    if (/คะแนนสุขภาพ|health score|สุขภาพการเงินละเอียด/.test(q)) return 'health_score'
    if (/แผนอัตโนมัติ|autopilot|ต้นเดือนควรทำอะไร|สิ้นเดือนควรดูอะไร/.test(q)) return 'autopilot'
    if (/พฤติกรรม|นิสัยการใช้เงิน|ใช้เงินแบบไหน/.test(q)) return 'behavior'
    if (/ควรกังวล|ต้องระวัง|เสี่ยงอะไร|อะไรสำคัญที่สุด|recommend|แนะนำ/.test(q)) return 'priorities'
    if (/อยากออมเพิ่ม|ออมเพิ่ม.*เดือนละ|ต้องลดตรงไหน/.test(q)) return 'savings_scenario'
    if (/พอถึงสิ้นเดือน|เงินพอไหม|สิ้นเดือน.*พอ|อยู่รอดถึงสิ้นเดือน/.test(q)) return 'cashflow_forecast'
    if (/อีก\s*\d+\s*วัน|14 วัน|7 วัน|ต้องจ่ายอะไร|ภาระข้างหน้า|บิล.*ข้างหน้า/.test(q)) return 'upcoming'
    if (/เงินสำรอง|ฉุกเฉิน/.test(q)) return 'emergency_fund'
    if (/รายจ่ายประจำ|fixed cost|subscription|ค่าใช้จ่ายคงที่/.test(q)) return 'fixed_cost'
    if (/เป้าหมาย.*ตามทัน|ตามไม่ทัน|ต้องออมเพิ่ม|เป้าหมายไหน/.test(q)) return 'goal_feasibility'
    if (/ทรัพย์สินสุทธิ|มูลค่าสุทธิ|net worth/.test(q)) return 'net_worth'
    if (/ผิดปกติ|เงินหายเร็ว|ทำไม.*หาย|โตเร็วสุด/.test(q)) return 'anomaly'
    if (/เปรียบเทียบ|เทียบ|มากกว่าเดือนก่อน|น้อยกว่าเดือนก่อน/.test(q) || (lastIntent && /แล้ว.*ล่ะ|เทียบเดือนก่อน/.test(q))) return 'comparison'
    if (/หมวดไหน.*เสี่ยง|เสี่ยงเกินงบ|ใกล้เกินงบ/.test(q)) return 'budget_risk'
    if (/งบ.*วันละ|ใช้ได้วันละ|อยู่ในงบ/.test(q)) return 'budget_forecast'
    if (/ล่าสุด|recent/.test(q)) return 'recent'
    if (/ร้านค้า|ร้านไหน|ใช้เงินมาก/.test(q) || merchant) return 'merchant'
    if (/หมวดไหน|หมวดหมู่/.test(q) || category) return 'category'
    if (/บัตรเครดิต|ค้างชำระ|วงเงิน/.test(q)) return 'credit'
    if (/เป้าหมาย|goal/.test(q)) return 'goals'
    if (/ออมได้|อัตราออม|เงินออม/.test(q)) return 'savings'
    if (/งบ|เกินงบ|งบเหลือ/.test(q)) return 'budget'
    if (/เงินเหลือ|เงินสด|เงินพร้อมใช้|คงเหลือ|มีเงิน/.test(q)) return 'cash'
    if (/รายรับ|ได้เงิน|รับเงิน|เงินเดือน/.test(q)) return 'income'
    if (/ใช้ไป|รายจ่าย|ใช้จ่าย|ค่าใช้จ่าย|จ่ายไป/.test(q)) return 'expense'
    if (/สุขภาพ|ภาพรวม|สรุป|overview/.test(q)) return 'overview'
    return 'fallback'
  }

  return { parseRange, parseIntent }
})()

if (typeof module !== 'undefined') module.exports = AskMyMoneyCore
