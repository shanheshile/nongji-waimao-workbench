import { useMemo, useState } from 'react'
import { demoProducts, productKindLabels } from './data/demo-products'
import { calculateTradeQuote, findBidirectionalMatches, isValidHsCode, isValidTaxRate } from './lib/calculator.js'
import { formatMoney, formatNumber, formatSize } from './lib/format'
import { buildParameterDisplayRows, normalizeParameterFields } from './lib/product-parameter-view.js'
import type { DemoProduct, ProductKind, QuoteInputs, QuoteResult, TaxEvidenceContext } from './types'

type View = 'products' | 'quote' | 'tax'
type ParameterView = 'compact' | 'zh' | 'original'

const currencyOptions = ['USD', 'EUR', 'GBP', 'CNY'] as const

const initialQuote: QuoteInputs = {
  basePriceCny: demoProducts[0].basePriceCny,
  markupPercent: 10,
  spotRate: 7.2,
  rateBuffer: 0.2,
  domesticCostCny: 3000,
  freightForeign: 1200,
  insuranceForeign: 80,
  dutyPercent: null,
  vatPercent: null,
  taxableAdditionsForeign: 0,
  otherImportCostForeign: 0,
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  step = 'any',
}: {
  label: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  hint?: string
  min?: number
  step?: number | 'any'
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-with-suffix">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span>{suffix}</span> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

function OptionalNumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  step = 'any',
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  suffix?: string
  hint?: string
  min?: number
  step?: number | 'any'
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-with-suffix">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          step={step}
          placeholder="待输入"
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        />
        {suffix ? <span>{suffix}</span> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

function DemoBadge() {
  return <span className="demo-badge">DEMO 虚构数据</span>
}

function ProductCard({
  product,
  active,
  onSelect,
}: {
  product: DemoProduct
  active: boolean
  onSelect: () => void
}) {
  return (
    <button className={`product-card ${active ? 'active' : ''}`} onClick={onSelect}>
      <img src={product.image} alt={`${product.nameZh}的演示占位图`} />
      <span className="product-card-copy">
        <span className="eyebrow">{product.categoryZh}</span>
        <strong>{product.nameZh}</strong>
        <span>{product.model}</span>
        <small>{formatMoney(product.basePriceCny)} · 演示底价</small>
      </span>
    </button>
  )
}

function ParameterPreview({ product }: { product: DemoProduct }) {
  const [mode, setMode] = useState<ParameterView>('compact')
  const fields = useMemo(() => normalizeParameterFields(product.parameters), [product.parameters])
  const rows = useMemo(() => buildParameterDisplayRows(product.parameters), [product.parameters])

  return (
    <section className="detail-section">
      <div className="section-heading inline-heading">
        <div>
          <span className="eyebrow">双语数据</span>
          <h3>产品参数预览</h3>
          <p>数组、多选和嵌套值逐项保留；相同参数的不同来源不互相覆盖。</p>
        </div>
        <div className="segmented" aria-label="参数显示方式">
          {(
            [
              ['compact', '简洁'],
              ['zh', '中文'],
              ['original', '原版'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={mode === key ? 'active' : ''}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'compact' ? (
        <div className="parameter-chips">
          {rows.map((row) => (
            <span key={row.keyZh} className={row.hasConflict ? 'has-conflict' : ''}>
              <b>{row.keyZh}</b> {row.displayValues.join('；')}
              {row.hasConflict ? ' · 冲突待核验' : row.hasPending ? ' · 待确认' : ''}
            </span>
          ))}
        </div>
      ) : mode === 'zh' ? (
        <dl className="parameter-list">
          {rows.map((row) => (
            <div key={row.keyZh} className={row.hasConflict ? 'has-conflict' : ''}>
              <dt>
                {row.keyZh}
                {row.multiValue ? <span className="parameter-badge">多值 {row.displayValues.length} 项</span> : null}
                {row.hasConflict ? <span className="parameter-badge conflict">冲突待核验</span> : null}
                {row.hasPending ? <span className="parameter-badge pending">待确认</span> : null}
              </dt>
              <dd>
                <strong>{row.displayValues.join('；')}</strong>
                <span className="parameter-evidence">
                  {row.evidence.map((item) => (
                    <small key={`${item.fieldIndex}-${item.valueIndex}`}>
                      {item.display} · {item.sourceZh}
                      {item.evidenceKind === 'description-candidate' ? '（说明候选）' : '（结构化）'}
                    </small>
                  ))}
                </span>
                {row.hasConflict ? <em>同一参数存在不同来源值，已全部保留，请回到原始资料核验。</em> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="parameter-list original-parameter-list">
          {fields.map((field) => (
            <div key={`${field.fieldIndex}-${field.keyEn}`}>
              <dt>{field.keyEn}</dt>
              <dd>
                <strong>{field.values.map((item) => item.display).join('；')}</strong>
                <span className="parameter-evidence">
                  <small>{field.sourceZh} · 原始字段 {field.fieldIndex + 1}</small>
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function ProductWorkspace({
  selected,
  setSelected,
  onQuote,
}: {
  selected: DemoProduct
  setSelected: (product: DemoProduct) => void
  onQuote: (product: DemoProduct) => void
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ProductKind | 'all'>('all')
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  const filtered = demoProducts.filter((product) => {
    const matchesKind = kind === 'all' || product.kind === kind
    const haystack = [
      product.nameZh,
      product.nameEn,
      product.model,
      product.productCode,
      product.categoryZh,
      product.hsCandidate,
    ]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
    return matchesKind && (!normalized || haystack.includes(normalized))
  })
  const matches = findBidirectionalMatches(demoProducts, selected.id) as DemoProduct[]

  return (
    <div className="workspace-grid">
      <aside className="catalog-panel" aria-label="演示产品目录">
        <div className="search-box">
          <label htmlFor="product-search">搜索产品、型号、编码或 HS 候选</label>
          <input
            id="product-search"
            type="search"
            value={query}
            placeholder="例如：拖拉机、RT-165-D"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filter-row" aria-label="产品类型筛选">
          <button className={kind === 'all' ? 'active' : ''} onClick={() => setKind('all')}>
            全部
          </button>
          {(Object.keys(productKindLabels) as ProductKind[]).map((key) => (
            <button className={kind === key ? 'active' : ''} key={key} onClick={() => setKind(key)}>
              {productKindLabels[key]}
            </button>
          ))}
        </div>
        <div className="product-list">
          {filtered.length ? (
            filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                active={product.id === selected.id}
                onSelect={() => setSelected(product)}
              />
            ))
          ) : (
            <p className="empty-state">没有匹配的演示产品。</p>
          )}
        </div>
      </aside>

      <article className="product-detail">
        <div className="product-hero">
          <div className="hero-image">
            <img src={selected.image} alt={`${selected.nameZh}的自制演示占位图`} />
            <span>自制 SVG 占位素材</span>
          </div>
          <div className="hero-copy">
            <div className="badge-row">
              <DemoBadge />
              <span className="status-badge">本地数据</span>
            </div>
            <span className="eyebrow">{selected.categoryZh}</span>
            <h2>{selected.nameZh}</h2>
            <p className="english-name">{selected.nameEn}</p>
            <p>{selected.summaryZh}</p>
            <div className="identity-grid">
              <span><small>型号</small><b>{selected.model}</b></span>
              <span><small>演示编码</small><b>{selected.productCode}</b></span>
              <span><small>HS 候选</small><b>{selected.hsCandidate}</b></span>
              <span><small>本地演示 ID</small><b>{selected.id}</b></span>
            </div>
            <button className="primary-button" onClick={() => onQuote(selected)}>
              用此产品试算报价
            </button>
          </div>
        </div>

        <section className="detail-section evidence-panel">
          <div className="section-heading">
            <span className="eyebrow">字段边界</span>
            <h3>数据证据（演示）</h3>
          </div>
          <div className="evidence-grid">
            <div>
              <strong>机器本体</strong>
              <p>外形尺寸：{formatSize(selected.machine.size)}</p>
              <p>机器重量：{formatNumber(selected.machine.weightKg, 0)} kg</p>
            </div>
            <div>
              <strong>出口包装</strong>
              <p>包装尺寸：{formatSize(selected.packaging.size)}</p>
              <p>包装重量：{formatNumber(selected.packaging.weightKg, 0)} kg</p>
              <p>包装方数：{formatNumber(selected.packaging.volumeCbm)} CBM</p>
            </div>
            <div>
              <strong>价格口径</strong>
              <p>人民币底价：{formatMoney(selected.basePriceCny)}</p>
              <p>来源：本项目虚构演示数据</p>
              <p>时间：无真实取数时间</p>
            </div>
          </div>
          <p className="warning-line">
            以上尺寸、重量、价格、HS 候选均为虚构样例，不得用于成交、报关、物流订舱或合规结论。
          </p>
        </section>

        <section className="detail-section">
          <div className="section-heading">
            <span className="eyebrow">关系演示</span>
            <h3>双向匹配</h3>
            <p>拖拉机可找农机具，农机具可反查拖拉机；挖掘机与属具同样双向关联。</p>
          </div>
          {matches.length ? (
            <div className="match-grid">
              {matches.map((product) => (
                <button key={product.id} onClick={() => setSelected(product)}>
                  <img src={product.image} alt="" />
                  <span><b>{product.nameZh}</b><small>{product.model}</small></span>
                  <i>查看 →</i>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-state">此虚构产品暂未建立匹配关系。</p>
          )}
        </section>

        <ParameterPreview product={selected} />
      </article>
    </div>
  )
}

function QuoteWorkspace({
  selected,
  quote,
  setQuote,
  currency,
  setCurrency,
  result,
  calculationError,
  taxEvidenceComplete,
}: {
  selected: DemoProduct
  quote: QuoteInputs
  setQuote: (next: QuoteInputs) => void
  currency: string
  setCurrency: (next: string) => void
  result: QuoteResult | null
  calculationError: string
  taxEvidenceComplete: boolean
}) {
  const update = (field: keyof QuoteInputs, value: number) => setQuote({ ...quote, [field]: value })

  return (
    <div className="quote-layout">
      <section className="quote-card sticky-card">
        <div className="section-heading">
          <span className="eyebrow">输入后即时计算 · 不联网</span>
          <h2>人民币底价 + 可选交易币种</h2>
          <p>{selected.nameZh} · {selected.model}</p>
        </div>
        <div className="form-grid">
          <NumberField
            label="人民币底价（可手动试填）"
            value={quote.basePriceCny}
            min={0}
            suffix="CNY"
            onChange={(value) => update('basePriceCny', value)}
          />
          <NumberField
            label="手动利润加价率"
            value={quote.markupPercent}
            suffix="%"
            step={0.1}
            onChange={(value) => update('markupPercent', value)}
            hint="这是成本加价率，不等于实际毛利率"
          />
          <label className="field">
            <span className="field-label">试算币种</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {currencyOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <small>币种仅改变显示符号，不提供实时汇率</small>
          </label>
          <NumberField
            label="市场汇率（手动输入）"
            value={quote.spotRate}
            min={0}
            step={0.0001}
            suffix={`CNY/${currency}`}
            onChange={(value) => update('spotRate', value)}
          />
          <NumberField
            label="汇率差额"
            value={quote.rateBuffer}
            min={0}
            step={0.0001}
            suffix={`CNY/${currency}`}
            onChange={(value) => update('rateBuffer', value)}
            hint="有效汇率 = 市场汇率 − 汇率差额"
          />
          <div className="live-rate">
            <span>当前有效汇率</span>
            <strong>{result ? formatNumber(result.effectiveRate, 4) : '不可计算'}</strong>
            <small>CNY/{currency}</small>
          </div>
        </div>
        {calculationError ? <p className="error-message">{calculationError}</p> : null}
        <div className="live-price">
          <span>利润参数价</span>
          <strong>{result ? formatMoney(result.salePriceCny, 'CNY') : '—'}</strong>
          <small>
            {result
              ? `成本差额 ${formatMoney(result.grossProfitCny)} · 对售价毛利率 ${formatNumber(result.grossMarginPercent)}%`
              : '请修正输入'}
          </small>
        </div>
      </section>

      <section className="quote-card">
        <div className="section-heading">
          <span className="eyebrow">Incoterms 2020 结构化试算</span>
          <h2>EXW / FOB / CIF / DDP</h2>
          <p>费用边界是简化演示，正式报价必须按合同、港口、货代与官方税费证据复核。</p>
        </div>
        <div className="form-grid compact-form">
          <NumberField label="国内出口费用" value={quote.domesticCostCny} min={0} suffix="CNY" onChange={(value) => update('domesticCostCny', value)} />
          <NumberField label="国际运费" value={quote.freightForeign} min={0} suffix={currency} onChange={(value) => update('freightForeign', value)} />
          <NumberField label="保险费" value={quote.insuranceForeign} min={0} suffix={currency} onChange={(value) => update('insuranceForeign', value)} />
          <NumberField label="其他进口侧费用" value={quote.otherImportCostForeign} min={0} suffix={currency} onChange={(value) => update('otherImportCostForeign', value)} />
        </div>
        <div className="terms-grid">
          {result ? (
            <>
              <div><span>EXW</span><strong>{formatMoney(result.exw, currency)}</strong><small>机器利润参数价</small></div>
              <div><span>FOB</span><strong>{formatMoney(result.fob, currency)}</strong><small>EXW + 国内出口费用</small></div>
              <div><span>CIF</span><strong>{formatMoney(result.cif, currency)}</strong><small>FOB + 运费 + 保险</small></div>
              <div className="highlight"><span>DDP 公式演示</span><strong>{taxEvidenceComplete && result.ddp !== null ? formatMoney(result.ddp, currency) : '待补官方税费证据'}</strong><small>{taxEvidenceComplete ? 'CIF + 已输入税费 + 其他进口费用' : '需完整原产国、目的国、HS、关税率与 VAT 税率'}</small></div>
            </>
          ) : <p className="empty-state">汇率输入无效，暂不计算。</p>}
        </div>
        <div className="formula-note">
          <b>这不是对客报价：</b>包装费、港杂、清关、派送、认证、反倾销、非从价税等可能尚未包含；本页不保存输入。
        </div>
      </section>
    </div>
  )
}

function TaxWorkspace({
  selected,
  quote,
  setQuote,
  taxContext,
  setTaxContext,
  currency,
  result,
}: {
  selected: DemoProduct
  quote: QuoteInputs
  setQuote: (next: QuoteInputs) => void
  taxContext: TaxEvidenceContext
  setTaxContext: (next: TaxEvidenceContext) => void
  currency: string
  result: QuoteResult | null
}) {
  const updateTaxRate = (field: 'dutyPercent' | 'vatPercent', value: number | null) => setQuote({ ...quote, [field]: value })
  const updateContext = (field: keyof TaxEvidenceContext, value: string) => {
    if (taxContext[field] !== value && (quote.dutyPercent !== null || quote.vatPercent !== null)) {
      setQuote({ ...quote, dutyPercent: null, vatPercent: null })
    }
    setTaxContext({ ...taxContext, [field]: value })
  }
  const contextComplete = /^[A-Z]{2}$/.test(taxContext.originCountry)
    && /^[A-Z]{2}$/.test(taxContext.destinationCountry)
    && isValidHsCode(taxContext.hsCode)
  const taxEvidenceComplete = contextComplete
    && isValidTaxRate(quote.dutyPercent)
    && isValidTaxRate(quote.vatPercent)

  return (
    <div className="tax-layout">
      <section className="quote-card">
        <div className="section-heading">
          <span className="eyebrow">任意目的国 · 人工证据输入</span>
          <h2>HS / 关税 / VAT 辅助公式</h2>
          <p>系统不内置国家税率；空值表示尚未核验，只有人工显式输入 0 才表示官方结果为零。</p>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">产品</span>
            <input value={`${selected.nameZh} · ${selected.model}`} readOnly />
          </label>
          <label className="field">
            <span className="field-label">HS 候选（可修改）</span>
            <input value={taxContext.hsCode} onChange={(event) => updateContext('hsCode', event.target.value.trim())} />
            <small>候选不等于目的国完整税号；可用点分隔，去点后须为 6–14 位数字，并向官方系统复核</small>
          </label>
          <label className="field">
            <span className="field-label">原产国 ISO 代码</span>
            <input maxLength={2} value={taxContext.originCountry} onChange={(event) => updateContext('originCountry', event.target.value.toUpperCase())} />
          </label>
          <label className="field">
            <span className="field-label">目的国 ISO 代码</span>
            <input maxLength={2} placeholder="例如：输入两位国家代码" value={taxContext.destinationCountry} onChange={(event) => updateContext('destinationCountry', event.target.value.toUpperCase())} />
            <small>可填写任意具体目的国；不能只填某个关税区名称</small>
          </label>
          <OptionalNumberField
            label="关税率（官方证据值）"
            value={quote.dutyPercent}
            min={0}
            suffix="%"
            step={0.01}
            onChange={(value) => updateTaxRate('dutyPercent', value)}
            hint="留空表示未核验；仅在官方明确为零时输入 0"
          />
          <OptionalNumberField
            label="VAT / 进口税率（官方证据值）"
            value={quote.vatPercent}
            min={0}
            suffix="%"
            step={0.01}
            onChange={(value) => updateTaxRate('vatPercent', value)}
            hint="留空表示未核验；输入 0 表示已明确核验为零"
          />
          <NumberField
            label="VAT 其他应税加项"
            value={quote.taxableAdditionsForeign}
            min={0}
            suffix={currency}
            onChange={(value) => setQuote({ ...quote, taxableAdditionsForeign: value })}
          />
        </div>
        <div className="context-strip">
          <span>原产国：<b>{taxContext.originCountry || '待填'}</b></span>
          <span>目的国：<b>{taxContext.destinationCountry || '待填'}</b></span>
          <span>HS：<b>{taxContext.hsCode || '待填'}</b></span>
          <DemoBadge />
        </div>
      </section>

      <section className="quote-card tax-results">
        <div className="section-heading">
          <span className="eyebrow">公式透明</span>
          <h2>税费拆分</h2>
        </div>
        {result && taxEvidenceComplete && result.duty !== null && result.vatBase !== null && result.vat !== null && result.taxes !== null ? (
          <div className="calculation-table">
            <div><span>示例海关计税基础</span><b>{formatMoney(result.cif, currency)}</b><small>本 DEMO 暂以 CIF 试算值代入</small></div>
            <div><span>关税</span><b>{formatMoney(result.duty, currency)}</b><small>CIF × 关税率</small></div>
            <div><span>VAT 计税基础</span><b>{formatMoney(result.vatBase, currency)}</b><small>CIF + 关税 + 其他应税加项</small></div>
            <div><span>VAT / 进口税</span><b>{formatMoney(result.vat, currency)}</b><small>VAT 计税基础 × VAT 税率</small></div>
            <div className="total-row"><span>演示税费合计</span><b>{formatMoney(result.taxes, currency)}</b><small>关税 + VAT；不代表全部进口费用</small></div>
          </div>
        ) : <p className="error-message">已阻断税费与 DDP 计算：请填写合法原产国、具体目的国、去点后 6–14 位纯数字 HS，并逐项输入有限且非负的已核验关税率与 VAT / 进口税率；官方明确为零时应显式输入 0。</p>}
        <div className="warning-box">
          <strong>正式业务前必须补齐</strong>
          <ul>
            <li>目的国完整税号、申报日期、原产地待遇和具体官方结果页面；</li>
            <li>反倾销、保障措施、配额、消费税、州税或地方税、非从价税；</li>
            <li>清关代理费、港杂、仓储、查验、末端派送及税费承担方；</li>
            <li>税费公式和计税基础应由报关行或当地专业人士复核。</li>
          </ul>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('products')
  const [selected, setSelected] = useState(demoProducts[0])
  const [currency, setCurrency] = useState('USD')
  const [quote, setQuote] = useState<QuoteInputs>(initialQuote)
  const [taxContext, setTaxContext] = useState<TaxEvidenceContext>({
    originCountry: 'CN',
    destinationCountry: '',
    hsCode: demoProducts[0].hsCandidate,
  })

  const calculation = useMemo(() => {
    try {
      return {
        result: calculateTradeQuote(quote) as QuoteResult,
        error: '',
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : '输入无法计算',
      }
    }
  }, [quote])

  const taxEvidenceComplete = /^[A-Z]{2}$/.test(taxContext.originCountry)
    && /^[A-Z]{2}$/.test(taxContext.destinationCountry)
    && isValidHsCode(taxContext.hsCode)
    && isValidTaxRate(quote.dutyPercent)
    && isValidTaxRate(quote.vatPercent)

  const selectProduct = (product: DemoProduct) => {
    setSelected(product)
    setQuote((current) => ({
      ...current,
      basePriceCny: product.basePriceCny,
      dutyPercent: null,
      vatPercent: null,
    }))
    setTaxContext((current) => ({ ...current, hsCode: product.hsCandidate }))
  }

  const startQuote = (product: DemoProduct) => {
    selectProduct(product)
    setView('quote')
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus())
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">农</span>
          <span><strong>农机外贸工作台</strong><small>中文开源演示版</small></span>
        </div>
        <nav aria-label="主要导航">
          <button className={view === 'products' ? 'active' : ''} onClick={() => setView('products')}>产品中心</button>
          <button className={view === 'quote' ? 'active' : ''} onClick={() => setView('quote')}>报价试算</button>
          <button className={view === 'tax' ? 'active' : ''} onClick={() => setView('tax')}>HS 与税费</button>
        </nav>
        <a className="source-link" href="https://github.com/shanheshile/nongji-waimao-workbench" target="_blank" rel="noreferrer">开源项目</a>
      </header>

      <div className="safety-banner" role="status">
        <b>纯本地 DEMO</b>
        <span>不登录 · 不保存密码 · 不连接生产系统 · 不包含真实产品、客户、价格或素材</span>
      </div>

      <main id="main-content" tabIndex={-1}>
        <div className="page-intro">
          <div>
            <span className="eyebrow">Nongji Waimao Workbench</span>
            <h1>{view === 'products' ? '产品检索与双向匹配' : view === 'quote' ? '实时响应的报价试算' : '关税与进口税费公式辅助'}</h1>
          </div>
          <div className="privacy-pill"><span aria-hidden="true">●</span> 离线演示数据</div>
        </div>

        {view === 'products' ? (
          <ProductWorkspace selected={selected} setSelected={selectProduct} onQuote={startQuote} />
        ) : view === 'quote' ? (
          <QuoteWorkspace
            selected={selected}
            quote={quote}
            setQuote={setQuote}
            currency={currency}
            setCurrency={setCurrency}
            result={calculation.result}
            calculationError={calculation.error}
            taxEvidenceComplete={taxEvidenceComplete}
          />
        ) : (
          <TaxWorkspace
            selected={selected}
            quote={quote}
            setQuote={setQuote}
            taxContext={taxContext}
            setTaxContext={setTaxContext}
            currency={currency}
            result={calculation.result}
          />
        )}
      </main>

      <footer>
        <p>Apache-2.0 开源 · 所有业务数据均为虚构 DEMO · 正式成交与报关必须重新核验</p>
      </footer>
    </>
  )
}
