/** @typedef {import('../types').QuoteInputs} QuoteInputs */
/** @typedef {import('../types').QuoteResult} QuoteResult */

/**
 * @param {unknown} value
 * @param {number} [fallback]
 */
export function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 税率证据必须是显式输入的有限非负 number。尤其不能把空字符串、
 * Infinity、NaN 或负数经数值兜底静默解释为官方零税率。
 * @param {unknown} value
 */
export function isValidTaxRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * HS 可使用点分隔数字段；去掉这些分隔点后必须是 6 至 14 位纯数字。
 * @param {unknown} value
 */
export function normalizeHsCode(value) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:\.\d+)*$/.test(candidate)) return ''
  const digits = candidate.replaceAll('.', '')
  return /^\d{6,14}$/.test(digits) ? digits : ''
}

/** @param {unknown} value */
export function isValidHsCode(value) {
  return normalizeHsCode(value) !== ''
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number | null}
 */
function validatedOptionalTaxRate(value, label) {
  if (value === null || value === undefined) return null
  if (!isValidTaxRate(value)) {
    throw new RangeError(`${label}必须是有限且非负的数值；只有显式输入 0 才表示零税率`)
  }
  return /** @type {number} */ (value)
}

/**
 * 报价采用“即期汇率 - 汇率差额”作为有效汇率。
 * @param {number} spotRate
 * @param {number} rateBuffer
 */
export function getEffectiveRate(spotRate, rateBuffer) {
  const effective = finiteNumber(spotRate) - finiteNumber(rateBuffer)
  if (effective <= 0) {
    throw new RangeError('有效汇率必须大于 0')
  }
  return effective
}

/**
 * 公式演示，不包含目的国的非从价税、反倾销、港杂、代理费或真实清关规则。
 * @param {QuoteInputs} raw
 * @returns {QuoteResult}
 */
export function calculateTradeQuote(raw) {
  const basePriceCny = Math.max(0, finiteNumber(raw.basePriceCny))
  const markupPercent = finiteNumber(raw.markupPercent)
  const effectiveRate = getEffectiveRate(raw.spotRate, raw.rateBuffer)
  const domesticCostCny = Math.max(0, finiteNumber(raw.domesticCostCny))
  const freightForeign = Math.max(0, finiteNumber(raw.freightForeign))
  const insuranceForeign = Math.max(0, finiteNumber(raw.insuranceForeign))
  const dutyPercent = validatedOptionalTaxRate(raw.dutyPercent, '关税率')
  const vatPercent = validatedOptionalTaxRate(raw.vatPercent, 'VAT / 进口税率')
  const taxRatesEntered = dutyPercent !== null && vatPercent !== null
  const taxableAdditionsForeign = Math.max(0, finiteNumber(raw.taxableAdditionsForeign))
  const otherImportCostForeign = Math.max(0, finiteNumber(raw.otherImportCostForeign))

  const salePriceCny = basePriceCny * (1 + markupPercent / 100)
  const grossProfitCny = salePriceCny - basePriceCny
  const grossMarginPercent = salePriceCny > 0 ? (grossProfitCny / salePriceCny) * 100 : 0
  const exw = salePriceCny / effectiveRate
  const fob = (salePriceCny + domesticCostCny) / effectiveRate
  const cif = fob + freightForeign + insuranceForeign
  /** @type {number | null} */
  let duty = null
  /** @type {number | null} */
  let vatBase = null
  /** @type {number | null} */
  let vat = null
  /** @type {number | null} */
  let taxes = null
  /** @type {number | null} */
  let ddp = null
  if (taxRatesEntered) {
    duty = cif * (dutyPercent / 100)
    vatBase = cif + duty + taxableAdditionsForeign
    vat = vatBase * (vatPercent / 100)
    taxes = duty + vat
    ddp = cif + taxes + otherImportCostForeign
  }

  return {
    effectiveRate,
    salePriceCny,
    grossProfitCny,
    grossMarginPercent,
    exw,
    fob,
    cif,
    taxRatesEntered,
    duty,
    vatBase,
    vat,
    taxes,
    ddp,
  }
}

/**
 * @param {import('../types').DemoProduct[]} products
 * @param {string} productId
 */
export function findBidirectionalMatches(products, productId) {
  const selected = products.find((product) => product.id === productId)
  if (!selected) return []

  return products.filter((candidate) => {
    if (candidate.id === selected.id) return false
    return (
      selected.compatibleWith.includes(candidate.id) ||
      candidate.compatibleWith.includes(selected.id)
    )
  })
}
