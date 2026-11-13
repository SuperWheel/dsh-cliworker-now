import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliUpdatePane, formatRate } from '../src/client/cli-update-page.tsx'
import type { CliUpdateData } from '../src/client/cli-update-data.ts'
import { setLanguagePreference } from '../src/client/i18n.ts'
import type { API } from '../src/client/workers.ts'
import type { CliUpdateEntry, CliUpdateOperation, CliUpdateSnapshot } from '../src/shared/cli-management.ts'
import { CLI_IDS, CLI_LABELS } from '../src/shared/types.ts'

// 模拟：所有快照、Host 方法与下载设置都是测试夹具；不探测、不下载、不安装任何真实 CLI。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant, size, icon, ...props }: any) =>
    createElement('button', { ...props, 'data-variant': variant, 'data-size': size }, icon, children),
  Tooltip: ({ children, label, disabled }: any) =>
    createElement('span', { 'data-tip': disabled ? '' : typeof label === 'function' ? label() : label }, children),
  StateDot: ({ state }: any) => createElement('i', { 'data-state': state }),
  Input: (props: any) => createElement('input', props),
  IconChevronDownOutlineRegular: () => createElement('svg', { 'data-icon': 'chevron' }),
  IconFolderCloseRegular: () => createElement('svg', { 'data-icon': 'folder' }),
  IconRefreshOutlineRegular: () => createElement('svg', { 'data-icon': 'refresh' }),
  IconCheckOutlineRegular: () => createElement('svg'),
  writeClipboard: vi.fn(async () => true),
}))
vi.mock('../src/client/icons.tsx', () => ({
  BrandIcon: ({ cli }: any) => createElement('span', { className: 'cwn-brand', 'data-brand': cli }),
  Glyph: () => createElement('svg'),
}))
vi.mock('../src/client/cli-download-source.tsx', () => ({
  CliDownloadSourceSection: () => createElement('div', { 'data-simulated': 'download-source' }),
}))

const ok = (value: unknown) => ({ ok: true as const, value: typeof value === 'string' ? value : JSON.stringify(value) })
const entry = (cli: CliUpdateEntry['cli'], patch: Partial<CliUpdateEntry>): CliUpdateEntry => ({
  cli,
  group: 'latest',
  installed: true,
  ...patch,
})
const snapshot = (patch: Partial<CliUpdateSnapshot> = {}): CliUpdateSnapshot => ({
  revision: 1,
  activity: 'idle',
  checkedAt: 1_800_000_000_000,
  queue: [],
  results: [],
  entries: [
    entry('codex', { group: 'updatable', source: 'npm', currentVersion: '0.129.0', latestVersion: '0.130.0', planToken: 'SIMULATED-plan' }),
    entry('claude', { group: 'updatable', source: 'self-update', currentVersion: '2.1.40', latestVersion: '2.1.42', busyWorkers: 2 }),
    entry('zcode', {
      group: 'manual',
      source: 'desktop-app',
      currentVersion: '1.8.0',
      manual: { note: '打开 ZCode 桌面端检查更新', command: ['winget', 'upgrade', 'SIMULATED'], guideUrl: 'https://example.invalid/guide' },
    }),
    entry('omp', { group: 'failed', reason: 'UNKNOWN_VERSION' }),
    entry('opencode', { group: 'failed', reason: 'RELEASE_UNREACHABLE', currentVersion: '1.2.6' }),
    entry('kimi', { group: 'latest', source: 'npm', currentVersion: '1.6.0' }),
    entry('grok', {
      group: 'notInstalled',
      installed: false,
      install: { method: 'script', selectableLocation: false, prerequisites: [], defaultLocation: '~/.local/bin/grok' },
    }),
  ],
  ...patch,
})

function data(patch: Partial<CliUpdateData> = {}): CliUpdateData {
  return { snapshot: snapshot(), supported: true, retry: vi.fn(), check: vi.fn(async () => undefined), ...patch }
}

const renders: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const r of renders.splice(0)) r.unmount()
  })
  setLanguagePreference('follow')
})

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')

async function setup(pageData: CliUpdateData, remote: Record<string, unknown> = {}) {
  setLanguagePreference('zh')
  const service = {
    startCliOperation: vi.fn(async () => ok(snapshot())),
    updateAllClis: vi.fn(async () => ok(snapshot())),
    cancelCliOperation: vi.fn(async () => ok(snapshot())),
    checkInstallDirectory: vi.fn(async () => ok({ path: '', freeBytes: 90 * 1024 ** 3, requiredBytes: 480 * 1024 ** 2 })),
    chooseInstallDirectory: vi.fn(async () => ok({ path: '' })),
    ...remote,
  }
  const api = { cliworker: service, $stream: vi.fn() } as unknown as API
  const onOpenCli = vi.fn()
  let r!: ReactTestRenderer
  await act(async () => {
    r = create(<CliUpdatePane api={api} sessionId="SIMULATED/parent" data={pageData} onOpenCli={onOpenCli} />)
    renders.push(r)
  })
  const sections = () => r.root.findAll((node) => node.type === 'section')
  const section = (label: string) => sections().find((node) => node.props['aria-label'] === label)
  const rowOf = (cli: string) => r.root.find((node) => node.type === 'div' && node.props['data-cli'] === cli)
  const buttons = (scope: ReactTestInstance = r.root) => scope.findAll((node) => node.type === 'button')
  const button = (label: string, scope?: ReactTestInstance) => buttons(scope).find((node) => textOf(node) === label)
  const update = async (next: CliUpdateData) =>
    act(async () => r.update(<CliUpdatePane api={api} sessionId="SIMULATED/parent" data={next} onOpenCli={onOpenCli} />))
  return { r, service, onOpenCli, sections, section, rowOf, buttons, button, update }
}

describe('模拟「更新 CLI」页面', () => {
  it('renders every non-empty section in order with the buttons of its group', async () => {
    const pageData = data()
    const f = await setup(pageData)
    expect(pageData.check).toHaveBeenCalledWith('missing')
    expect(f.sections().map((node) => node.props['aria-label'])).toEqual([
      '检查失败',
      '可更新',
      '需要手动更新',
      '已是最新',
      '未安装',
      '下载设置',
    ])
    // Section counts are in the title; empty 「检查中」 is not rendered.
    expect(textOf(f.section('可更新')!.findByType('h3'))).toBe('可更新2')
    expect(textOf(f.rowOf('codex'))).toContain('0.129.0 → 0.130.0 · npm 全局安装')
    expect(f.button('更新', f.rowOf('codex'))!.props).toMatchObject({ 'data-size': 'md', 'data-variant': 'outline', disabled: false })
    expect(f.button('查看方法', f.rowOf('zcode'))).toBeDefined()
    expect(textOf(f.rowOf('zcode'))).toContain('1.8.0 · 由 ZCode 桌面端管理更新')
    expect(f.button('去设置路径', f.rowOf('omp'))).toBeDefined()
    expect(f.button('重新安装', f.rowOf('omp'))).toBeDefined()
    expect(f.button('重试', f.rowOf('opencode'))).toBeDefined()
    expect(f.buttons(f.rowOf('kimi'))).toHaveLength(0)
    expect(f.button('全部更新')!.props).toMatchObject({ 'data-variant': 'primary', disabled: false })
    expect(f.section('下载设置')!.findAll((node) => node.props['data-simulated'] === 'download-source')).toHaveLength(1)

    await act(async () => f.button('更新', f.rowOf('codex'))!.props.onClick())
    expect(f.service.startCliOperation).toHaveBeenCalledWith(
      'SIMULATED/parent',
      'codex',
      'update',
      'SIMULATED-plan',
      '',
      expect.any(String),
      expect.any(AbortSignal),
    )
    await act(async () => f.button('检查更新')!.props.onClick())
    expect(pageData.check).toHaveBeenCalledWith('all')
    await act(async () => f.button('去设置路径', f.rowOf('omp'))!.props.onClick())
    expect(f.onOpenCli).toHaveBeenCalledWith('omp')
  })

  it('expands the manual method bubble with a display-only command and an official guide', async () => {
    const f = await setup(data())
    await act(async () => f.button('查看方法', f.rowOf('zcode'))!.props.onClick())
    const row = f.rowOf('zcode')
    expect(f.button('收起', row)!.props['aria-expanded']).toBe(true)
    expect(textOf(row.findByProps({ className: 'cwn-update-cmd' }))).toBe('winget upgrade SIMULATED')
    expect(f.button('复制命令', row)!.props['data-size']).toBe('sm')
    expect(f.button('官方说明', row)!.props).toMatchObject({ 'data-size': 'sm', 'data-variant': 'outline' })
  })

  it('greys out updates while tasks use the CLI or another operation runs', async () => {
    const f = await setup(data())
    const claude = f.rowOf('claude')
    expect(textOf(claude)).toContain('有 2 个任务正在使用')
    expect(f.button('更新', claude)!.props.disabled).toBe(true)
    expect(claude.findAll((node) => node.props['data-tip'] === '这些任务结束或停止后才能更新')).toHaveLength(1)

    const running: CliUpdateOperation = {
      id: 'SIMULATED-op',
      intent: 'update',
      cli: 'pi',
      phase: 'downloading',
      startedAt: 1,
      targetVersion: '1.1.0',
      outputTail: '',
      progress: { readable: true, downloadedBytes: 1024, resumeCount: 0 },
    }
    const base = snapshot()
    await f.update(
      data({
        snapshot: {
          ...base,
          revision: 2,
          entries: [...base.entries, entry('pi', { group: 'updatable', source: 'npm', currentVersion: '1.0.4', latestVersion: '1.1.0' })],
          operation: running,
        },
      }),
    )
    expect(f.button('更新', f.rowOf('codex'))!.props.disabled).toBe(true)
    expect(f.rowOf('codex').findAll((node) => node.props['data-tip'] === '一次只更新一个 CLI，Pi 完成后再更新')).toHaveLength(1)
    expect(f.button('全部更新')!.props.disabled).toBe(true)
    // Total size unknown: no percentage bar, only the bytes read from the snapshot.
    const pi = f.rowOf('pi')
    expect(pi.findAll((node) => node.props.role === 'progressbar')).toHaveLength(0)
    expect(textOf(pi)).toContain('已下载 1.0 KB')
    await act(async () => f.button('取消更新', pi)!.props.onClick())
    expect(f.service.cancelCliOperation).toHaveBeenCalledWith('SIMULATED/parent', 'SIMULATED-op', expect.any(AbortSignal))
  })

  it('keeps 未安装 collapsed by default and opens it while an install runs', async () => {
    const f = await setup(data())
    const fold = () => f.section('未安装')!.findByProps({ className: 'cwn-refresh cwn-update-fold' })
    expect(fold().props['aria-expanded']).toBe(false)
    expect(f.section('未安装')!.findAll((node) => node.props['data-cli'] === 'grok')).toHaveLength(0)
    expect(f.section('可更新')!.findByProps({ className: 'cwn-refresh cwn-update-fold' }).props['aria-expanded']).toBe(true)

    await f.update(
      data({
        snapshot: snapshot({
          revision: 2,
          operation: { id: 'SIMULATED-install', intent: 'install', cli: 'grok', phase: 'installing', startedAt: 1, outputTail: '' },
        }),
      }),
    )
    expect(fold().props['aria-expanded']).toBe(true)
    expect(textOf(f.rowOf('grok'))).toContain('正在安装…')
    expect(f.button('取消安装', f.rowOf('grok'))).toBeDefined()
  })

  it('says download progress cannot be read when the snapshot marks it unreadable', async () => {
    const f = await setup(
      data({
        snapshot: snapshot({
          operation: {
            id: 'SIMULATED-op',
            intent: 'update',
            cli: 'codex',
            phase: 'downloading',
            startedAt: 1,
            targetVersion: '0.130.0',
            outputTail: '',
            progress: { readable: false, resumeCount: 0 },
          },
        }),
      }),
    )
    const row = f.rowOf('codex')
    expect(textOf(row)).toContain('正在下载 0.130.0…')
    expect(textOf(row)).toContain('下载进度无法读取')
    expect(row.findAll((node) => node.props.role === 'progressbar')).toHaveLength(0)
    expect(textOf(row)).not.toContain('已自动续传')
  })

  it('renders command output as plain text', async () => {
    const hostile = '<script>globalThis.__simulatedXss = 1</script><b>bold</b>'
    const f = await setup(
      data({
        snapshot: snapshot({
          operation: {
            id: 'SIMULATED-op',
            intent: 'update',
            cli: 'codex',
            phase: 'installing',
            startedAt: 1,
            command: ['npm', 'install', '-g', '@openai/codex@0.130.0', '--registry', 'https://registry.npmmirror.com/'],
            integritySource: 'registry.npmjs.org',
            outputTail: hostile,
          },
        }),
      }),
    )
    const log = f.rowOf('codex').findByProps({ className: 'cwn-update-log' })
    expect(log.type).toBe('pre')
    expect(log.children).toEqual([hostile])
    expect(log.props.dangerouslySetInnerHTML).toBeUndefined()
    expect(f.rowOf('codex').findAll((node) => node.type === 'script')).toHaveLength(0)
    expect((globalThis as any).__simulatedXss).toBeUndefined()
    expect(textOf(f.rowOf('codex'))).toContain('校验值来自 registry.npmjs.org')
  })

  it('shows failed results inline with retry and the download source hint', async () => {
    const failed: CliUpdateOperation = {
      id: 'SIMULATED-failed',
      intent: 'update',
      cli: 'codex',
      phase: 'failed',
      startedAt: 1,
      finishedAt: 2,
      outputTail: 'SIMULATED output',
      error: { code: 'STALL_LIMIT', message: '下载停在 21.4 MB / 48.0 MB，自动续传 200 次仍没有进展。检查网络后重试', retryable: true },
    }
    const f = await setup(data({ snapshot: snapshot({ results: [failed] }) }))
    const row = f.rowOf('codex')
    expect(row.findByProps({ className: 'cwn-update-desc' }).props['data-tone']).toBe('error')
    expect(textOf(row)).toContain('可以在页面底部切换下载源后重试')
    expect(f.button('重试', row)).toBeDefined()
    expect(f.button('收起输出', row)).toBeDefined()
    expect(textOf(row.findByProps({ className: 'cwn-update-log' }))).toBe('SIMULATED output')
  })

  it('opens the install location bubble for desktop apps and blocks an unusable folder', async () => {
    const base = snapshot()
    const desktop = entry('workbuddycn', {
      group: 'notInstalled',
      installed: false,
      install: { method: 'desktop', selectableLocation: true, prerequisites: [], defaultLocation: '/Applications' },
    })
    const f = await setup(data({ snapshot: { ...base, entries: [...base.entries, desktop] } }), {
      chooseInstallDirectory: vi.fn(async () =>
        ok({ path: '/SIMULATED/Program Files', problem: 'ADMIN_REQUIRED', message: '这个位置需要管理员权限，请换一个目录' }),
      ),
    })
    await act(async () => f.section('未安装')!.findByProps({ className: 'cwn-refresh cwn-update-fold' }).props.onClick())
    await act(async () => f.button('安装', f.rowOf('workbuddycn'))!.props.onClick())
    expect(f.service.checkInstallDirectory).toHaveBeenCalledWith('SIMULATED/parent', 'workbuddycn', '', expect.any(AbortSignal))
    let row = f.rowOf('workbuddycn')
    expect(row.findByType('input').props).toMatchObject({ value: '/Applications', readOnly: true })
    expect(textOf(row)).toContain('可用 90 GB，安装需要约 480 MB')
    expect(f.button('开始安装', row)!.props.disabled).toBe(false)
    const browse = f.buttons(row).find((node) => node.props['aria-label'] === '浏览文件夹')!
    expect(browse.props).toMatchObject({ 'data-size': 'md', 'data-variant': 'outline' })
    await act(async () => browse.props.onClick())
    row = f.rowOf('workbuddycn')
    expect(row.findByType('input').props.value).toBe('/SIMULATED/Program Files')
    expect(row.findByProps({ className: 'cwn-update-hint' }).props['data-tone']).toBe('error')
    expect(f.button('开始安装', row)!.props.disabled).toBe(true)
    await act(async () => f.button('恢复默认位置', row)!.props.onClick())
    expect(f.button('开始安装', f.rowOf('workbuddycn'))!.props.disabled).toBe(false)
    await act(async () => f.button('开始安装', f.rowOf('workbuddycn'))!.props.onClick())
    expect(f.service.startCliOperation).toHaveBeenCalledWith(
      'SIMULATED/parent', 'workbuddycn', 'install', '', '', expect.any(String), expect.any(AbortSignal),
    )
  })

  it('matches the design during an update: check disabled, elapsed time, MB/s speed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(1_800_000_042_000)
    try {
      const f = await setup(data({
        snapshot: snapshot({
          operation: {
            id: 'SIMULATED-op', intent: 'update', cli: 'codex', phase: 'downloading', startedAt: 1_800_000_000_000,
            targetVersion: '0.130.0', outputTail: '',
            progress: { readable: true, downloadedBytes: 21.4 * 1024 ** 2, totalBytes: 36.8 * 1024 ** 2, bytesPerSecond: 922 * 1024, resumeCount: 1 },
          },
        }),
      }))
      expect(f.r.root.findByProps({ className: 'cwn-update-check' }).props.disabled).toBe(true)
      const row = f.rowOf('codex')
      expect(textOf(row)).toContain('正在下载 0.130.0… 已用时 0:42')
      expect(textOf(row)).toContain('0.9 MB/s')
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(textOf(f.rowOf('codex'))).toContain('已用时 0:43')
    } finally {
      vi.useRealTimers()
    }
  })

  it('formats speeds in MB/s from 0.1 MB/s and KB/s below', () => {
    expect(formatRate(922 * 1024)).toBe('0.9 MB/s')
    expect(formatRate(1.6 * 1024 ** 2)).toBe('1.6 MB/s')
    expect(formatRate(50 * 1024)).toBe('50 KB/s')
  })

  it('names the install method and default location, and words prerequisites without a stray space', async () => {
    const base = snapshot()
    const f = await setup(data({
      snapshot: {
        ...base,
        entries: [
          ...base.entries,
          entry('hermes', {
            group: 'notInstalled', installed: false,
            install: { method: 'script', selectableLocation: false, prerequisites: [{ name: 'Git', required: '', satisfied: false }] },
          }),
        ],
        operation: { id: 'SIMULATED-install', intent: 'install', cli: 'grok', phase: 'downloading', startedAt: 1, outputTail: '' },
      },
    }))
    expect(textOf(f.rowOf('hermes'))).toContain('官方安装脚本需要 Git，这台电脑上没有找到')
    expect(textOf(f.rowOf('grok'))).toContain('安装到官方默认位置 ~/.local/bin/grok')
  })

  it('shows the Windows drive letter and whole numbers in the install location hint', async () => {
    const f = await setup(
      data({
        snapshot: snapshot({
          entries: [entry('zcode', {
            group: 'notInstalled', installed: false,
            install: { method: 'desktop', selectableLocation: true, prerequisites: [], defaultLocation: 'E:\\ZCode' },
          })],
        }),
      }),
      { checkInstallDirectory: vi.fn(async () => ok({ path: 'E:\\ZCode', freeBytes: 86 * 1024 ** 3, requiredBytes: 480 * 1024 ** 2 })) },
    )
    await act(async () => f.section('未安装')!.findByProps({ className: 'cwn-refresh cwn-update-fold' }).props.onClick())
    await act(async () => f.button('安装', f.rowOf('zcode'))!.props.onClick())
    expect(textOf(f.rowOf('zcode'))).toContain('E 盘可用 86 GB，安装需要约 480 MB')
  })

  it('hides 全部更新 during the first load until rows are regrouped into 可更新', async () => {
    const first = (cli: CliUpdateEntry['cli']) => entry(cli, { group: 'checking', stage: 'local' })
    const f = await setup(data({
      snapshot: { revision: 1, activity: 'checking', queue: [], results: [], entries: [first('codex'), first('kimi')] },
    }))
    expect(f.button('全部更新')).toBeUndefined()
    // Local reads done (first regroup): both rows still ask their release sources.
    await f.update(data({
      snapshot: {
        revision: 2, activity: 'checking', queue: [], results: [],
        entries: [
          entry('codex', { group: 'checking', stage: 'remote', currentVersion: '0.129.0' }),
          entry('kimi', { group: 'checking', stage: 'remote', currentVersion: '1.4.0' }),
        ],
      },
    }))
    // Codex's release answer arrives before Kimi's: written in place, no regroup yet.
    await f.update(data({
      snapshot: {
        revision: 3, activity: 'checking', queue: [], results: [],
        entries: [
          entry('codex', { group: 'updatable', source: 'npm', currentVersion: '0.129.0', latestVersion: '0.130.0', planToken: 'SIMULATED-plan' }),
          entry('kimi', { group: 'checking', stage: 'remote', currentVersion: '1.4.0' }),
        ],
      },
    }))
    expect(f.section('检查中')!.findAll((node) => node.props['data-cli'] === 'codex').length).toBeGreaterThan(0)
    expect(f.button('全部更新')).toBeUndefined()
    await f.update(data({
      snapshot: {
        revision: 4, activity: 'idle', checkedAt: 1_800_000_000_000, queue: [], results: [],
        entries: [
          entry('codex', { group: 'updatable', source: 'npm', currentVersion: '0.129.0', latestVersion: '0.130.0', planToken: 'SIMULATED-plan' }),
          entry('kimi', { group: 'latest', source: 'npm', currentVersion: '1.4.0' }),
        ],
      },
    }))
    expect(f.button('全部更新')).toBeDefined()
  })

  it('lists all CLIs as checking before the first snapshot without drawing skeletons', async () => {
    const f = await setup(data({ snapshot: undefined }))
    const checking = f.section('检查中')!
    expect(checking.props['aria-busy']).toBe(true)
    const rows = checking.findAll((node) => node.type === 'div' && typeof node.props['data-cli'] === 'string')
    expect(rows.map((node) => node.props['data-cli'])).toEqual([...CLI_IDS])
    expect(textOf(rows[0]!)).toBe(`${CLI_LABELS.antigravity}正在读取当前版本…`)
    expect(f.button('全部更新')).toBeUndefined()
    expect(f.buttons().find((node) => node.props['aria-label'] === '正在检查')!.props.disabled).toBe(true)
  })

  it('shows one whole-page line when the Host is too old or unreachable', async () => {
    const old = await setup(data({ snapshot: undefined, supported: false }))
    expect(old.sections()).toHaveLength(0)
    expect(textOf(old.r.root)).toContain('当前 Host 版本不支持更新 CLI，请更新 CLI Worker 插件')
    expect(old.button('检查更新')).toBeUndefined()

    const retry = vi.fn()
    const broken = await setup(data({ snapshot: undefined, error: '暂时无法连接插件服务，请稍后重试。', retry }))
    expect(broken.sections()).toHaveLength(0)
    expect(textOf(broken.r.root)).toContain('暂时无法连接插件服务，请稍后重试。')
    const button = broken.button('重试')!
    expect(button.props).toMatchObject({ 'data-size': 'md', 'data-variant': 'outline' })
    await act(async () => button.props.onClick())
    expect(retry).toHaveBeenCalled()
  })

  it('keeps the last results visible with a retry line when a later update fails', async () => {
    const retry = vi.fn()
    const page = await setup(data({ snapshot: snapshot(), error: '收到无效的 CLI 更新状态，请重试', retry }))
    expect(page.sections().length).toBeGreaterThan(0)
    expect(textOf(page.r.root)).toContain('收到无效的 CLI 更新状态，请重试')
    expect(page.button('检查更新')).toBeDefined()
    await act(async () => page.button('重试')!.props.onClick())
    expect(retry).toHaveBeenCalled()
  })

  // 模拟：notice 文案取自 Host 的 Pi / Hermes 说明格式，快照与调用全部是夹具。
  const piNotice = '插件尚未适配 Pi 0.80.0，更新后 Pi Worker 要等插件适配后才能使用'
  const hermesNotice = 'SIMULATED <b>Hermes</b> 更新会迁移配置并重启服务'
  const noticed = (patch: Partial<CliUpdateSnapshot> = {}) => {
    const base = snapshot()
    return snapshot({
      entries: [
        ...base.entries,
        entry('pi', { group: 'updatable', source: 'npm', currentVersion: '0.74.0', latestVersion: '0.80.0', planToken: 'SIMULATED-pi', notice: piNotice }),
        entry('hermes', { group: 'updatable', source: 'official-installer', currentVersion: '0.12.0', latestVersion: '0.13.0', planToken: 'SIMULATED-hermes', notice: hermesNotice }),
      ],
      ...patch,
    })
  }

  it('shows the notice under an updatable row and asks before updating it', async () => {
    const f = await setup(data({ snapshot: noticed() }))
    const notice = f.rowOf('pi').findByProps({ className: 'cwn-update-notice' })
    expect(notice.props['data-tone']).toBe('warn')
    expect(textOf(notice)).toBe(piNotice)
    // Untrusted Host text stays plain text.
    expect(textOf(f.rowOf('hermes').findByProps({ className: 'cwn-update-notice' }))).toBe(hermesNotice)
    expect(f.rowOf('hermes').findAll((node) => node.type === 'b')).toHaveLength(0)
    expect(f.rowOf('codex').findAll((node) => node.props.className === 'cwn-update-notice')).toHaveLength(0)

    await act(async () => f.button('更新', f.rowOf('pi'))!.props.onClick())
    expect(f.service.startCliOperation).not.toHaveBeenCalled()
    expect(f.button('更新', f.rowOf('pi'))!.props['aria-expanded']).toBe(true)
    const confirm = f.rowOf('pi').find((node) => node.props.role === 'group')
    expect(textOf(confirm)).toBe(`更新 Pi 前请确认：${piNotice}取消继续更新`)
    expect(f.button('继续更新', confirm)!.props).toMatchObject({ 'data-size': 'sm', 'data-variant': 'outline', disabled: false })
    expect(f.button('取消', confirm)!.props).toMatchObject({ 'data-size': 'sm', 'data-variant': 'ghost' })

    await act(async () => f.button('取消', confirm)!.props.onClick())
    expect(f.rowOf('pi').findAll((node) => node.props.role === 'group')).toHaveLength(0)
    expect(f.service.startCliOperation).not.toHaveBeenCalled()

    await act(async () => f.button('更新', f.rowOf('pi'))!.props.onClick())
    await act(async () => f.button('继续更新', f.rowOf('pi'))!.props.onClick())
    expect(f.service.startCliOperation).toHaveBeenCalledTimes(1)
    expect(f.service.startCliOperation).toHaveBeenCalledWith(
      'SIMULATED/parent', 'pi', 'update', 'SIMULATED-pi', '', expect.any(String), expect.any(AbortSignal),
    )
    expect(f.rowOf('pi').findAll((node) => node.props.role === 'group')).toHaveLength(0)
  })

  it('asks again before retrying a failed update of a row with a notice', async () => {
    const failed: CliUpdateOperation = {
      id: 'SIMULATED-failed', intent: 'update', cli: 'pi', phase: 'failed', startedAt: 1, finishedAt: 2, outputTail: 'SIMULATED output',
      error: { code: 'UNKNOWN', message: '更新失败', retryable: true },
    }
    const f = await setup(data({ snapshot: noticed({ results: [failed] }) }))
    await act(async () => f.button('重试', f.rowOf('pi'))!.props.onClick())
    expect(f.service.startCliOperation).not.toHaveBeenCalled()
    // The open output and the confirmation are shown together.
    expect(f.rowOf('pi').findAll((node) => node.props.className === 'cwn-update-log')).toHaveLength(1)
    await act(async () => f.button('继续更新', f.rowOf('pi'))!.props.onClick())
    expect(f.service.startCliOperation).toHaveBeenCalledWith(
      'SIMULATED/parent', 'pi', 'update', 'SIMULATED-pi', '', expect.any(String), expect.any(AbortSignal),
    )
  })

  it('updates all at once without asking when no row carries a notice', async () => {
    const f = await setup(data())
    expect(f.button('全部更新')!.props['aria-expanded']).toBeUndefined()
    await act(async () => f.button('全部更新')!.props.onClick())
    expect(f.service.updateAllClis).toHaveBeenCalledTimes(1)
  })

  it('lists every noticed CLI that 全部更新 would include and starts only after confirmation', async () => {
    const f = await setup(data({ snapshot: noticed() }))
    await act(async () => f.button('全部更新')!.props.onClick())
    expect(f.service.updateAllClis).not.toHaveBeenCalled()
    expect(f.button('全部更新')!.props['aria-expanded']).toBe(true)
    const confirm = () => f.r.root.find((node) => node.props['aria-label'] === '确认全部更新')
    // Host order (CLI_IDS): Pi before Hermes; rows without a notice are not listed.
    expect(confirm().findAllByType('li').map(textOf)).toEqual([`Pi：${piNotice}`, `Hermes Agent：${hermesNotice}`])
    expect(confirm().findAll((node) => node.type === 'b')).toHaveLength(0)

    await act(async () => f.button('取消', confirm())!.props.onClick())
    expect(f.r.root.findAll((node) => node.props['aria-label'] === '确认全部更新')).toHaveLength(0)
    expect(f.service.updateAllClis).not.toHaveBeenCalled()

    await act(async () => f.button('全部更新')!.props.onClick())
    await act(async () => f.button('继续更新', confirm())!.props.onClick())
    expect(f.service.updateAllClis).toHaveBeenCalledTimes(1)
    expect(f.service.updateAllClis).toHaveBeenCalledWith('SIMULATED/parent', expect.any(String), expect.any(AbortSignal))
    expect(f.service.startCliOperation).not.toHaveBeenCalled()
    expect(f.r.root.findAll((node) => node.props['aria-label'] === '确认全部更新')).toHaveLength(0)
  })

  it('shows desktop app and CLI versions separately, with the arrow on the app version', async () => {
    const f = await setup(data({
      snapshot: snapshot({
        entries: [
          entry('workbuddycn', {
            group: 'updatable', source: 'desktop-app', appVersion: '4.1.2.1234', currentVersion: '2.3.0',
            latestVersion: '4.2.0', planToken: 'SIMULATED-wb',
          }),
          entry('zcode', { group: 'latest', source: 'desktop-app', appVersion: '1.9.0' }),
          entry('workbuddy', { group: 'latest', source: 'desktop-app', appVersion: '4.1.2.1234', currentVersion: '2.3.0', latestVersion: '4.1.2', latestCompatibleVersion: '4.1.2' }),
          // A CLI inside an .app bundle keeps CLI-version semantics.
          entry('kimi', { group: 'updatable', source: 'npm', appVersion: '9.9.9', currentVersion: '1.6.0', latestVersion: '1.7.0', planToken: 'SIMULATED-kimi' }),
        ],
      }),
    }))
    expect(textOf(f.rowOf('workbuddycn'))).toContain('应用 4.1.2.1234 → 4.2.0 · CLI 2.3.0 · 由 WorkBuddy CN 桌面端管理更新')
    expect(textOf(f.rowOf('zcode'))).toContain('应用 1.9.0 · 由 ZCode 桌面端管理更新')
    expect(textOf(f.rowOf('zcode'))).not.toContain('CLI ')
    expect(textOf(f.rowOf('workbuddy'))).toContain('应用 4.1.2.1234 · CLI 2.3.0 · 由 WorkBuddy 桌面端管理更新')
    expect(textOf(f.rowOf('kimi'))).toContain('1.6.0 → 1.7.0 · npm 全局安装')
    expect(textOf(f.rowOf('kimi'))).not.toContain('应用')
  })

  it('names only a non-default installation channel', async () => {
    const f = await setup(data({
      snapshot: snapshot({
        entries: [
          entry('hermes', { group: 'updatable', source: 'official-installer', currentVersion: '0.12.0', latestVersion: '0.13.0', channel: 'canary', planToken: 'SIMULATED-h' }),
          entry('traecn', { group: 'latest', source: 'self-update', currentVersion: '1.0.0', channel: 'tob' }),
          entry('kimi', { group: 'latest', source: 'npm', currentVersion: '1.6.0', channel: 'unknown' }),
          entry('codex', { group: 'latest', source: 'npm', currentVersion: '0.130.0', channel: 'stable' }),
          entry('qoder', { group: 'latest', source: 'npm', currentVersion: '0.5.0', channel: 'public' }),
        ],
      }),
    }))
    expect(textOf(f.rowOf('hermes'))).toContain('0.12.0 → 0.13.0 · canary 通道 · 官方安装器')
    expect(textOf(f.rowOf('traecn'))).toContain('1.0.0 · tob 通道 · TRAE CN 自带更新')
    for (const cli of ['kimi', 'codex', 'qoder']) expect(textOf(f.rowOf(cli))).not.toContain('通道')
  })

  it('translates the known Host notices for the English interface', async () => {
    const f = await setup(data({ snapshot: noticed() }))
    setLanguagePreference('en')
    await f.update(data({ snapshot: noticed({ revision: 2 }) }))
    expect(textOf(f.rowOf('pi').findByProps({ className: 'cwn-update-notice' }))).toBe(
      'The plugin does not support Pi 0.80.0 yet. After the update, Pi Workers cannot be used until the plugin supports it',
    )
    // Unknown Host text stays verbatim rather than guessing a translation.
    expect(textOf(f.rowOf('hermes').findByProps({ className: 'cwn-update-notice' }))).toBe(hermesNotice)
  })

  it('greys out write buttons on a Host without the write methods', async () => {
    const f = await setup(data(), { startCliOperation: undefined, updateAllClis: undefined })
    expect(f.button('更新', f.rowOf('codex'))!.props.disabled).toBe(true)
    expect(f.button('全部更新')!.props.disabled).toBe(true)
    expect(
      f.rowOf('codex').findAll((node) => node.props['data-tip'] === '当前 Host 版本不支持此操作，请更新 CLI Worker 插件'),
    ).toHaveLength(1)
  })
})
