import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { verifyHostRuntime } from './host-runtime.mjs'

const primitives = '@deepseek-ai/dsh-client-ui-primitives'
const parse = source => {
  const file = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (file.parseDiagnostics.length) throw new Error('无法解析浏览器脚本')
  return file
}
const visit = (node, callback) => {
  callback(node)
  ts.forEachChild(node, child => { visit(child, callback) })
}
const propertyName = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined
const primitiveRequire = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression)
  && node.expression.text === 'require' && node.arguments.length === 1
  && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === primitives

/** 只解析构建产物，不执行宿主或插件脚本。无法识别的结构不能算兼容通过。 */
export function browserPrimitiveExports(sources) {
  const candidates = []
  for (const source of sources) {
    const file = parse(source)
    const seeds = []
    const declarations = new Map()
    visit(file, node => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === primitives) seeds.push(node.initializer)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.initializer)
    })
    for (const seed of seeds) {
      let value = seed
      const seen = new Set()
      while (value) {
        if (ts.isIdentifier(value) && !seen.has(value.text)) {
          seen.add(value.text)
          value = declarations.get(value.text)
        } else if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
          && ts.isIdentifier(value.expression.expression) && value.expression.expression.text === 'Object'
          && ['freeze', 'defineProperty'].includes(value.expression.name.text)) {
          value = value.arguments[0]
        } else break
      }
      if (!value || !ts.isObjectLiteralExpression(value)) throw new Error('无法识别宿主原语导出结构')
      const names = new Set()
      for (const property of value.properties) {
        const name = property.name && propertyName(property.name)
        if (!name) throw new Error('宿主原语导出包含无法静态检查的属性')
        if (name !== '__proto__') names.add(name)
      }
      if (!names.size) throw new Error('宿主原语导出为空')
      candidates.push(names)
    }
  }
  if (candidates.length !== 1) throw new Error('必须找到唯一的宿主原语导出表')
  return candidates[0]
}

export function requiredPrimitiveExports(source) {
  const file = parse(source)
  const aliases = new Set()
  const names = new Set()
  visit(file, node => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !primitiveRequire(node.initializer)) return
    if (ts.isIdentifier(node.name)) aliases.add(node.name.text)
    else if (ts.isObjectBindingPattern(node.name)) {
      for (const binding of node.name.elements) {
        if (binding.dotDotDotToken || !ts.isIdentifier(binding.name)) throw new Error('不支持动态原语解构')
        const name = propertyName(binding.propertyName ?? binding.name)
        if (!name) throw new Error('不支持动态原语解构')
        names.add(name)
      }
    }
  })
  const namespace = expression => primitiveRequire(expression)
    || ts.isIdentifier(expression) && aliases.has(expression.text)
  visit(file, node => {
    if (ts.isPropertyAccessExpression(node) && namespace(node.expression)) names.add(node.name.text)
    if (ts.isElementAccessExpression(node) && namespace(node.expression)) {
      if (!node.argumentExpression || !ts.isStringLiteral(node.argumentExpression)) throw new Error('不支持动态原语属性访问')
      names.add(node.argumentExpression.text)
    }
  })
  return names
}

export function comparePrimitiveExports(sources, clients) {
  const available = browserPrimitiveExports(sources)
  let references = 0
  const missing = []
  for (const [id, source] of Object.entries(clients)) {
    const required = requiredPrimitiveExports(source)
    references += required.size
    const names = [...required].filter(name => !available.has(name)).sort()
    if (names.length) missing.push({ id, names })
  }
  if (!references) throw new Error('未找到原语引用，不能将空检查记为通过')
  return { references, missing }
}

export function checkBrowserPrimitives(root, frontend) {
  const manifest = verifyHostRuntime(root, { sourcePatch: false })
  const assets = join(frontend, 'assets')
  const sources = readdirSync(assets).filter(name => name.endsWith('.js')).map(name => readFileSync(join(assets, name), 'utf8'))
  const clients = Object.fromEntries(manifest.packages.map(pkg => [pkg.id, readFileSync(join(root, 'runtime-host', pkg.directory, 'lib/client.js'), 'utf8')]))
  return comparePrimitiveExports(sources, clients)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  try {
    let root = resolve('.')
    let frontend
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--frontend' && args[i + 1]) frontend = resolve(args[++i])
      else if (args[i] === '--runtime' && args[i + 1]) root = resolve(args[++i])
      else throw new Error('参数错误；用法：pnpm check:browser --frontend <frontend-dist> [--runtime <plugin-root>]')
    }
    if (!frontend) throw new Error('请使用 --frontend 指定待检查宿主的前端 dist 目录')
    const result = checkBrowserPrimitives(root, frontend)
    for (const { id, names } of result.missing) console.error(`${id}: 缺少 ${names.join(', ')}`)
    if (result.missing.length) process.exitCode = 1
    else console.log(`原语导出检查通过（${result.references} 项包内引用）；仍需真实 Desktop 输入框验收。`)
  } catch (error) {
    console.error(error?.code ? `无法读取检查输入（${error.code}）` : error.message)
    process.exitCode = 1
  }
}
