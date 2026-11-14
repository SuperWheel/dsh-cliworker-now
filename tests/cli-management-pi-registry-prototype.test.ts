/** 模拟：真实 npm + 微型本地包，只允许环回 HTTP，不运行 Pi、不访问公网。 */
import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
const exec = promisify(execFile)
it('模拟：真实 npm ci 将 lock resolved 的 registry.npmjs.org 替换为带令牌的环回 registry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-npm-simulated-')), paths: string[] = []
  let server: ReturnType<typeof createServer> | undefined
  try {
    await mkdir(join(root, 'package'))
    await writeFile(join(root, 'package/package.json'), JSON.stringify({ name: 'pi-registry-simulated', version: '1.0.0' }))
    await exec('/usr/bin/tar', ['-czf', join(root, 'package.tgz'), '-C', root, 'package'])
    const tarball = await readFile(join(root, 'package.tgz')), integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
    server = createServer((req, res) => { paths.push(req.url!); if (req.url !== '/simulated-token/pi-registry-simulated/-/pi-registry-simulated-1.0.0.tgz') { res.writeHead(404).end(); return } res.setHeader('Content-Length', tarball.length); res.end(tarball) })
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback address')
    const pkg = { name: 'fixture', version: '1.0.0', dependencies: { 'pi-registry-simulated': '1.0.0' } }
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg))
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': pkg, 'node_modules/pi-registry-simulated': { version: '1.0.0', resolved: 'https://registry.npmjs.org/pi-registry-simulated/-/pi-registry-simulated-1.0.0.tgz', integrity } } }))
    await exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=3000', '--cache', join(root, 'cache'), '--userconfig', join(root, 'empty-npmrc'), '--globalconfig', join(root, 'empty-global-npmrc')], { cwd: root, timeout: 15000, env: { ...process.env, npm_config_registry: `http://127.0.0.1:${address.port}/simulated-token/` } })
    expect(paths.filter(p => p.endsWith('.tgz'))).toEqual(['/simulated-token/pi-registry-simulated/-/pi-registry-simulated-1.0.0.tgz'])
    expect(paths.every(p => p.startsWith('/simulated-token/'))).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'node_modules/pi-registry-simulated/package.json'), 'utf8')).version).toBe('1.0.0')
  } finally { server?.closeAllConnections(); if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
}, 20000)
