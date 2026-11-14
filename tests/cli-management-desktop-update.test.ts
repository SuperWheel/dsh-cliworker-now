import { updateCleanupIo, withUpdateCleanup } from '../src/host/cli-management/update-cleanup.ts'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopUpdateIo, DesktopUnavailableError, readDesktopRelease, runDesktopUpdate, type DesktopCli, type DesktopRelease } from '../src/host/cli-management/desktop-update.ts'
import { CliOperationError } from '../src/host/cli-management/planner.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

// Every native process and every feed is simulated. An accidental native launch fails.
vi.mock('node:child_process', () => ({ execFile: vi.fn(() => { throw new Error('模拟测试禁止启动真实进程') }) }))
const roots: string[] = []
const signal = () => new AbortController().signal
const sha512 = Buffer.alloc(64, 1).toString('base64'), sha256 = 'a'.repeat(64)
const zurl = 'https://cdn-zcode.z.ai/zcode/electron/releases/3.18.2/macos-arm64/ZCode.zip'
const wburl = (cli: DesktopCli, platform = 'darwin') => `https://download.codebuddy.${cli === 'workbuddycn' ? 'cn' : 'ai'}/workbuddy/saas/${platform === 'darwin' ? 'darwin-arm64/WorkBuddy.zip' : 'win32-x64-user/WorkBuddy.exe'}`
const manifest = (file: Record<string, unknown> = {}, extra = '') => `version: 3.18.2\nfiles:\n  - ${Object.entries({ url: zurl, sha512, size: 123, ...file }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n    ')}\n${extra}`
const wb = (cli: DesktopCli, overrides: Record<string, unknown> = {}) => JSON.stringify({ version: '5.9.3.42398134', url: wburl(cli), sha256hash: sha256, ...overrides })
function feed(body: string, init?: ResponseInit) {
  return vi.fn(async () => new Response(body, init))
}
const readZ = (body: string, overrides = {}) => readDesktopRelease('zcode', {}, signal(), { platform: 'darwin', arch: 'arm64', fetcher: feed(body), ...overrides })

afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(execFile).mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('模拟：官方桌面更新 feed', () => {
  it.each(['darwin', 'win32'])('ZCode %s 选择 ZIP/EXE，保留摘要和长度并限制请求', async platform => {
    const url = platform === 'darwin' ? zurl : zurl.replace('macos-arm64/ZCode.zip', 'windows-x64/ZCode.exe')
    const fetcher = feed(manifest({ url }, 'path: https://evil.invalid/ignored.zip\nreleaseNotes: |-\n  普通发布说明 !不是标签'))
    await expect(readDesktopRelease('zcode', {}, signal(), { fetcher, platform, arch: platform === 'darwin' ? 'arm64' : 'x64' })).resolves.toEqual({ version: '3.18.2', url, sha512, size: 123, teamId: '8A5X4JJ39T' })
    expect(fetcher.mock.calls[0]).toEqual([`https://zcode.z.ai/api/v1/releases/electron/manifest?platform=${platform === 'darwin' ? 'darwin-aarch64' : 'windows-x86_64'}&channel=1`, expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) })])
  })
  it('ZCode 在多个 files 中选 ZIP，不用顶层摘要或 DMG', async () => {
    const text = `version: 3.18.2\nfiles:\n  - url: ${zurl.replace('.zip', '.dmg')}\n    sha512: invalid\n    size: 123\n  - url: ${zurl}\n    sha512: ${sha512}\n    size: 456\nsha512: invalid\n`
    await expect(readZ(text)).resolves.toMatchObject({ url: zurl, size: 456, sha512 })
  })
  it.each(['workbuddycn', 'workbuddy'] as const)('%s 正常 JSON、四段版本号、当前版本与各自白名单', async cli => {
    const fetcher = feed(wb(cli))
    const result = await readDesktopRelease(cli, { appVersion: '5.9.2' }, signal(), { fetcher, platform: 'darwin', arch: 'arm64' })
    expect(result).toMatchObject({ version: '5.9.3.42398134', url: wburl(cli), sha256 })
    expect(result.teamId).toBe(cli === 'workbuddycn' ? 'FN2V63AD2J' : undefined)
    expect(fetcher.mock.calls[0]).toEqual([`https://www.workbuddy.${cli === 'workbuddycn' ? 'cn' : 'ai'}/v2/update?platform=workbuddy-darwin-arm64&version=5.9.2`, expect.objectContaining({ credentials: 'omit', redirect: 'error' })])
  })
  it('WorkBuddy CN Windows 使用 user 后缀和缺省公开版本哨兵', async () => {
    const fetcher = feed(wb('workbuddycn', { url: wburl('workbuddycn', 'win32') }))
    await expect(readDesktopRelease('workbuddycn', {}, signal(), { fetcher, platform: 'win32', arch: 'x64' })).resolves.toMatchObject({ sha256 })
    expect(fetcher.mock.calls[0]![0]).toBe('https://www.workbuddy.cn/v2/update?platform=workbuddy-win32-x64-user&version=0.0.0')
  })
  it('WorkBuddy 国际 Windows 空摘要按官方缺口拒绝', async () => {
    const fetcher = feed(wb('workbuddy', { url: wburl('workbuddy', 'win32'), sha256hash: '' }))
    await expect(readDesktopRelease('workbuddy', {}, signal(), { fetcher, platform: 'win32', arch: 'x64' })).rejects.toMatchObject({ reason: '官方更新源没有提供校验值，暂不能自动更新' })
  })
  it.each(['linux', 'freebsd'])('拒绝平台 %s', async platform => {
    const fetcher = feed(manifest())
    await expect(readZ(manifest(), { platform, fetcher })).rejects.toBeInstanceOf(DesktopUnavailableError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['ia32', 'riscv64'])('拒绝架构 %s', async arch => { await expect(readZ(manifest(), { arch })).rejects.toThrow('架构') })
  it.each([
    'https://evil.invalid/zcode/electron/releases/a.zip',
    'https://cdn-zcode.z.ai.evil.invalid/zcode/electron/releases/a.zip',
    'https://user:secret@cdn-zcode.z.ai/zcode/electron/releases/a.zip',
    'http://cdn-zcode.z.ai/zcode/electron/releases/a.zip',
    'https://cdn-zcode.z.ai:444/zcode/electron/releases/a.zip',
    'https://cdn-zcode.z.ai/other/a.zip',
    'https://cdn-zcode.z.ai/zcode/electron/releases/%2e%2e%2fa.zip',
  ])('ZCode 拒绝下载地址 %s', async url => { await expect(readZ(manifest({ url }))).rejects.toThrow('白名单') })
  it.each(['workbuddycn', 'workbuddy'] as const)('%s 拒绝其他区域、archive、凭据和缺失摘要', async cli => {
    for (const overrides of [
      { url: wburl(cli === 'workbuddy' ? 'workbuddycn' : 'workbuddy') },
      { url: wburl(cli).replace('https://', 'https://user:secret@') },
      { sha256hash: '' }, { sha256hash: undefined }, { sha256hash: 'xyz' }, { sha256hash: 'a'.repeat(63) },
    ]) await expect(readDesktopRelease(cli, {}, signal(), { platform: 'darwin', arch: 'arm64', fetcher: feed(wb(cli, overrides)) })).rejects.toBeInstanceOf(DesktopUnavailableError)
    await expect(readDesktopRelease(cli, {}, signal(), { platform: 'win32', arch: 'x64', fetcher: feed(wb(cli, { url: wburl(cli, 'win32').replace('-user/', '-archive/') })) })).rejects.toThrow('白名单')
  })
  it.each(['', 'abcd', 'a'.repeat(88), sha512.slice(0, -3) + 'B=='])('ZCode 拒绝无效摘要 %s', async sha => { await expect(readZ(manifest({ sha512: sha }))).rejects.toBeInstanceOf(DesktopUnavailableError) })
  it.each([0, -1, 1.5, 1024 ** 3 + 1, Number.MAX_SAFE_INTEGER + 1, '123', null])('拒绝长度 %s', async value => { await expect(readZ(manifest({ size: value }))).rejects.toThrow('大小') })
  it.each([1, 1024 ** 3])('接受长度边界 %s', async value => { await expect(readZ(manifest({ size: value }))).resolves.toMatchObject({ size: value }) })
  it.each([
    'version: 1.2.3\nversion: 1.2.4\nfiles: []',
    'version: !!js/function function() {}\nfiles: []',
    'version: !unknown 1.2.3\nfiles: []',
    'version: &v 1.2.3\nfiles: [*v]',
    'version: 1.2.3\nfiles: [*missing]',
    'version: 1.2.3\nfiles: []\n---\nversion: 2.0.0',
    'version: 1.2.3\nfiles: [',
    'version: 1.2.3\nfiles: []\nnested: ' + '['.repeat(40) + '0' + ']'.repeat(40),
    'version: 1.2.3\nfiles: [{url: 12}]',
    'version: 1.2.3\nfiles: [null]',
    manifest({}, '<<: {extra: merge}'),
  ])('拒绝怪异 YAML %#', async body => { await expect(readZ(body)).rejects.toBeInstanceOf(DesktopUnavailableError) })
  it.each([204, 302, 404, 500])('HTTP %s 不生成空版本或跟随重定向', async status => {
    const fetcher = vi.fn(async () => new Response(status === 204 ? null : '{}', { status }))
    await expect(readZ('', { fetcher })).rejects.toBeInstanceOf(DesktopUnavailableError)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['{', 'null', '[]', '{}', '{"version":"<script>"}'])('拒绝异常 JSON %#', async body => {
    await expect(readDesktopRelease('workbuddy', {}, signal(), { platform: 'darwin', arch: 'arm64', fetcher: feed(body) })).rejects.toBeInstanceOf(DesktopUnavailableError)
  })
  it.each([true, false])('响应超 512 KiB，声明长度=%s', async declared => {
    const fetcher = feed('a'.repeat(512 * 1024 + 1), declared ? { headers: { 'content-length': String(512 * 1024 + 1) } } : undefined)
    await expect(readZ('', { fetcher })).rejects.toThrow('512 KiB')
  })
  it.each(['fetch', 'body'])('8 秒上限覆盖挂起的 %s', async phase => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = vi.fn(() => phase === 'fetch' ? new Promise<Response>(() => {}) : Promise.resolve(new Response(new ReadableStream({ cancel }))))
    const pending = readZ('', { fetcher })
    const checked = expect(pending).rejects.toThrow('8 秒')
    await vi.advanceTimersByTimeAsync(8000); await checked
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
    if (phase === 'body') expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('取消原样传播并关闭响应流', async () => {
    const controller = new AbortController(), cancel = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const pending = readDesktopRelease('zcode', {}, controller.signal, { fetcher, platform: 'darwin', arch: 'arm64' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const reason = new Error('模拟用户取消'); controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledOnce()
  })
})

async function fixture(cli: DesktopCli = 'zcode', platform = 'darwin') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-update-模拟-'))); roots.push(root)
  const applications = join(root, 'Applications'), appPath = join(applications, cli === 'zcode' ? 'ZCode.app' : 'WorkBuddy.app')
  await mkdir(appPath, { recursive: true }); await writeFile(join(appPath, 'version.txt'), 'old')
  const controller = new AbortController()
  const release: DesktopRelease = cli === 'zcode'
    ? { version: '3.18.2', url: platform === 'darwin' ? zurl : zurl.replace('.zip', '.exe'), sha512, size: 123 }
    : { version: '5.9.3.42398134', url: wburl(cli, platform), sha256 }
  const capture = vi.spyOn(desktopUpdateIo, 'capture').mockImplementation(async argv => argv[0] === '/bin/ps' ? '/sbin/launchd\n' : 'TeamIdentifier=TEST123456\n')
  const download = vi.fn(async () => join(root, platform === 'darwin' ? '模拟.zip' : '模拟.exe'))
  const run = vi.fn(async (argv: string[], _signal: AbortSignal) => {
    if (argv[0] === '/usr/bin/ditto') {
      const app = argv[1] === '-x' ? join(argv[4]!, 'Original Name.app') : argv[2]!
      await mkdir(app, { recursive: true }); await writeFile(join(app, 'version.txt'), 'new')
    }
  })
  const options = { cli, appPath, root, release, signal: controller.signal, platform, download, run, awaiting: vi.fn() }
  const assertClean = async (expected = 'old') => {
    expect(await readFile(join(appPath, 'version.txt'), 'utf8')).toBe(expected)
    expect(await readdir(applications)).toEqual([basename(appPath)])
    expect(await readdir(join(root, 'cli-management')).catch(() => [])).toEqual([])
  }
  return { options, controller, run, capture, download, assertClean, appPath, root, applications }
}

describe('模拟：macOS 桌面应用替换与恢复', () => {
  it.each(['zcode', 'workbuddycn', 'workbuddy'] as const)('%s 成功验证、替换、删除备份与暂存目录', async cli => {
    const f = await fixture(cli)
    await expect(runDesktopUpdate(f.options)).resolves.toEqual({ appPath: f.appPath })
    await f.assertClean('new')
    expect(f.download).toHaveBeenCalledWith(f.options.release.url, expect.objectContaining(cli === 'zcode' ? { sha512, size: 123 } : { sha256 }), f.controller.signal)
    const verifications = f.run.mock.calls.filter(([argv]) => argv[0] === '/usr/bin/codesign' && argv.some((value) => value.startsWith('-R=')))
    expect(verifications).toHaveLength(2)
    for (const [argv] of verifications) expect(argv).toContain(`-R=anchor apple generic and certificate leaf[subject.OU] = "${cli === 'workbuddy' ? 'TEST123456' : cli === 'zcode' ? '8A5X4JJ39T' : 'FN2V63AD2J'}"`)
    expect(f.run.mock.calls.filter(([argv]) => argv[0] === '/usr/sbin/spctl')).toHaveLength(2)
    expect(f.capture.mock.calls.filter(([argv]) => argv[0] === '/bin/ps')).toHaveLength(2)
    expect(f.options.awaiting).not.toHaveBeenCalled()
  })
  it.each([
    ['zcode', '8A5X4JJ39T', true],
    ['zcode', 'FN2V63AD2J', false],
    ['workbuddycn', 'FN2V63AD2J', true],
    ['workbuddycn', '8A5X4JJ39T', false],
    ['workbuddy', 'TEST123456', true],
    ['workbuddy', 'FN2V63AD2J', false],
  ] as const)('%s 新包团队 %s 匹配结果=%s（模拟 codesign 要求检查）', async (cli, actualTeam, accepted) => {
    const f = await fixture(cli), originalRun = f.run.getMockImplementation()!
    // Even a supplied release.teamId cannot override the pinned/existing-app identity.
    f.options.release.teamId = actualTeam
    f.run.mockImplementation(async (argv, control) => {
      if (argv[0] === '/usr/bin/codesign' && argv.some((value) => value.startsWith('-R='))) {
        const requirement = argv.find((value) => value.startsWith('-R='))!.slice(3)
        if (!requirement.includes(`"${actualTeam}"`)) throw new Error('模拟 codesign：新包团队签名不满足要求')
      }
      await originalRun(argv, control)
    })
    if (accepted) { await runDesktopUpdate(f.options); await f.assertClean('new') }
    else { await expect(runDesktopUpdate(f.options)).rejects.toThrow('新包团队签名不满足要求'); await f.assertClean() }
  })
  it('国际版未安装时拒绝更新，不下载、不读取替代团队身份', async () => {
    const f = await fixture('workbuddy')
    await rm(f.appPath, { recursive: true })
    await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.download).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
  })
  it.each(['running', 'failure', 'reopened'])('ps 检测 %s 拒绝并保留旧应用', async kind => {
    const f = await fixture()
    let calls = 0
    f.capture.mockImplementation(async () => {
      if (kind === 'failure') throw new Error('模拟 ps 失败')
      calls++
      return kind === 'reopened' && calls === 1 ? '' : `${f.appPath}/Contents/MacOS/ZCode --flag`
    })
    await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: 'CLI_BUSY' })
    await f.assertClean()
    if (kind !== 'reopened') expect(f.download).not.toHaveBeenCalled()
  })
  it.each(['download', 'extract', 'codesign', 'spctl', 'copy', 'copied-signature', 'backup-rename', 'replace-rename'])('%s 失败恢复旧应用并清理', async step => {
    const f = await fixture(), originalRun = f.run.getMockImplementation()!
    if (step === 'download') f.download.mockRejectedValue(new Error('模拟 download'))
    f.run.mockImplementation(async (argv, control) => {
      const isExtract = argv[0] === '/usr/bin/ditto' && argv[1] === '-x', isCopy = argv[0] === '/usr/bin/ditto' && argv[1] !== '-x'
      if (step === 'extract' && isExtract || step === 'copy' && isCopy) { await originalRun(argv, control); throw new Error(`模拟 ${step}`) }
      if (step === 'codesign' && argv[0] === '/usr/bin/codesign' || step === 'spctl' && argv[0] === '/usr/sbin/spctl' ||
          step === 'copied-signature' && argv[0] === '/usr/bin/codesign' && argv.at(-1)!.includes('.cliworker-update-')) throw new Error(`模拟 ${step}`)
      await originalRun(argv, control)
    })
    if (step.endsWith('rename')) {
      vi.spyOn(desktopUpdateIo, 'rename').mockImplementation(async (from, to) => {
        if (step === 'backup-rename' && from === f.appPath || step === 'replace-rename' && to === f.appPath && !String(from).endsWith('previous.app')) throw new Error(`模拟 ${step}`)
        await rename(from, to)
      })
    }
    await expect(runDesktopUpdate(f.options)).rejects.toThrow(`模拟 ${step}`)
    await f.assertClean()
  })
  it.each(['after-backup', 'after-replace'])('取消 %s 也恢复旧应用', async when => {
    const f = await fixture()
    vi.spyOn(desktopUpdateIo, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (when === 'after-backup' && String(to).endsWith('previous.app') || when === 'after-replace' && to === f.appPath) f.controller.abort(new Error('模拟取消'))
    })
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('模拟取消')
    await f.assertClean()
  })
  it('暂存清理失败不回滚成功安装，操作收尾重试删除', async () => {
    const f = await fixture(); let failed = false
    const remove = updateCleanupIo.remove
    vi.spyOn(updateCleanupIo,'remove').mockImplementation(async path => {
      if (!failed && path.includes('/desktop-update-')) { failed = true; return false }
      return remove(path)
    })
    await withUpdateCleanup(()=>{},()=>runDesktopUpdate(f.options))
    await f.assertClean('new')
  })
  it('签名核对失败且清理失败时保留原错误', async () => {
    const f = await fixture()
    f.run.mockImplementation(async (argv: string[]) => {
      if (argv[0] === '/usr/bin/ditto') { await mkdir(join(argv[4]!, 'ZCode.app'), { recursive: true }); return }
      if (argv[0] === '/usr/bin/codesign') throw new CliOperationError('EXIT_CODE','模拟签名不符')
    })
    vi.spyOn(updateCleanupIo,'remove').mockResolvedValue(false)
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('EXIT_CODE：模拟签名不符')
    expect(await readFile(join(f.appPath,'version.txt'),'utf8')).toBe('old')
  })
  it('回滚本身失败时保留唯一旧应用备份并报告路径', async () => {
    const f = await fixture()
    vi.spyOn(desktopUpdateIo, 'rename').mockImplementation(async (from, to) => {
      if (to === f.appPath) throw new Error('模拟替换及恢复均失败')
      await rename(from, to)
    })
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('旧应用保留在')
    const backup = (await readdir(f.applications)).find(name => name.startsWith('.cliworker-update-'))!
    expect(await readFile(join(f.applications, backup, 'previous.app/version.txt'), 'utf8')).toBe('old')
    expect(await readdir(join(f.root, 'cli-management'))).toEqual([])
  })
  it('进程清理未确认时保留错误类型和文件，不尝试删除', async () => {
    const f = await fixture(), failure = new ProcessCleanupUnconfirmedError({ cause: new Error('模拟解压进程未退出') })
    f.run.mockRejectedValue(failure)
    const remove = vi.spyOn(updateCleanupIo, 'remove')
    await expect(runDesktopUpdate(f.options)).rejects.toBe(failure)
    expect(remove).not.toHaveBeenCalled()
    expect(await readFile(join(f.appPath, 'version.txt'), 'utf8')).toBe('old')
  })
  it('替换前目标目录被换走时拒绝覆盖并清理', async () => {
    const f = await fixture(); let checks = 0
    f.capture.mockImplementation(async () => {
      if (++checks === 2) {
        await rename(f.appPath, join(f.root, 'original.app'))
        await mkdir(f.appPath); await writeFile(join(f.appPath, 'version.txt'), 'concurrent')
      }
      return '/sbin/launchd'
    })
    await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
    await f.assertClean('concurrent')
    expect(await readFile(join(f.root, 'original.app/version.txt'), 'utf8')).toBe('old')
  })
  it('提交后备份删除失败保留新应用，绝不恢复可能已部分删除的旧备份', async () => {
    const f = await fixture()
    const remove = updateCleanupIo.remove
    vi.spyOn(updateCleanupIo,'remove').mockImplementation(async path => path.endsWith('previous.app') ? false : remove(path))
    await expect(runDesktopUpdate(f.options)).resolves.toBeDefined()
    await f.assertClean('new')
  })
  it.each(['target', 'extracted', 'cache'])('拒绝 %s 符号链接', async where => {
    const f = await fixture(), originalRun = f.run.getMockImplementation()!
    if (where === 'target') { await rename(f.appPath, join(f.root, 'real.app')); await symlink(join(f.root, 'real.app'), f.appPath) }
    if (where === 'cache') { await mkdir(join(f.root, 'cache')); await symlink(join(f.root, 'cache'), join(f.root, 'cli-management')) }
    if (where === 'extracted') f.run.mockImplementation(async (argv, control) => {
      if (argv[1] === '-x') await symlink(f.appPath, join(argv[4]!, 'Fake.app'))
      else await originalRun(argv, control)
    })
    await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: where === 'extracted' ? 'IDENTITY_CHANGED' : 'LOCATION_INVALID' })
    expect(await readFile(join(f.appPath, 'version.txt'), 'utf8')).toBe('old')
  })
  it('国际版无法读取现有 TeamIdentifier 时拒绝下载', async () => {
    const f = await fixture('workbuddy'); f.capture.mockResolvedValue('TeamIdentifier=not set')
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('开发者签名')
    expect(f.download).not.toHaveBeenCalled(); await f.assertClean()
  })
})

describe('模拟：Windows 安装程序生命周期', () => {
  it.each(['success', 'failure', 'cancel'])('.part 下载通过同目录随机 0600 EXE 执行，%s 后清理副本', async outcome => {
    const f = await fixture('workbuddycn', 'win32'), directory = join(f.root, 'downloads')
    await mkdir(directory, { mode: 0o700 })
    const part = join(directory, 'verified.part')
    await writeFile(part, '模拟已校验安装程序', { mode: 0o600 })
    f.download.mockResolvedValue(part)
    let finish!: () => void, executable = '', settled = false
    f.run.mockImplementation(async (argv, control) => {
      expect(argv).toHaveLength(1); executable = argv[0]!
      expect(control).toBe(f.controller.signal)
      expect(dirname(executable)).toBe(directory)
      expect(basename(executable)).toMatch(/^[a-f0-9-]{36}\.exe$/)
      expect((await stat(executable)).mode & 0o777).toBe(0o600)
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect(await readFile(executable, 'utf8')).toBe('模拟已校验安装程序')
      await new Promise<void>(resolve => { finish = resolve })
      control.throwIfAborted()
      if (outcome === 'failure') throw new Error('模拟安装失败')
    })
    const pending = runDesktopUpdate(f.options).then(value => { settled = true; return value }, error => { settled = true; return error })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(f.options.awaiting).toHaveBeenCalledOnce(); expect(settled).toBe(false)
    if (outcome === 'cancel') f.controller.abort(new Error('模拟取消'))
    expect(await readFile(executable, 'utf8')).toBe('模拟已校验安装程序')
    expect(settled).toBe(false)
    finish()
    const result = await pending
    if (outcome === 'success') expect(result).toEqual({ appPath: f.appPath })
    else expect(result).toMatchObject({ message: outcome === 'cancel' ? '模拟取消' : '模拟安装失败' })
    expect(await readdir(directory)).toEqual(['verified.part'])
    expect(await readFile(part, 'utf8')).toBe('模拟已校验安装程序')
    await f.assertClean()
  })
  it('awaiting 阶段取消也清理转换后的 EXE，不启动安装程序', async () => {
    const f = await fixture('zcode', 'win32'), part = join(f.root, '模拟.part')
    await writeFile(part, '模拟内容', { mode: 0o600 }); f.download.mockResolvedValue(part)
    f.options.awaiting.mockImplementation(() => f.controller.abort(new Error('模拟取消')))
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('模拟取消')
    expect(f.run).not.toHaveBeenCalled()
    expect((await readdir(f.root)).filter(name => name.endsWith('.exe'))).toEqual([])
    expect(await readFile(part, 'utf8')).toBe('模拟内容')
  })
  it('已带大写 .EXE 后缀的路径直接执行', async () => {
    const f = await fixture('zcode', 'win32'), exe = join(f.root, '模拟.EXE')
    f.download.mockResolvedValue(exe)
    await runDesktopUpdate(f.options)
    expect(f.run).toHaveBeenCalledWith([exe], f.controller.signal)
  })
  it.each([false, true])('等待安装退出，取消=%s，不添加静默参数', async cancel => {
    const f = await fixture('workbuddycn', 'win32')
    let finish!: () => void, done = false
    f.run.mockImplementation(async (_argv, control) => {
      await new Promise<void>(resolve => { finish = resolve })
      control.throwIfAborted()
    })
    const pending = runDesktopUpdate(f.options).then(value => { done = true; return value }, error => error)
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
    expect(f.options.awaiting).toHaveBeenCalledOnce()
    expect(f.run.mock.calls[0]![0]).toEqual([join(f.root, '模拟.exe')])
    expect(done).toBe(false); expect(f.capture).not.toHaveBeenCalled()
    if (cancel) { f.controller.abort(new Error('模拟取消')); expect(done).toBe(false) }
    finish()
    const result = await pending
    expect(done).toBe(!cancel)
    if (cancel) expect(result).toMatchObject({ message: '模拟取消' })
    else expect(result).toEqual({ appPath: f.appPath })
    await f.assertClean()
  })
  it('下载失败不进入 awaiting，不启动安装器', async () => {
    const f = await fixture('zcode', 'win32'); f.download.mockRejectedValue(new Error('模拟下载失败'))
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('模拟下载失败')
    expect(f.options.awaiting).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
  })
  it('下载结束时取消，不启动安装器', async () => {
    const f = await fixture('zcode', 'win32')
    f.download.mockImplementation(async () => { f.controller.abort(new Error('模拟取消')); return '模拟.exe' })
    await expect(runDesktopUpdate(f.options)).rejects.toThrow('模拟取消')
    expect(f.run).not.toHaveBeenCalled()
  })
})

describe('模拟：只读输出探测适配器', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it.each([false, true])('读取 stdout/stderr 并等待 close，取消=%s', async cancel => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    let callback!: (error: Error | null, stdout: string, stderr: string) => void
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, cb: typeof callback) => { callback = cb; return child }) as typeof execFile)
    const controller = new AbortController()
    const pending = desktopUpdateIo.capture(['/bin/ps', '-axo', 'command='], controller.signal)
    expect(execFile).toHaveBeenCalledWith('/bin/ps', ['-axo', 'command='], expect.objectContaining({ signal: controller.signal, timeout: 30_000, killSignal: 'SIGKILL', shell: false }), expect.any(Function))
    let done = false; void pending.then(() => { done = true }, () => { done = true })
    if (cancel) { controller.abort(new Error('模拟取消')); expect(child.kill).toHaveBeenCalledWith('SIGKILL') }
    await Promise.resolve(); expect(done).toBe(false)
    callback(null, '模拟stdout', '模拟stderr'); child.emit('close', 0)
    if (cancel) await expect(pending).rejects.toThrow('模拟取消')
    else await expect(pending).resolves.toBe('模拟stdout\n模拟stderr')
  })
  it('execFile 的 30 秒超时杀死模拟子进程，等待 close 后才报告失败', async () => {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, options: { timeout: number; killSignal: string }, callback: (error: Error, stdout: string, stderr: string) => void) => {
      // Simulate execFile's native timeout contract without launching a process.
      setTimeout(() => { child.kill(options.killSignal); callback(new Error('模拟探测超时'), '', '') }, options.timeout)
      return child
    }) as typeof execFile)
    let settled = false
    const pending = desktopUpdateIo.capture(['/usr/bin/codesign', '-dv', '--verbose=2', '/模拟/WorkBuddy.app'], signal()).catch(error => { settled = true; return error })
    await vi.advanceTimersByTimeAsync(29_999); expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(settled).toBe(false)
    child.emit('close', null, 'SIGKILL')
    expect(await pending).toMatchObject({ message: '模拟探测超时' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
