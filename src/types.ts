export type ProductKind = 'tractor' | 'implement' | 'excavator'

/**
 * 产品角色是匹配安全边界，与用于目录筛选的 kind 分开。
 * 自走整机和备件可以进入目录，但不能被当作拖拉机/挖掘机属具。
 */
export type ProductRole =
  | 'tractor'
  | 'tractor-implement'
  | 'excavator'
  | 'excavator-attachment'
  | 'self-propelled-machine'
  | 'spare-part'

export type ProductParameterPrimitive = string | number | boolean | null

export interface ProductParameterValueObject {
  value?: ProductParameterValue
  name?: ProductParameterValue
  text?: ProductParameterValue
  label?: ProductParameterValue
  selectedValues?: ProductParameterValue[]
  values?: ProductParameterValue[]
  items?: ProductParameterValue[]
  options?: ProductParameterValue[]
  selected?: boolean
  checked?: boolean
}

export type ProductParameterValue =
  | ProductParameterPrimitive
  | ProductParameterValue[]
  | ProductParameterValueObject

export interface ProductParameter {
  keyZh: string
  keyEn: string
  value: ProductParameterValue
  sourceZh?: string
  evidenceKind?: 'structured' | 'description-candidate'
}

export interface ProductSize {
  lengthMm: number
  widthMm: number
  heightMm: number
}

export interface DemoProduct {
  id: string
  kind: ProductKind
  role: ProductRole
  nameZh: string
  nameEn: string
  model: string
  productCode: string
  categoryZh: string
  hsCandidate: string
  basePriceCny: number
  unitZh: string
  image: string
  /** 仅可填写已确认归属于同一演示产品的本地 SVG 候选。 */
  imageFallbacks?: string[]
  summaryZh: string
  summaryEn: string
  machine: {
    size: ProductSize
    weightKg: number
  }
  packaging: {
    size: ProductSize
    weightKg: number
    volumeCbm: number
  }
  parameters: ProductParameter[]
  compatibleWith: string[]
}

export interface QuoteInputs {
  basePriceCny: number
  markupPercent: number
  spotRate: number
  rateBuffer: number
  domesticCostCny: number
  freightForeign: number
  insuranceForeign: number
  /** null means no official evidence has been entered; numeric 0 is an explicit zero rate. */
  dutyPercent: number | null
  vatPercent: number | null
  taxableAdditionsForeign: number
  otherImportCostForeign: number
}

export interface QuoteResult {
  effectiveRate: number
  salePriceCny: number
  grossProfitCny: number
  grossMarginPercent: number
  exw: number
  fob: number
  cif: number
  taxRatesEntered: boolean
  duty: number | null
  vatBase: number | null
  vat: number | null
  taxes: number | null
  ddp: number | null
}

export interface TaxEvidenceContext {
  originCountry: string
  destinationCountry: string
  hsCode: string
}
