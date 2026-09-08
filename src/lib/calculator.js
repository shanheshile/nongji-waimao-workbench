/** @typedef {import('../types').QuoteInputs} QuoteInputs */
/** @typedef {import('../types').QuoteResult} QuoteResult */

/**
 * 仅为现有外部演示调用保留的通用数值转换函数。
 * 报价输入不得使用该函数降级，必须经下方严格校验。
 * @param {unknown} value
 * @param {number} [fallback]
 */
export function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 报价金额、汇率与加价率必须是显式传入的有限非负 number。
 * 禁止把空值、字符串、NaN、Infinity 或负数静默转换为 0。
 * @param {unknown} value
 * @param {string} label
 */
function validatedNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label}必须是有限且非负的数值`)
  }
  return value
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
  const validatedSpotRate = validatedNonNegativeNumber(spotRate, '市场汇率')
  const validatedRateBuffer = validatedNonNegativeNumber(rateBuffer, '汇率差额')
  const effective = validatedSpotRate - validatedRateBuffer
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
  const basePriceCny = validatedNonNegativeNumber(raw.basePriceCny, '人民币底价')
  const markupPercent = validatedNonNegativeNumber(raw.markupPercent, '利润加价率')
  const effectiveRate = getEffectiveRate(raw.spotRate, raw.rateBuffer)
  const domesticCostCny = validatedNonNegativeNumber(raw.domesticCostCny, '国内出口费用')
  const freightForeign = validatedNonNegativeNumber(raw.freightForeign, '国际运费')
  const insuranceForeign = validatedNonNegativeNumber(raw.insuranceForeign, '保险费')
  const dutyPercent = validatedOptionalTaxRate(raw.dutyPercent, '关税率')
  const vatPercent = validatedOptionalTaxRate(raw.vatPercent, 'VAT / 进口税率')
  const taxRatesEntered = dutyPercent !== null && vatPercent !== null
  const taxableAdditionsForeign = validatedNonNegativeNumber(raw.taxableAdditionsForeign, '其他应税加项')
  const otherImportCostForeign = validatedNonNegativeNumber(raw.otherImportCostForeign, '其他进口侧费用')

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

  const calculatedValues = [salePriceCny, grossProfitCny, grossMarginPercent, exw, fob, cif, duty, vatBase, vat, taxes, ddp]
  if (calculatedValues.some((value) => value !== null && !Number.isFinite(value))) {
    throw new RangeError('输入数值过大，报价结果无法表示')
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

const allowedCompatibilityRolePairs = new Set([
  'tractor:tractor-implement',
  'tractor-implement:tractor',
  'excavator:excavator-attachment',
  'excavator-attachment:excavator',
])

/**
 * 只有主机与对应整体属具可以匹配。显式排除自走整机和备件；
 * 未提供角色时也安全地不匹配，不用名称、马力或类目猜测。
 * @param {unknown} leftRole
 * @param {unknown} rightRole
 */
export function isAllowedCompatibilityRolePair(leftRole, rightRole) {
  if (typeof leftRole !== 'string' || typeof rightRole !== 'string') return false
  return allowedCompatibilityRolePairs.has(`${leftRole}:${rightRole}`)
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
    const relationExists = (
      selected.compatibleWith.includes(candidate.id) ||
      candidate.compatibleWith.includes(selected.id)
    )
    return relationExists && isAllowedCompatibilityRolePair(selected.role, candidate.role)
  })
}
