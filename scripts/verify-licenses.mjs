import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const modulesRoot = path.join(root, 'node_modules')
const packageFiles = []

async function collectPackageFiles(directory, depth = 0) {
  if (depth > 6) return
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'package.json') {
      packageFiles.push(path.join(directory, entry.name))
      continue
    }
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const child = path.join(directory, entry.name)
    await collectPackageFiles(child, depth + 1)
  }
}

await collectPackageFiles(path.join(modulesRoot, '.pnpm'))
if (packageFiles.length === 0) {
  console.error('未发现已安装依赖，请先运行 pnpm install --frozen-lockfile。')
  process.exit(1)
}

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'Unlicense',
])
const problems = []

for (const packageFile of packageFiles) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(packageFile, 'utf8'))
  } catch {
    continue
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) continue
  const license = typeof manifest.license === 'string' ? manifest.license.trim() : ''
  const tokens = license.match(/[A-Za-z0-9.-]+/g) ?? []
  const operators = new Set(['AND', 'OR', 'WITH'])
  const unknownTokens = tokens.filter((token) => !operators.has(token) && !allowedLicenses.has(token))
  if (!license || unknownTokens.length > 0) {
    problems.push(`${manifest.name ?? packageFile}@${manifest.version ?? '?'}: ${license || '未声明'}`)
  }
}

if (problems.length > 0) {
  console.error('依赖许可证不在允许集合或声明不明确：')
  problems.forEach((problem) => console.error(`- ${problem}`))
  process.exit(1)
}

console.log(`许可证校验通过：检查 ${packageFiles.length} 个已安装软件包。`)
