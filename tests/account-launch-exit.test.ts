/** 模拟命令在本机执行；验证包装器，不启动 OpenCode，不读取账号。不是 Windows ConPTY 实测。 */
import { afterEach, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const privateLaunch = fileURLToPath(new URL('../src/host/private-launch.mjs', import.meta.url))
const windowsLaunch = fileURLToPath(new URL('../src/host/windows-account-launch.mjs', import.meta.url))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it.each([0, 7])('模拟：private-launch 保留子命令退出码 %s', async code => {
  const child = spawn(process.execPath, [privateLaunch, process.execPath, '-e', `process.exit(${code})`], {
    env: process.env, stdio: 'ignore',
  })
  expect(await once(child, 'close')).toEqual([code, null])
})

it.skipIf(process.platform === 'win32').each([0, 7, 'signal'] as const)(
  '模拟：Windows bootstrap 在 Mac 上解包 private-launch 并写退出回执 %s', async code => {
    const directory = await mkdtemp(join(tmpdir(), 'cwn-launch-simulated-'))
    roots.push(directory)
    await writeFile(join(directory, 'ready'), 'ready')
    const requested = [process.execPath, privateLaunch, process.execPath, '-e',
      code === 'signal' ? 'process.kill(process.pid, "SIGTERM")' : `process.exit(${code})`]
    const child = spawn(process.execPath, [windowsLaunch, directory, Buffer.from(JSON.stringify(requested)).toString('base64')], {
      env: process.env, stdio: 'ignore',
    })
    const closed = once(child, 'close')
    try {
      await expect.poll(async () => {
        try { return JSON.parse(await readFile(join(directory, 'exit'), 'utf8')) }
        catch { return undefined }
      }).toEqual({ exitCode: code === 'signal' ? 1 : code, signal: code === 'signal' ? 'SIGTERM' : null })
    } finally {
      child.kill('SIGTERM')
      await closed
    }
  },
)
