/**
 * 开源演示版只允许从 /assets/ 读取本地 SVG，避免远程跟踪、路径穿越
 * 或在加载失败时静默换成不相关产品图片。
 * @param {unknown} value
 */
export function isLocalDemoSvg(value) {
  if (typeof value !== 'string') return false
  const source = value.trim()
  if (!/^\/assets\/[a-z0-9][a-z0-9._/-]*\.svg$/i.test(source)) return false
  const segments = source.slice('/assets/'.length).split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * 候选顺序由数据维护者按精确产品归属提供。本函数只做本地路径校验和去重，
 * 不做型号模糊匹配，不搜索其他产品。
 * @param {unknown} primary
 * @param {unknown} fallbacks
 */
export function buildLocalImageCandidates(primary, fallbacks = []) {
  const values = [primary, ...(Array.isArray(fallbacks) ? fallbacks : [])]
  return [...new Set(values.filter(isLocalDemoSvg).map((value) => value.trim()))]
}

/**
 * @param {unknown} candidates
 * @param {unknown} index
 */
export function localImageCandidateAt(candidates, index) {
  if (!Array.isArray(candidates) || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  const candidate = candidates[index]
  return isLocalDemoSvg(candidate) ? candidate.trim() : null
}
