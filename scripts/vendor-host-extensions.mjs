// Explicitly freeze reviewed artifacts; ordinary builds only verify the checked-in runtime.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest, hostRuntimeDirectory, hostRuntimePackages, normalizeHostClient, runtimeFiles, verifyHostRuntime } from './host-runtime.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length === 0) {
  const manifest = verifyHostRuntime(root)
  console.log(JSON.stringify({ verified: true, packages: manifest.packages.map(pkg => pkg.name), files: manifest.files.length }))
} else {
  if (args.length !== 2 || args[0] !== '--from') throw new Error('Usage: vendor-host-extensions.mjs [--from reviewed-artifact-directory]')
  const source = resolve(root, args[1])
  const input = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  const patch = readFileSync(join(root, 'host-extensions/dsh-0.2.1-rc.5/source.patch'))
  if (input.upstream?.commit !== 'b830ec950faba0a46dda564be3e2d854afed94f1' || input.patch.sha256 !== digest(patch))
    throw new Error('Reviewed artifact does not match the pinned official source and current patch')
  for (const file of input.files) {
    const bytes = readFileSync(join(source, file.path))
    if (digest(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Reviewed artifact changed: ${file.path}`)
  }
  const target = join(root, hostRuntimeDirectory)
  const stage = join(root, '.cache/host-runtime-stage')
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true })
  const packages = []
  for (const id of hostRuntimePackages) {
    const pkg = input.packages.find(pkg => pkg.name === `@deepseek-ai/dsh-client-${id}`)
    if (!pkg || pkg.directory !== `dsh-client-${id}`) throw new Error(`Missing reviewed package: ${id}`)
    const from = join(source, pkg.directory), to = join(stage, pkg.directory)
    mkdirSync(to, { recursive: true })
    for (const path of runtimeFiles(from)) {
      if (!(path === 'LICENSE' || path.endsWith('.d.ts') || path.startsWith('locale/')) && !['lib/index.js', 'lib/client.js'].includes(path)) continue
      const destination = join(to, path); mkdirSync(dirname(destination), { recursive: true })
      if (path === 'lib/client.js') writeFileSync(destination, normalizeHostClient(readFileSync(join(from, path), 'utf8')))
      else cpSync(join(from, path), destination)
    }
    if (!existsSync(join(to, 'LICENSE'))) throw new Error(`Missing upstream license: ${id}`)
    const json = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
    const manifest = Object.fromEntries(['name', 'description', 'version', 'type', 'license', 'main', 'types', 'dsh', 'dependencies', 'peerDependencies', 'repository'].filter(key => json[key] !== undefined).map(key => [key, json[key]]))
    // Browser platform seeds stay external. Preserve their actual official source
    // requirements explicitly rather than carrying the private build dependency graph.
    const externalRequirements = Object.fromEntries(['react', 'react-dom', '@tanstack/react-virtual']
      .filter(name => json.devDependencies?.[name]).map(name => [name, json.devDependencies[name]]))
    manifest.exports = Object.fromEntries(Object.entries(json.exports).filter(([key]) => ['.', './client', './package.json'].includes(key) || key.startsWith('./locale/')))
    writeFileSync(join(to, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    packages.push({ id, name: json.name, version: json.version, directory: pkg.directory,
      reviewedClientSha256: pkg.client.sha256, clientSha256: digest(readFileSync(join(to, 'lib/client.js'))),
      externalRequirements,
      declarations: 'inherited-official-baseline; extension interfaces are verified from source' })
  }
  writeFileSync(join(stage, 'source.patch'), patch)
  writeFileSync(join(stage, 'README.md'), '# CLI Worker 原生界面运行资源\n\n基于 DeepSeek Harness 官方 0.2.1-rc.5 四包及同目录 source.patch。各包保留原模块身份和 MIT 许可；修改版由 CLI Worker 分发，不代表上游官方发布。生成的机器路径注释已归一化，不分发未使用的 source map；代码与已验收候选仅有注释差异。详细摘要见 manifest.json。\n\n经本插件 bundle 层使用独立 cliworker-ui-* 行 ID 接入，浏览器模块身份保持官方名称；安装、更新或卸载前结束任务并退出宿主，完成后冷启动。其他自定义覆盖或带旧来源断言的设置可能冲突；预检拒绝时保留配置，由用户明确迁移或移除本插件恢复。兼容性按接口能力检查，实际验收范围以 Release 为准。\n')
  const output = { schema: 1, upstream: { repository: input.upstream.repository, tag: input.upstream.tag,
    commit: input.upstream.commit, version: '0.2.1-rc.5' }, patch: { path: 'source.patch', sha256: digest(patch) },
    normalization: ['generated CSS region comments use repository-relative paths', 'unused sourceMappingURL comments and maps are omitted'],
    packages, files: runtimeFiles(stage).map(path => { const bytes = readFileSync(join(stage, path)); return { path, bytes: bytes.length, sha256: digest(bytes) } }) }
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(output, null, 2) + '\n')
  verifyHostRuntime(root, { directory: stage })
  rmSync(target, { recursive: true, force: true }); cpSync(stage, target, { recursive: true })
  verifyHostRuntime(root)
  console.log(JSON.stringify({ frozen: true, directory: hostRuntimeDirectory, packages: packages.length, files: output.files.length }))
}
