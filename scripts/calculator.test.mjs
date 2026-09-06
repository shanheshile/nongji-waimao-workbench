import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateTradeQuote,
  findBidirectionalMatches,
  getEffectiveRate,
  isAllowedCompatibilityRolePair,
  isValidHsCode,
  normalizeHsCode,
} from '../src/lib/calculator.js'

test('有效汇率按市场汇率减去汇率差额计算', () => {
  assert.equal(getEffectiveRate(7.2, 0.2), 7)
  assert.throws(() => getEffectiveRate(0.2, 0.2), /必须大于 0/)
})

test('EXW、FOB、CIF、关税、VAT 与 DDP 逐项可复算', () => {
  const result = calculateTradeQuote({
    basePriceCny: 100,
    markupPercent: 10,
    spotRate: 2,
    rateBuffer: 0.2,
    domesticCostCny: 18,
    freightForeign: 10,
    insuranceForeign: 1,
    dutyPercent: 10,
    vatPercent: 20,
    taxableAdditionsForeign: 5,
    otherImportCostForeign: 3,
  })

  assert.equal(result.effectiveRate, 1.8)
  assert.ok(Math.abs(result.salePriceCny - 110) < 1e-8)
  assert.ok(Math.abs(result.exw - 61.1111111111) < 1e-8)
  assert.ok(Math.abs(result.fob - 71.1111111111) < 1e-8)
  assert.ok(Math.abs(result.cif - 82.1111111111) < 1e-8)
  assert.ok(Math.abs(result.duty - 8.2111111111) < 1e-8)
  assert.ok(Math.abs(result.vatBase - 95.3222222222) < 1e-8)
  assert.ok(Math.abs(result.vat - 19.0644444444) < 1e-8)
  assert.ok(Math.abs(result.ddp - 112.3866666667) < 1e-8)
})

test('未输入税率与官方明确零税率严格区分', () => {
  const base = {
    basePriceCny: 100,
    markupPercent: 0,
    spotRate: 2,
    rateBuffer: 0,
    domesticCostCny: 0,
    freightForeign: 0,
    insuranceForeign: 0,
    taxableAdditionsForeign: 0,
    otherImportCostForeign: 0,
  }
  const pending = calculateTradeQuote({ ...base, dutyPercent: null, vatPercent: null })
  assert.equal(pending.taxRatesEntered, false)
  assert.equal(pending.duty, null)
  assert.equal(pending.vat, null)
  assert.equal(pending.ddp, null)

  const verifiedZero = calculateTradeQuote({ ...base, dutyPercent: 0, vatPercent: 0 })
  assert.equal(verifiedZero.taxRatesEntered, true)
  assert.equal(verifiedZero.duty, 0)
  assert.equal(verifiedZero.vat, 0)
  assert.equal(verifiedZero.ddp, verifiedZero.cif)
})

test('负数和非有限税率被拒绝而不是静默降级为零', () => {
  const base = {
    basePriceCny: 100,
    markupPercent: 0,
    spotRate: 2,
    rateBuffer: 0,
    domesticCostCny: 0,
    freightForeign: 0,
    insuranceForeign: 0,
    taxableAdditionsForeign: 0,
    otherImportCostForeign: 0,
  }

  assert.throws(
    () => calculateTradeQuote({ ...base, dutyPercent: -1, vatPercent: 0 }),
    /关税率必须是有限且非负/,
  )
  assert.throws(
    () => calculateTradeQuote({ ...base, dutyPercent: 0, vatPercent: Infinity }),
    /VAT \/ 进口税率必须是有限且非负/,
  )
  assert.throws(
    () => calculateTradeQuote({ ...base, dutyPercent: Number.NaN, vatPercent: 0 }),
    /关税率必须是有限且非负/,
  )
  assert.throws(
    () => calculateTradeQuote({ ...base, dutyPercent: /** @type {any} */ ('0'), vatPercent: 0 }),
    /关税率必须是有限且非负/,
  )
})

test('HS 去掉合法分隔点后必须是 6 至 14 位纯数字', () => {
  assert.equal(normalizeHsCode('8701.90'), '870190')
  assert.equal(isValidHsCode('8701.90.10'), true)
  assert.equal(isValidHsCode('123456'), true)
  assert.equal(isValidHsCode('......'), false)
  assert.equal(isValidHsCode('12345.'), false)
  assert.equal(isValidHsCode('12..3456'), false)
  assert.equal(isValidHsCode('.123456'), false)
  assert.equal(isValidHsCode('12345'), false)
  assert.equal(isValidHsCode('123456789012345'), false)
})

test('匹配支持选中方和反向关系，但必须通过主机与整体属具角色门禁', () => {
  const products = [
    { id: 'TR', role: 'tractor', name: '25 hp 拖拉机', compatibleWith: ['PTO', 'REMOTE', 'CLUTCH'] },
    { id: 'PTO', role: 'tractor-implement', name: '三点悬挂 PTO 割草属具', compatibleWith: [] },
    { id: 'REMOTE', role: 'self-propelled-machine', name: '25 hp 遥控割草整机', compatibleWith: [] },
    { id: 'CLUTCH', role: 'spare-part', name: '离合器整套', compatibleWith: [] },
    { id: 'BELT', role: 'spare-part', name: '刀轴皮带', compatibleWith: ['TR'] },
    { id: 'MOTOR', role: 'spare-part', name: '驱动电机', compatibleWith: ['TR'] },
  ]

  assert.deepEqual(findBidirectionalMatches(products, 'TR').map((item) => item.id), ['PTO'])
  assert.deepEqual(findBidirectionalMatches(products, 'PTO').map((item) => item.id), ['TR'])
  assert.deepEqual(findBidirectionalMatches(products, 'REMOTE'), [])
  assert.deepEqual(findBidirectionalMatches(products, 'CLUTCH'), [])
  assert.deepEqual(findBidirectionalMatches(products, 'BELT'), [])
  assert.deepEqual(findBidirectionalMatches(products, 'MOTOR'), [])
  assert.deepEqual(findBidirectionalMatches(products, 'missing'), [])
})

test('挖掘机只保留对应整体属具，反向匹配也排除发动机和履带备件', () => {
  const products = [
    { id: 'EX', role: 'excavator', compatibleWith: ['AUGER', 'ENGINE', 'TRACK'] },
    { id: 'AUGER', role: 'excavator-attachment', compatibleWith: [] },
    { id: 'ENGINE', role: 'spare-part', compatibleWith: [] },
    { id: 'TRACK', role: 'spare-part', compatibleWith: ['EX'] },
  ]

  assert.deepEqual(findBidirectionalMatches(products, 'EX').map((item) => item.id), ['AUGER'])
  assert.deepEqual(findBidirectionalMatches(products, 'AUGER').map((item) => item.id), ['EX'])
  assert.deepEqual(findBidirectionalMatches(products, 'TRACK'), [])
  assert.equal(isAllowedCompatibilityRolePair('tractor', 'tractor-implement'), true)
  assert.equal(isAllowedCompatibilityRolePair('excavator-attachment', 'excavator'), true)
  assert.equal(isAllowedCompatibilityRolePair('tractor', 'self-propelled-machine'), false)
  assert.equal(isAllowedCompatibilityRolePair('excavator', 'spare-part'), false)
  assert.equal(isAllowedCompatibilityRolePair(undefined, 'tractor'), false)
})
