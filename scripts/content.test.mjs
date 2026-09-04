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

  assert.equal(ids.length, 6)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(targets.every((target) => ids.includes(target)))
})

test('所有产品图片都由本地 SVG 提供', async () => {
  const source = await readFile(path.join(root, 'src', 'data', 'demo-products.ts'), 'utf8')
  const imageNames = [...source.matchAll(/image:\s*'\/assets\/(?<file>[^']+\.svg)'/g)].map((match) => match.groups.file)
  const assets = await readdir(path.join(root, 'public', 'assets'))

  assert.equal(imageNames.length, 6)
  assert.ok(imageNames.every((file) => assets.includes(file)))
})

test('界面明确声明离线演示并以空值阻断未核验零税率', async () => {
  const app = await readFile(path.join(root, 'src', 'App.tsx'), 'utf8')
  assert.match(app, /不登录 · 不保存密码 · 不连接生产系统/)
  assert.match(app, /留空表示未核验；仅在官方明确为零时输入 0/)
  assert.match(app, /已阻断税费与 DDP 计算/)
  assert.match(app, /dutyPercent: null/)
  assert.match(app, /自制 SVG 占位素材/)
})
