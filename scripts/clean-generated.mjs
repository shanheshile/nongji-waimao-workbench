import { rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.cwd())
const generatedPaths = ['dist', 'tsconfig.app.tsbuildinfo', 'tsconfig.node.tsbuildinfo']

for (const relative of generatedPaths) {
  const target = path.resolve(root, relative)
  const allowed = target === path.join(root, 'dist') || path.dirname(target) === root
  if (!allowed) throw new Error(`拒绝清理工作区外路径：${relative}`)
  await rm(target, { recursive: true, force: true })
}

console.log('已清理本项目构建生成物。')
