import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('演示产品数量、ID 与匹配目标一致', async () => {
  const source = await readFile(path.join(root, 'src', 'data', 'demo-products.ts'), 'utf8')
  const ids = [...source.matchAll(/\bid:\s*'(?<id>DEMO-[A-Z0-9-]+)'/g)].map((match) => match.groups.id)
  const relationBlocks = [...source.matchAll(/compatibleWith:\s*\[(?<targets>[^\]]*)\]/g)]
  const targets = relationBlocks.flatMap((match) => [...match.groups.targets.matchAll(/'(?<id>DEMO-[A-Z0-9-]+)'/g)].map((item) => item.groups.id))
  const roles = [...source.matchAll(/\brole:\s*'(?<role>[a-z-]+)'/g)].map((match) => match.groups.role)

  assert.equal(ids.length, 6)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(targets.every((target) => ids.includes(target)))
  assert.equal(roles.length, ids.length)
  assert.ok(roles.every((role) => ['tractor', 'tractor-implement', 'excavator', 'excavator-attachment'].includes(role)))
})

test('所有产品图片都由本地 SVG 提供', async () => {
  const source = await readFile(path.join(root, 'src', 'data', 'demo-products.ts'), 'utf8')
  const imageNames = [...source.matchAll(/image:\s*'\/assets\/(?<file>[^']+\.svg)'/g)].map((match) => match.groups.file)
  const fallbackNames = [...source.matchAll(/imageFallbacks:\s*\[(?<files>[^\]]*)\]/g)]
    .flatMap((match) => [...match.groups.files.matchAll(/'\/assets\/(?<file>[^']+\.svg)'/g)])
    .map((match) => match.groups.file)
  const assets = await readdir(path.join(root, 'public', 'assets'))

  assert.equal(imageNames.length, 6)
  assert.ok(fallbackNames.length >= 1)
  assert.ok([...imageNames, ...fallbackNames].every((file) => assets.includes(file)))
})

test('界面明确声明离线演示并以空值阻断未核验零税率', async () => {
  const app = await readFile(path.join(root, 'src', 'App.tsx'), 'utf8')
  assert.match(app, /不登录 · 不保存密码 · 不连接生产系统/)
  assert.match(app, /留空表示未核验；仅在官方明确为零时输入 0/)
  assert.match(app, /已阻断税费与 DDP 计算/)
  assert.match(app, /dutyPercent: null/)
  assert.match(app, /自制 SVG 占位素材/)
  assert.match(app, /数组、多选和嵌套值逐项保留/)
  assert.match(app, /冲突待核验/)
  assert.match(app, /自走整机和备件不会被当作属具/)
  assert.match(app, /<ProductImage/)
  assert.match(app, /value=\{Number\.isFinite\(value\) \? value : ''\}/)
  assert.match(app, /onChange=\{\(event\) => onChange\(event\.currentTarget\.valueAsNumber\)\}/)
  assert.match(app, /报价输入无效，暂不计算/)
})

test('README 明确离线快照不会后台联网更新', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /本仓库没有生产快照接口/)
  assert.match(readme, /不会定时联网/)
  assert.match(readme, /旧页面不能宣称已经自动获得最新数据/)
})

test('Node 最低版本与 Vite 工具链要求保持一致', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  const nvmrc = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim()

  assert.equal(packageJson.engines.node, '>=22.12.0')
  assert.equal(nvmrc, '22.12.0')
  assert.match(readme, /Node\.js 22\.12\.0 或更高版本/)
})
