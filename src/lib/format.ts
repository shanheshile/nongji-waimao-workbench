export function formatMoney(value: number, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatSize(size: { lengthMm: number; widthMm: number; heightMm: number }) {
  return `${size.lengthMm} × ${size.widthMm} × ${size.heightMm} mm`
}
