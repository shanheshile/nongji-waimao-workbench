/** @typedef {import('../types').ProductParameter} ProductParameter */
/** @typedef {import('../types').ProductParameterValue} ProductParameterValue */

/**
 * @typedef {object} ParameterValueEvidence
 * @property {string} display
 * @property {boolean} missing
 * @property {string} sourceZh
 * @property {'structured' | 'description-candidate'} evidenceKind
 * @property {number} fieldIndex
 * @property {number} valueIndex
 */

/**
 * @typedef {object} NormalizedParameterField
 * @property {string} keyZh
 * @property {string} keyEn
 * @property {string} sourceZh
 * @property {'structured' | 'description-candidate'} evidenceKind
 * @property {number} fieldIndex
 * @property {ParameterValueEvidence[]} values
 */

/**
 * @typedef {object} ParameterDisplayRow
 * @property {string} keyZh
 * @property {string} keyEn
 * @property {string[]} displayValues
 * @property {ParameterValueEvidence[]} evidence
 * @property {boolean} multiValue
 * @property {boolean} hasConflict
 * @property {boolean} hasPending
 */

const containerKeys = ['selectedValues', 'values', 'items', 'options']
const displayKeys = ['label', 'name', 'text', 'value']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {unknown} value */
function isEmptyValue(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/** @param {unknown} value */
function parseStructuredText(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed || !['[', '{'].includes(trimmed[0])) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

/**
 * @param {ProductParameterValue | undefined} value
 * @param {Set<object>} [ancestors]
 * @returns {(string | null)[]}
 */
function flattenParameterValue(value, ancestors = new Set()) {
  if (isEmptyValue(value)) return [null]

  const parsed = parseStructuredText(value)
  if (parsed !== value) return flattenParameterValue(/** @type {ProductParameterValue} */ (parsed), ancestors)

  if (typeof value === 'string') return [value.trim()]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    if (value.length === 0) return [null]
    return value.flatMap((item) => flattenParameterValue(item, ancestors))
  }
  if (!isRecord(value)) return [String(value)]
  if (ancestors.has(value)) return ['[循环引用待确认]']

  ancestors.add(value)
  try {
    for (const key of containerKeys) {
      const nested = value[key]
      if (!Array.isArray(nested)) continue
      let entries = nested
      if (key === 'options') {
        const hasSelectionFlags = nested.some((entry) => isRecord(entry) && ('selected' in entry || 'checked' in entry))
        if (hasSelectionFlags) {
          entries = nested.filter((entry) => isRecord(entry) && (entry.selected === true || entry.checked === true))
        }
      }
      if (entries.length === 0) return [null]
      return entries.flatMap((entry) => flattenParameterValue(/** @type {ProductParameterValue} */ (entry), ancestors))
    }

    const preferredKey = displayKeys.find((key) => !isEmptyValue(value[key]))
    if (preferredKey) {
      const preferred = flattenParameterValue(/** @type {ProductParameterValue} */ (value[preferredKey]), ancestors)
      const rawValue = preferredKey !== 'value' && !isEmptyValue(value.value)
        ? flattenParameterValue(/** @type {ProductParameterValue} */ (value.value), ancestors).filter(Boolean)
        : []
      if (rawValue.length === 1 && preferred.length === 1 && preferred[0] && rawValue[0] !== preferred[0]) {
        return [`${preferred[0]}（原值：${rawValue[0]}）`]
      }
      return preferred
    }

    const serialized = JSON.stringify(value)
    return serialized === '{}' ? [null] : [serialized]
  } finally {
    ancestors.delete(value)
  }
}

/**
 * @param {ProductParameter[]} parameters
 * @returns {NormalizedParameterField[]}
 */
export function normalizeParameterFields(parameters) {
  return parameters.map((parameter, fieldIndex) => {
    const sourceZh = parameter.sourceZh?.trim() || `虚构结构化字段 ${fieldIndex + 1}`
    const evidenceKind = parameter.evidenceKind === 'description-candidate'
      ? 'description-candidate'
      : 'structured'
    const flattened = flattenParameterValue(parameter.value)

    return {
      keyZh: parameter.keyZh.trim() || '未命名参数',
      keyEn: parameter.keyEn.trim() || parameter.keyZh.trim() || 'Unnamed parameter',
      sourceZh,
      evidenceKind,
      fieldIndex,
      values: flattened.map((item, valueIndex) => ({
        display: item ?? '待确认',
        missing: item === null,
        sourceZh,
        evidenceKind,
        fieldIndex,
        valueIndex,
      })),
    }
  })
}

/** @param {string} label */
function semanticKey(label) {
  return label.trim().replaceAll(/\s+/g, '').toLocaleLowerCase('zh-CN')
}

/** @param {NormalizedParameterField} field */
function fieldSignature(field) {
  return [...new Set(field.values.filter((item) => !item.missing).map((item) => item.display))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .join('\u0001')
}

/**
 * @param {ProductParameter[]} parameters
 * @returns {ParameterDisplayRow[]}
 */
export function buildParameterDisplayRows(parameters) {
  /** @type {Map<string, NormalizedParameterField[]>} */
  const groups = new Map()
  for (const field of normalizeParameterFields(parameters)) {
    const key = semanticKey(field.keyZh)
    const current = groups.get(key)
    if (current) current.push(field)
    else groups.set(key, [field])
  }

  return [...groups.values()].map((fields) => {
    const evidence = fields.flatMap((field) => field.values)
    const presentValues = evidence.filter((item) => !item.missing).map((item) => item.display)
    const signatures = new Set(fields.map(fieldSignature).filter(Boolean))
    return {
      keyZh: fields[0].keyZh,
      keyEn: fields[0].keyEn,
      displayValues: presentValues.length ? presentValues : ['待确认'],
      evidence,
      multiValue: presentValues.length > 1,
      hasConflict: signatures.size > 1,
      hasPending: evidence.some((item) => item.missing),
    }
  })
}
