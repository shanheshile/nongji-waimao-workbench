import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const excludedDirectories = new Set(['.git', 'node_modules', 'dist', '.vite', 'coverage'])
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.ts', '.tsx', '.txt', '.yml', '.yaml', '',
])
const errors = []

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

const files = await walk(root)

for (const generatedPath of ['dist', 'tsconfig.app.tsbuildinfo', 'tsconfig.node.tsbuildinfo']) {
  try {
    await stat(path.join(root, generatedPath))
    errors.push(`${generatedPath}: 存在不应进入源码发布的构建生成物`)
  } catch {
    // Expected: source releases are generated from a clean tree.
  }
}

// The public checker intentionally contains no private hostname inventory.
// Any hostname not needed by this standalone repository is rejected instead.
const allowedExternalHosts = new Set(['github.com', 'docs.github.com', 'www.apache.org', 'www.w3.org'])
const externalUrlPattern = /https?:\/\/[^\s"'<>`)]+/gi
const forbiddenPrivateFieldPattern = /\b(?:private|internal|tenant|customer|supplier|factory|employee)(?:Id|Name|Address|Price|Token)\s*[:=]/i
const networkCallPattern = new RegExp(`${'fe' + 'tch'}\\s*\\(|XMLHttpRequest|new\\s+WebSocket`, 'i')
const credentialName = ['pass', 'word'].join('') + '|to' + 'ken|se' + 'cret|api[_-]?' + 'key'
const credentialAssignmentPattern = new RegExp(`(?:${credentialName})\\s*[:=]\\s*["'][^"'\\n]{6,}["']`, 'i')
const secretMaterialPatterns = [
  new RegExp(['BEGIN ', 'PRIVATE KEY'].join(''), 'i'),
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  new RegExp(['Authori', 'zation:\\s*Bearer\\s+\\S+'].join(''), 'i'),
]

for (const absolute of files) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const extension = path.extname(absolute).toLowerCase()
  const fileStat = await stat(absolute)

  if (!['package-lock.json', 'LICENSE'].includes(relative) && fileStat.size > 512 * 1024) {
    errors.push(`${relative}: 单文件超过 512 KiB，疑似大数据或生成物`)
  }

  if (!textExtensions.has(extension)) continue
  const content = await readFile(absolute, 'utf8')

  for (const match of content.matchAll(externalUrlPattern)) {
    const hostname = new URL(match[0]).hostname.toLowerCase()
    if (!allowedExternalHosts.has(hostname)) {
      errors.push(`${relative}: 包含未在公开白名单中的外部主机名 ${hostname}`)
    }
  }

  if (/[A-Za-z]:[\\/](?:Users|Documents|Projects|www|var|home)[\\/]/i.test(content)) {
    errors.push(`${relative}: 包含本机绝对路径`)
  }
  if (/\/(?:www\/server|var\/www|home\/[A-Za-z0-9._-]+)\//i.test(content)) {
    errors.push(`${relative}: 包含服务器绝对路径`)
  }
  if (/\b\d{17,}\b/.test(content)) {
    errors.push(`${relative}: 包含疑似真实长编号`)
  }
  if (credentialAssignmentPattern.test(content) || secretMaterialPatterns.some((pattern) => pattern.test(content))) {
    errors.push(`${relative}: 包含疑似凭据材料`)
  }

  if (forbiddenPrivateFieldPattern.test(content)) errors.push(`${relative}: 包含疑似生产私有字段赋值`)

  if (relative.startsWith('src/') && networkCallPattern.test(content)) {
    errors.push(`${relative}: 前端包含网络调用；开源 DEMO 必须默认离线`)
  }
  if (/<(?:img|video|audio|source)[^>]+(?:src|poster)=["']https?:\/\//i.test(content)) {
    errors.push(`${relative}: 包含远程媒体`)
  }
  if (/url\(\s*["']?https?:\/\//i.test(content)) {
    errors.push(`${relative}: CSS 包含远程媒体`)
  }
}

const dataFile = path.join(root, 'src', 'data', 'demo-products.ts')
const dataSource = await readFile(dataFile, 'utf8')
const ids = [...dataSource.matchAll(/\bid:\s*'(?<id>DEMO-[A-Z0-9-]+)'/g)].map((match) => match.groups?.id)
if (ids.length < 4 || ids.length > 6) {
  errors.push(`演示产品数量必须为 4–6，当前解析到 ${ids.length}`)
}
if (new Set(ids).size !== ids.length) {
  errors.push('演示产品 ID 存在重复')
}
if (!dataSource.includes('全部记录均为虚构 DEMO')) {
  errors.push('演示产品文件缺少显式虚构数据声明')
}

const mediaFiles = files.filter((file) => path.relative(root, file).replaceAll('\\', '/').startsWith('public/assets/'))
if (mediaFiles.length === 0 || mediaFiles.some((file) => path.extname(file).toLowerCase() !== '.svg')) {
  errors.push('素材必须存在且只能使用仓库内 SVG')
}

if (errors.length > 0) {
  console.error('开源边界校验失败：')
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}

console.log(`开源边界校验通过：${files.length} 个文件，${ids.length} 条虚构产品，${mediaFiles.length} 个本地 SVG。`)
