import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildParameterDisplayRows,
  normalizeParameterFields,
} from '../src/lib/product-parameter-view.js'

test('数组、JSON 数组和嵌套多选全部保序展示并保留重复项', () => {
  const fields = normalizeParameterFields([
    {
      keyZh: '虚构配置甲',
      keyEn: 'Demo option A',
      value: ['甲', '乙', '甲'],
      sourceZh: '虚构数组字段',
    },
    {
      keyZh: '虚构配置乙',
      keyEn: 'Demo option B',
      value: '["一档", "二档"]',
      sourceZh: '虚构 JSON 字段',
    },
    {
      keyZh: '虚构配置丙',
      keyEn: 'Demo option C',
      value: {
        selectedValues: [
          { value: 'demo-a', label: '方案一' },
          { name: '方案二' },
        ],
      },
      sourceZh: '虚构嵌套字段',
    },
  ])

  assert.deepEqual(fields[0].values.map((item) => item.display), ['甲', '乙', '甲'])
  assert.deepEqual(fields[1].values.map((item) => item.display), ['一档', '二档'])
  assert.deepEqual(fields[2].values.map((item) => item.display), ['方案一（原值：demo-a）', '方案二'])
  assert.deepEqual(fields.map((field) => field.sourceZh), ['虚构数组字段', '虚构 JSON 字段', '虚构嵌套字段'])
})

test('options 存在选择标记时只展示已选项，未标记时完整展示发布值', () => {
  const selected = normalizeParameterFields([{
    keyZh: '虚构选项',
    keyEn: 'Demo options',
    value: {
      options: [
        { label: '已选甲', selected: true },
        { label: '未选乙', selected: false },
        { label: '已选丙', checked: true },
      ],
    },
  }])[0]
  const published = normalizeParameterFields([{
    keyZh: '虚构发布值',
    keyEn: 'Demo published values',
    value: { options: ['甲', '乙'] },
  }])[0]

  assert.deepEqual(selected.values.map((item) => item.display), ['已选甲', '已选丙'])
  assert.deepEqual(published.values.map((item) => item.display), ['甲', '乙'])
})

test('同一字段内多值不是冲突，不同来源异值全部保留并中文提示冲突', () => {
  const rows = buildParameterDisplayRows([
    {
      keyZh: '虚构速度',
      keyEn: 'Demo speed',
      value: ['20 km/h', '25 km/h'],
      sourceZh: '虚构结构化多值',
    },
    {
      keyZh: '虚构喷头数量',
      keyEn: 'Demo nozzle count',
      value: '8 个',
      sourceZh: '虚构参数表',
    },
    {
      keyZh: '虚构喷头数量',
      keyEn: 'Demo nozzle count',
      value: '12 个',
      sourceZh: '虚构说明候选',
      evidenceKind: 'description-candidate',
    },
  ])

  assert.equal(rows[0].multiValue, true)
  assert.equal(rows[0].hasConflict, false)
  assert.deepEqual(rows[1].displayValues, ['8 个', '12 个'])
  assert.equal(rows[1].hasConflict, true)
  assert.deepEqual(rows[1].evidence.map((item) => item.sourceZh), ['虚构参数表', '虚构说明候选'])
})

test('空数组、空字符串、空对象、0 和 false 均不被静默丢弃', () => {
  const fields = normalizeParameterFields([
    { keyZh: '空数组', keyEn: 'Empty array', value: [] },
    { keyZh: '空文本', keyEn: 'Empty text', value: '  ' },
    { keyZh: '空对象', keyEn: 'Empty object', value: {} },
    { keyZh: '数字零', keyEn: 'Zero', value: 0 },
    { keyZh: '布尔否', keyEn: 'False', value: false },
  ])

  assert.deepEqual(fields.slice(0, 3).map((field) => field.values[0].display), ['待确认', '待确认', '待确认'])
  assert.ok(fields.slice(0, 3).every((field) => field.values[0].missing))
  assert.equal(fields[3].values[0].display, '0')
  assert.equal(fields[4].values[0].display, 'false')
})

test('非法 JSON 与 HTML 片段只作为普通文本返回', () => {
  const fields = normalizeParameterFields([
    { keyZh: '非法 JSON', keyEn: 'Malformed JSON', value: '[甲,乙]' },
    { keyZh: '文本片段', keyEn: 'Text fragment', value: '<img src=x onerror=alert(1)>' },
  ])

  assert.equal(fields[0].values[0].display, '[甲,乙]')
  assert.equal(fields[1].values[0].display, '<img src=x onerror=alert(1)>')
})
