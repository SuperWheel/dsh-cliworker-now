import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkBuddyDesktop } from '../src/host/workbuddy-desktop-open.ts'
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); spawn.mockReset(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture(platform: 'darwin' | 'win32') {
  const root = await mkdtemp(join(tmpdir(), 'wb-desktop-SIMULATED-')); roots.push(root)
  const app = join(root, platform === 'darwin' ? 'WorkBuddy Space.app' : 'WorkBuddy Space')
  const runtime = join(app, ...(platform === 'darwin' ? ['Contents', 'MacOS', 'Electron'] : ['WorkBuddy.exe']))
  const cli = join(app, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']), 'app.asar.unpacked', 'cli')
  for (const [file, content] of [[runtime, 'SIMULATED never run'], [join(cli, 'dist/codebuddy-lite-wb.mjs'), 'SIMULATED'],
    [join(cli, 'package.json'), JSON.stringify({ name: '@genie/agent-cli', version: 'SIMULATED' })],
    [join(cli, 'product.json'), JSON.stringify({ endpoint: 'https://www.workbuddy.cn', productName: 'SIMULATED', dataFolderName: '.SIMULATED' })]]) {
    await mkdir(dirname(file!), { recursive: true }); await writeFile(file!, content!)
  }
  const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() })
  spawn.mockImplementation(() => { queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0) }); return child })
  return { app, runtime, child }
}
describe('模拟 constrained desktop opener; no app launched', () => {
  it.each(['darwin', 'win32'] as const)('spawns verified %s argv without shell or CLI flags; closing never kills GUI', async platform => {
    const f = await fixture(platform), control = new AbortController()
    await openWorkBuddyDesktop('workbuddycn', f.app, control.signal, platform)
    expect(spawn).toHaveBeenCalledWith(platform === 'darwin' ? '/usr/bin/open' : f.runtime, platform === 'darwin' ? [f.app] : [],
      expect.objectContaining({ shell: false, detached: true, stdio: 'ignore' }))
    expect(spawn.mock.calls[0]![2].env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    control.abort()
    expect(f.child.kill).not.toHaveBeenCalled(); expect(f.child.unref).toHaveBeenCalled()
  })
  it('aborted actions and edition mismatch never spawn', async () => {
    const f = await fixture('darwin')
    await expect(openWorkBuddyDesktop('workbuddycn', f.app, AbortSignal.abort(), 'darwin')).rejects.toThrow()
    await expect(openWorkBuddyDesktop('workbuddy', f.app, new AbortController().signal, 'darwin')).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })
  it('cancel waits for the macOS opener to exit, without targeting the desktop app', async () => {
    const f = await fixture('darwin'), control = new AbortController()
    let spawned!: () => void
    const allocated = new Promise<void>(r => { spawned = r })
    spawn.mockImplementation(() => { spawned(); return f.child })
    let settled = false
    const opening = openWorkBuddyDesktop('workbuddycn', f.app, control.signal, 'darwin').finally(() => { settled = true })
    const rejected = expect(opening).rejects.toThrow('手动打开对应版本')
    await allocated
    control.abort(); await Promise.resolve()
    expect(f.child.kill).toHaveBeenCalledOnce(); expect(settled).toBe(false)
    f.child.emit('exit', null)
    await rejected
  })
  it('nonzero /usr/bin/open reports fixed manual instructions without native error detail', async () => {
    const f = await fixture('darwin')
    spawn.mockImplementation(() => { queueMicrotask(() => f.child.emit('error', new Error('SIMULATED SECRET'))); return f.child })
    await expect(openWorkBuddyDesktop('workbuddycn', f.app, new AbortController().signal, 'darwin')).rejects.toThrow('手动打开对应版本')
    expect(f.child.kill).not.toHaveBeenCalled()
  })
})
