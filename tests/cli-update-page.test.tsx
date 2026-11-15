import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliUpdatePane, formatRate, recentFailureText } from '../src/client/cli-update-page.tsx'
import type { CliUpdateData } from '../src/client/cli-update-data.ts'
import { setLanguagePreference } from '../src/client/i18n.ts'
import type { API } from '../src/client/workers.ts'
import type { CliDownloadProgress, CliUpdateEntry, CliUpdateOperation, CliUpdateSnapshot } from '../src/shared/cli-management.ts'
import { CLI_IDS, CLI_LABELS } from '../src/shared/types.ts'

// 模拟：所有快照、Host 方法与下载设置都是测试夹具；不探测、不下载、不安装任何真实 CLI。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant, size, icon, ...props }: any) =>
    createElement('button', { ...props, 'data-variant': variant, 'data-size': size }, icon, children),
  Tooltip: ({ children, label, disabled, onlyWhenClipped }: any) =>
    createElement(
      'span',
      { 'data-tip': disabled ? '' : typeof label === 'function' ? label() : label, 'data-tip-clipped': onlyWhenClipped || undefined },
      children,
    ),
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
    expect(textOf(f.rowOf('zcode'))).toContain('1.8.0 · ZCode 桌面应用，下载官方安装包更新')
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

  it('toggles a section from anywhere on its head row, not only the chevron', async () => {
    const f = await setup(data())
    const head = () => f.section('未安装')!.findByProps({ className: 'cwn-settings-section-head cwn-update-section-toggle' })
    const fold = () => f.section('未安装')!.findByProps({ className: 'cwn-refresh cwn-update-fold' })
    expect(fold().props['aria-expanded']).toBe(false)
    const target = { closest: () => null }
    await act(async () => head().props.onClick({ target }))
    expect(fold().props['aria-expanded']).toBe(true)
    await act(async () => head().props.onClick({ target }))
    expect(fold().props['aria-expanded']).toBe(false)
    // A click on the chevron itself is handled by the button only, never twice.
    await act(async () => head().props.onClick({ target: { closest: () => ({}) } }))
    expect(fold().props['aria-expanded']).toBe(false)
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
    expect(textOf(row)).not.toContain('已自动重试')

    // 模拟：外部命令因下载中断重跑后，次数与 HTTP 续传分开显示。
    await f.update(
      data({
        snapshot: snapshot({
          revision: 3,
          operation: {
            id: 'SIMULATED-op', intent: 'update', cli: 'codex', phase: 'downloading', startedAt: 1,
            targetVersion: '0.130.0', outputTail: '', progress: { readable: false, resumeCount: 0, retryCount: 2 },
          },
        }),
      }),
    )
    expect(textOf(f.rowOf('codex'))).toContain('下载进度无法读取已自动重试 2 次')
    expect(textOf(f.rowOf('codex'))).not.toContain('已自动续传')

    // 模拟：插件下载换源后，进度行写出当前来源 host。
    await f.update(
      data({
        snapshot: snapshot({
          revision: 4,
          operation: {
            id: 'SIMULATED-op', intent: 'update', cli: 'codex', phase: 'downloading', startedAt: 1, targetVersion: '0.130.0', outputTail: '',
            progress: { readable: true, downloadedBytes: 1024, totalBytes: 2048, resumeCount: 1, sourceHost: 'registry.npmmirror.example' },
          },
        }),
      }),
    )
    expect(textOf(f.rowOf('codex'))).toContain('来自 registry.npmmirror.example')
    expect(textOf(f.rowOf('codex'))).toContain('已自动续传 1 次')
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

  it('keeps the notice out of the row and asks before updating it', async () => {
    const f = await setup(data({ snapshot: noticed() }))
    // The row itself carries no notice text; it appears only in the confirmation.
    for (const cli of ['pi', 'hermes', 'codex']) {
      expect(f.rowOf(cli).findAll((node) => node.props.className === 'cwn-update-notice')).toHaveLength(0)
      expect(textOf(f.rowOf(cli))).not.toContain('请确认')
    }
    expect(textOf(f.rowOf('pi'))).not.toContain(piNotice)

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
          entry('zcode', { group: 'latest', source: 'desktop-app', appVersion: '1.9.0', currentVersion: '1.9.0' }),
          entry('workbuddy', { group: 'latest', source: 'desktop-app', appVersion: '4.1.2.1234', currentVersion: '2.3.0', latestVersion: '4.1.2', latestCompatibleVersion: '4.1.2' }),
          // A CLI inside an .app bundle keeps CLI-version semantics.
          entry('kimi', { group: 'updatable', source: 'npm', appVersion: '9.9.9', currentVersion: '1.6.0', latestVersion: '1.7.0', planToken: 'SIMULATED-kimi' }),
        ],
      }),
    }))
    expect(textOf(f.rowOf('workbuddycn'))).toContain('应用 4.1.2.1234 → 4.2.0 · CLI 2.3.0 · WorkBuddy CN 桌面应用，下载官方安装包更新')
    expect(textOf(f.rowOf('zcode'))).toContain('应用 1.9.0 · ZCode 桌面应用，下载官方安装包更新')
    expect(textOf(f.rowOf('zcode'))).not.toContain('CLI ')
    expect(textOf(f.rowOf('workbuddy'))).toContain('应用 4.1.2.1234 · CLI 2.3.0 · WorkBuddy 桌面应用，下载官方安装包更新')
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
    await act(async () => f.button('Update', f.rowOf('pi'))!.props.onClick())
    expect(textOf(f.rowOf('pi').find((node) => node.props.role === 'group'))).toContain(
      'The plugin does not support Pi 0.80.0 yet. After the update, Pi Workers cannot be used until the plugin supports it',
    )
    // Unknown Host text stays verbatim rather than guessing a translation.
    await act(async () => f.button('Update', f.rowOf('hermes'))!.props.onClick())
    expect(textOf(f.rowOf('hermes').find((node) => node.props.role === 'group'))).toContain(hermesNotice)
    expect(f.rowOf('hermes').findAll((node) => node.type === 'b')).toHaveLength(0)
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

describe('模拟「更新 CLI」进度行：来源、切换原因、合计与阶段', () => {
  // 模拟：以下进度全部是夹具，字段组合与 Host 的 cliDownloadProgressSchema 一致；没有真实下载。
  const running = (progress: CliDownloadProgress & { officialFailedAt?: number }, patch: Partial<CliUpdateOperation> = {}) =>
    data({
      snapshot: snapshot({
        operation: {
          id: 'SIMULATED-op', intent: 'update', cli: 'codex', phase: 'downloading', startedAt: 1,
          targetVersion: '0.130.0', outputTail: '', progress, ...patch,
        },
      }),
    })
  const byClass = (scope: ReactTestInstance, name: string) =>
    scope.findAll((node) => typeof node.type === 'string' && String(node.props.className ?? '').split(' ').includes(name))
  const bars = (scope: ReactTestInstance) => scope.findAll((node) => typeof node.type === 'string' && node.props.role === 'progressbar')
  const hints = (scope: ReactTestInstance) => byClass(scope, 'cwn-update-hint').map(textOf)
  /** Class names of host elements in document order (component instances such as <Progress> are skipped). */
  const classOrder = (scope: ReactTestInstance) =>
    scope.findAll((node) => typeof node.type === 'string').map((node) => String(node.props.className ?? '').split(' ')[0])

  it('labels the channel after the description and leaves rows without a channel untouched', async () => {
    const f = await setup(running({ channel: 'official', readable: true, byteProgress: true, byteProgressState: 'known-total', downloadedBytes: 1024, totalBytes: 4096, resumeCount: 0 }))
    const tag = () => byClass(f.rowOf('codex'), 'cwn-update-chan')
    expect(tag().map(textOf)).toEqual(['官方'])
    expect(tag()[0]!.props['data-channel']).toBe('official')
    // The tag sits in the description line, after the phase text.
    expect(byClass(f.rowOf('codex'), 'cwn-update-desc')[0]!.findAll((node) => node === tag()[0])).toHaveLength(1)

    await f.update(running({ channel: 'takeover', readable: true, byteProgress: true, byteProgressState: 'known-total', downloadedBytes: 1024, totalBytes: 4096, resumeCount: 0 }))
    expect(tag().map(textOf)).toEqual(['插件接管'])
    expect(tag()[0]!.props['data-channel']).toBe('takeover')

    // npm and other existing paths carry no channel: no tag at all.
    await f.update(running({ readable: true, downloadedBytes: 1024, totalBytes: 4096, resumeCount: 0 }))
    expect(tag()).toHaveLength(0)
  })

  it.each([
    ['OFFICIAL_STALLED', '官方下载 30 秒没有新数据'],
    ['OFFICIAL_SLOW', '官方下载速度过低'],
    ['OFFICIAL_DEADLINE', '官方下载预计超过官方时限'],
    ['OFFICIAL_RESTARTED', '官方下载从头重来'],
    ['OFFICIAL_INTERRUPTED', '官方下载中断'],
    ['OFFICIAL_EXIT', '官方更新失败退出'],
    ['OFFICIAL_BUDGET', '官方更新超过时间预算'],
  ] as const)('explains a switch to the plugin download caused by %s', async (reason, cause) => {
    // Claude updates itself: the plugin stops that updater before downloading.
    const f = await setup(running({ channel: 'takeover', reason, readable: false, byteProgress: false, resumeCount: 0, stage: '官方进程已退出，切换插件接管' }, { cli: 'claude' }))
    const row = f.rowOf('claude')
    const callouts = byClass(row, 'cwn-update-callout')
    expect(callouts.map(textOf)).toEqual([
      `${cause}，已停止官方更新并删除它留下的半成品，改由插件下载。之后 7 天内，这台电脑更新 Claude Code 会直接由插件下载。`,
    ])
    // The Host's own transition note would only repeat the callout; nothing pretends to be progress.
    expect(textOf(row)).not.toContain('官方进程已退出')
    expect(bars(row)).toHaveLength(0)
    expect(textOf(row)).not.toContain('下载进度无法读取')
  })

  it('says an npm takeover only switches sources and keeps the downloaded part', async () => {
    // Codex is npm-installed: the plugin already downloads the official packages, so nothing is stopped or deleted.
    const f = await setup(running({
      channel: 'takeover', reason: 'OFFICIAL_SLOW', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 60 * 1024 ** 2, totalBytes: 178 * 1024 ** 2, resumeCount: 1, sourceHost: 'registry.npmjs.org',
    }))
    const callout = byClass(f.rowOf('codex'), 'cwn-update-callout').map(textOf)
    expect(callout).toEqual([
      '官方下载速度过低，改由插件换源继续下载，已下载的部分保留。之后 7 天内，这台电脑更新 Codex 会直接由插件换源下载。',
    ])
    expect(callout.join('')).not.toContain('半成品')
  })

  it('keeps the switch callout above the plugin progress once bytes arrive', async () => {
    const f = await setup(running({
      channel: 'takeover', reason: 'OFFICIAL_STALLED', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 146 * 1024 ** 2, totalBytes: 240 * 1024 ** 2, resumeCount: 2, sourceHost: 'simulated.r2.example',
    }))
    const expand = byClass(f.rowOf('codex'), 'cwn-update-expand')[0]!
    const order = classOrder(expand)
    expect(order.indexOf('cwn-update-callout')).toBeLessThan(order.indexOf('cwn-update-progress'))
    expect(byClass(expand, 'cwn-update-meta-side').map(textOf)).toEqual(['已自动续传 2 次'])
  })

  it('shows no callout for an official run or for the remembered recent failure', async () => {
    const f = await setup(running({ channel: 'official', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0, stage: '执行官方更新命令' }))
    expect(byClass(f.rowOf('codex'), 'cwn-update-callout')).toHaveLength(0)
    // Claude updates itself (not npm): the plugin replaces the official updater for 7 days.
    await f.update(running({ channel: 'takeover', reason: 'OFFICIAL_RECENT_FAILURE', readable: false, byteProgress: false, resumeCount: 0, stage: '官方渠道近期在本机失败（7 天内），直接接管' }, { cli: 'claude' }))
    const row = f.rowOf('claude')
    expect(byClass(row, 'cwn-update-callout')).toHaveLength(0)
    expect(hints(row)).toEqual(['官方更新近期在这台电脑上失败，7 天内直接由插件下载'])
    expect(textOf(row)).not.toContain('官方渠道近期在本机失败')
  })

  it('counts the days since the remembered official failure when the Host sends officialFailedAt', async () => {
    const now = 1_800_000_000_000
    expect(recentFailureText(now - 2.5 * 86_400_000, now)).toBe('官方更新 2 天前在这台电脑上失败，7 天内直接由插件下载')
    expect(recentFailureText(now - 3 * 3_600_000, now)).toBe('官方更新今天在这台电脑上失败，7 天内直接由插件下载')
    // A clock that moved backwards still reads as today, never a negative day count.
    expect(recentFailureText(now + 60_000, now)).toBe('官方更新今天在这台电脑上失败，7 天内直接由插件下载')
    expect(recentFailureText(undefined, now)).toBe('官方更新近期在这台电脑上失败，7 天内直接由插件下载')
    expect(recentFailureText('yesterday', now)).toBe('官方更新近期在这台电脑上失败，7 天内直接由插件下载')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    try {
      const f = await setup(running({
        channel: 'takeover', reason: 'OFFICIAL_RECENT_FAILURE', officialFailedAt: now - 2 * 86_400_000 - 1000,
        readable: true, byteProgress: true, byteProgressState: 'known-total', fileCount: 3, completedFiles: 1,
        currentStep: 2, totalSteps: 3, stepName: 'SIMULATED/bin.tar.gz',
        downloadedBytes: 120 * 1024 ** 2, totalBytes: 194 * 1024 ** 2, bytesPerSecond: 2.1 * 1024 ** 2, resumeCount: 4, sourceHost: 'lf-cdn.simulated.example',
      }, { cli: 'claude' }))
      const row = f.rowOf('claude')
      // Progress first, then the hint underneath.
      const expand = byClass(row, 'cwn-update-expand')[0]!
      const order = classOrder(expand)
      expect(order.indexOf('cwn-update-progress')).toBeLessThan(order.indexOf('cwn-update-hint'))
      expect(hints(row)).toEqual(['官方更新 2 天前在这台电脑上失败，7 天内直接由插件下载'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefixes the file count for a multi-file total, ends with the source host and keeps the side count apart', async () => {
    const f = await setup(running({
      channel: 'takeover', readable: true, byteProgress: true, byteProgressState: 'known-total', fileCount: 3, completedFiles: 1,
      currentStep: 2, totalSteps: 3, stepName: 'SIMULATED/bin.tar.gz',
      downloadedBytes: 120 * 1024 ** 2, totalBytes: 194 * 1024 ** 2, bytesPerSecond: 2.1 * 1024 ** 2, resumeCount: 4, sourceHost: 'lf-cdn.simulated.example',
    }))
    const row = f.rowOf('codex')
    const main = byClass(row, 'cwn-update-meta-main')
    expect(main.map(textOf)).toEqual(['3 个文件 · 已下载 120 MB / 194 MB · 2.1 MB/s · 来自 lf-cdn.simulated.example'])
    // The whole line (file count, sum, host) is the tooltip text when it gets cut.
    expect(main[0]!.parent!.props['data-tip']).toBe(textOf(main[0]!))
    // The host sits in its own span at the very end so a long host is what gets cut.
    expect(byClass(main[0]!, 'cwn-update-meta-lead').map(textOf)).toEqual(['3 个文件 · 已下载 120 MB / 194 MB · 2.1 MB/s'])
    expect(byClass(main[0]!, 'cwn-update-meta-host').map(textOf)).toEqual([' · 来自 lf-cdn.simulated.example'])
    expect(byClass(row, 'cwn-update-meta-side').map(textOf)).toEqual(['已自动续传 4 次'])
    // One byte bar for the sum of every file; no per-file step bar alongside it.
    const bar = bars(row)
    expect(bar).toHaveLength(1)
    expect(bar[0]!.props).toMatchObject({ 'aria-valuemax': 100, 'aria-valuenow': 62 })
    expect(textOf(row)).not.toContain('第 2/3 步')

    await f.update(running({
      channel: 'takeover', readable: true, byteProgress: true, byteProgressState: 'known-total', fileCount: 1,
      downloadedBytes: 1024, totalBytes: 4096, resumeCount: 0,
    }))
    expect(byClass(f.rowOf('codex'), 'cwn-update-meta-main').map(textOf)).toEqual(['已下载 1.0 KB / 4.0 KB'])
  })

  it('cuts only a long source host on one line, keeps the stall seconds before it and shows the full host on hover (13.5)', async () => {
    // 模拟：OMP 预签名下载那种很长的主机名；数值为夹具。
    const host = '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.simulated.example'
    const f = await setup(running({
      channel: 'takeover', reason: 'OFFICIAL_BUDGET', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 152 * 1024 ** 2, totalBytes: 240 * 1024 ** 2, bytesPerSecond: 0, stalledSeconds: 6, resumeCount: 3, sourceHost: host,
    }, { cli: 'omp' }))
    const row = f.rowOf('omp')
    const [main, ...more] = byClass(row, 'cwn-update-meta-main')
    expect(more).toHaveLength(0)
    expect(main!.props['data-host']).toBe(true)
    expect(textOf(main!)).toBe(`已下载 152 MB / 240 MB · 6 秒没有新数据 · 来自 ${host}`)
    // Hover or keyboard focus shows the full line, full host included, through the Harness Tooltip
    // (only while something is cut); no native title, which would add a second bubble.
    const tip = main!.parent!
    expect(tip.props['data-tip']).toBe(`已下载 152 MB / 240 MB · 6 秒没有新数据 · 来自 ${host}`)
    expect(tip.props['data-tip-clipped']).toBe(true)
    expect(main!.props.tabIndex).toBe(0)
    expect(main!.props.title).toBeUndefined()
    const [hostSpan] = byClass(main!, 'cwn-update-meta-host')
    expect(textOf(hostSpan!)).toBe(` · 来自 ${host}`)
    expect(hostSpan!.props.title).toBeUndefined()
    // Same flex line as the resume count; nothing breaks onto a separate line.
    const meta = byClass(row, 'cwn-update-progress-meta')
    expect(meta).toHaveLength(1)
    expect(byClass(meta[0]!, 'cwn-update-meta-side').map(textOf)).toEqual(['已自动续传 3 次'])
    // The page CSS keeps the lead whole and truncates the host span with an ellipsis, never wrapping it.
    const { cliUpdateStyles } = await import('../src/client/cli-update-styles.ts')
    expect(cliUpdateStyles).toContain('.cwn-update-meta-main[data-host]{display:flex;border-radius:2px}')
    expect(cliUpdateStyles).toContain('.cwn-update-meta-main[data-host]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}')
    expect(cliUpdateStyles).toContain('.cwn-update-meta-lead{flex:0 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
    expect(cliUpdateStyles).toContain('.cwn-update-meta-host{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre}')
    expect(cliUpdateStyles).toMatch(/\.cwn-update-progress-meta\{[^}]*flex-wrap:nowrap/)

    // Lines without bytes never name a host.
    await f.update(running({ channel: 'takeover', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0, stage: '准备官方本地安装入口', sourceHost: host }, { cli: 'omp', phase: 'installing' }))
    expect(byClass(f.rowOf('omp'), 'cwn-update-meta-main').map(textOf)).toEqual(['准备官方本地安装入口'])
    expect(byClass(f.rowOf('omp'), 'cwn-update-meta-host')).toHaveLength(0)
    // A line without a host is not an extra tab stop and keeps its plain title.
    const [stageLine] = byClass(f.rowOf('omp'), 'cwn-update-meta-main')
    expect(stageLine!.props.tabIndex).toBeUndefined()
    expect(stageLine!.props.title).toBe('准备官方本地安装入口')
  })

  it('keeps a multi-file total from the Host downloader: the bar and resume count never restart per file (13.5 TRAE)', async () => {
    // 模拟：用 Host 统一下载器 downloadDescription 生成真实进度序列；传输层以夹具代替，每个文件的传输计数从 0 开始、各续传 2 次。
    const { mkdtemp, realpath, rm, writeFile, mkdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { downloadDescription } = await import('../src/host/cli-management/artifacts/download.ts')
    const { cliDownloadProgressSchema } = await import('../src/shared/cli-management.ts')
    const root = await realpath(await mkdtemp(join(tmpdir(), 'cli-update-page-simulated-')))
    try {
      const directory = join(root, 'bundle')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const mb = 1024 ** 2
      const sizes: Record<string, number> = { 'traex-simulated.exe.gz': 141 * mb, 'code-mode-host-simulated.exe.gz': 9 * mb }
      const files = Object.entries(sizes).map(([name, bytes]) => ({
        sources: [`https://lf-cdn.simulated.example/${name}`], bytes, integrity: 'sha256-SIMULATED', dest: `artifacts/${name}`,
      }))
      const seen: CliDownloadProgress[] = []
      await downloadDescription({ files }, {
        root, directory, signal: new AbortController().signal,
        progress: (value) => seen.push(cliDownloadProgressSchema.parse(value)),
        download: async (input) => {
          const name = new URL(input.url).pathname.slice(1), size = sizes[name]!
          const base = { channel: 'takeover' as const, readable: true, byteProgress: true, byteProgressState: 'known-total' as const, totalBytes: size, sourceHost: 'lf-cdn.simulated.example' }
          input.progress!({ ...base, downloadedBytes: Math.floor(size / 3), bytesPerSecond: 2 * mb, resumeCount: 0 })
          input.progress!({ ...base, downloadedBytes: Math.floor((size * 2) / 3), bytesPerSecond: 2 * mb, resumeCount: 1 })
          input.progress!({ ...base, downloadedBytes: size, bytesPerSecond: 2 * mb, resumeCount: 2 })
          const path = join(root, `${name}.part`)
          await writeFile(path, 'SIMULATED')
          return path
        },
      })
      expect(seen.length).toBeGreaterThan(4)
      const f = await setup(running(seen[0]!))
      const percents: number[] = [], sides: string[] = [], leads: string[] = []
      for (const value of seen) {
        await f.update(running(value))
        const row = f.rowOf('codex')
        const [bar, ...others] = bars(row)
        expect(others).toHaveLength(0)
        percents.push(bar!.props['aria-valuenow'])
        sides.push(byClass(row, 'cwn-update-meta-side').map(textOf).join(''))
        leads.push(byClass(row, 'cwn-update-meta-lead').map(textOf).join(''))
      }
      expect(percents.every((value, index) => index === 0 || value >= percents[index - 1]!)).toBe(true)
      expect(percents.at(-1)).toBe(100)
      // Every line shows the sum of both files against the same 150 MB total.
      expect(leads.every((text) => text.startsWith('2 个文件 · 已下载 ') && text.includes(' / 150 MB'))).toBe(true)
      const counts = sides.map((text) => Number(/已自动续传 (\d+) 次/.exec(text)?.[1]))
      expect(counts.every((value, index) => index === 0 || value >= counts[index - 1]!)).toBe(true)
      expect(counts.at(-1)).toBe(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prefixes the file count when several files arrive without a known total', async () => {
    // 模拟：官方更新器暂存多个文件、总量未知（Host official-watch 只给 fileCount 与已接收字节）。
    const f = await setup(running({
      channel: 'official', readable: true, byteProgress: true, byteProgressState: 'unknown-total', fileCount: 2,
      downloadedBytes: 30 * 1024 ** 2, bytesPerSecond: 1.5 * 1024 ** 2, resumeCount: 0,
    }))
    const row = f.rowOf('codex')
    expect(bars(row)).toHaveLength(0)
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['2 个文件 · 已接收 30.0 MB，总大小未知 · 1.5 MB/s'])
  })

  it('keeps the phase text and elapsed time while installing after a plugin download', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(1_800_000_075_000)
    try {
      const f = await setup(running(
        { channel: 'takeover', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0, stage: '准备官方本地安装入口' },
        { cli: 'claude', phase: 'installing', startedAt: 1_800_000_000_000, targetVersion: '2.1.42' },
      ))
      const row = f.rowOf('claude')
      expect(textOf(byClass(row, 'cwn-update-desc')[0]!)).toBe('正在安装 2.1.42… 已用时 1:15插件接管')
      expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['准备官方本地安装入口'])
      expect(bars(row)).toHaveLength(0)
      await f.update(running(
        { channel: 'takeover', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0 },
        { cli: 'claude', phase: 'verifying-installation', startedAt: 1_800_000_000_000, targetVersion: '2.1.42' },
      ))
      expect(textOf(byClass(f.rowOf('claude'), 'cwn-update-desc')[0]!)).toBe('正在核对结果… 已用时 1:15插件接管')
    } finally {
      vi.useRealTimers()
    }
  })

  it('words the remembered failure for npm as a direct source switch, not a stopped official updater', async () => {
    const now = 1_800_000_000_000
    expect(recentFailureText(now - 3 * 86_400_000, now, true)).toBe('官方下载 3 天前在这台电脑上失败，7 天内直接由插件换源下载')
    expect(recentFailureText(now - 60_000, now, true)).toBe('官方下载今天在这台电脑上失败，7 天内直接由插件换源下载')
    expect(recentFailureText(undefined, now, true)).toBe('官方下载近期在这台电脑上失败，7 天内直接由插件换源下载')
    // Codex is npm-installed in the fixture snapshot; the Host sends the remembered reason with every takeover progress.
    const f = await setup(running({
      channel: 'takeover', reason: 'OFFICIAL_RECENT_FAILURE', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 10 * 1024 ** 2, totalBytes: 60 * 1024 ** 2, resumeCount: 0, sourceHost: 'registry.npmmirror.simulated.example',
    }))
    const row = f.rowOf('codex')
    expect(byClass(row, 'cwn-update-callout')).toHaveLength(0)
    expect(hints(row)).toEqual(['官方下载近期在这台电脑上失败，7 天内直接由插件换源下载'])
    setLanguagePreference('en')
    await f.update(running({
      channel: 'takeover', reason: 'OFFICIAL_RECENT_FAILURE', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 10 * 1024 ** 2, totalBytes: 60 * 1024 ** 2, resumeCount: 0, sourceHost: 'registry.npmmirror.simulated.example',
    }))
    expect(hints(f.rowOf('codex'))).toEqual(['The official download failed on this computer recently; for 7 days the plugin downloads directly from another source'])
  })

  it('tells official byte progress apart: no resume count and the 30-second switch rule', async () => {
    const f = await setup(running({
      channel: 'official', readable: true, byteProgress: true, byteProgressState: 'known-total',
      downloadedBytes: 156 * 1024 ** 2, totalBytes: 372 * 1024 ** 2, bytesPerSecond: 1.2 * 1024 ** 2, resumeCount: 0,
    }))
    const row = f.rowOf('codex')
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['已下载 156 MB / 372 MB · 1.2 MB/s'])
    expect(byClass(row, 'cwn-update-meta-side')).toHaveLength(0)
    expect(hints(row)).toEqual(['官方更新不续传；30 秒没有新数据会停止官方更新，改由插件下载'])
  })

  it('plugin-owned official downloads say they resume and show the resume count', async () => {
    const f = await setup(running({
      channel: 'official', readable: true, byteProgress: true, byteProgressState: 'known-total', fileCount: 2,
      downloadedBytes: 160 * 1024 ** 2, totalBytes: 178 * 1024 ** 2, resumeCount: 2, sourceHost: 'registry.npmjs.org',
    }))
    const row = f.rowOf('codex')
    expect(byClass(row, 'cwn-update-meta-side').map(textOf)).toEqual(['已自动续传 2 次'])
    expect(hints(row)).toEqual(['下载停滞会从断点续传；30 秒没有新数据或持续过慢会改由插件换源下载，已下载的部分保留'])
  })

  it('draws no bar when the total size is unknown', async () => {
    const f = await setup(running({
      channel: 'takeover', readable: true, byteProgress: true, byteProgressState: 'unknown-total',
      downloadedBytes: 12.4 * 1024 ** 2, resumeCount: 1,
    }))
    const row = f.rowOf('codex')
    expect(bars(row)).toHaveLength(0)
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['已接收 12.4 MB，总大小未知'])
    expect(textOf(row)).not.toContain('%')
  })

  it('draws one segment per step up to 12 steps with done, current and pending states', async () => {
    const f = await setup(running({
      channel: 'official', readable: true, byteProgress: true, byteProgressState: 'unknown-total',
      currentStep: 3, totalSteps: 6, stepName: '拉取代码', downloadedBytes: 12.4 * 1024 ** 2, resumeCount: 0,
      stage: '→ Pulling updates...',
    }))
    const row = f.rowOf('codex')
    const [seg, ...others] = bars(row)
    expect(others).toHaveLength(0)
    expect(seg!.props.className).toBe('cwn-update-seg')
    expect(seg!.props).toMatchObject({
      'aria-valuemin': 0, 'aria-valuemax': 6, 'aria-valuenow': 3, 'aria-valuetext': '第 3 步，共 6 步', 'aria-label': 'Codex 更新进度',
    })
    expect(seg!.props.style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))')
    expect(seg!.findAllByType('span').map((span) => span.props['data-step'] ?? 'pending')).toEqual(['done', 'done', 'now', 'pending', 'pending', 'pending'])
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['第 3/6 步：拉取代码 · 已接收 12.4 MB，总大小未知'])
    // The official CLI's own line stays one line, with the full text on hover.
    const stage = byClass(row, 'cwn-update-hint').find((node) => node.props['data-clip'])
    expect(stage && textOf(stage)).toBe('→ Pulling updates...')
    expect(stage!.props.title).toBe('→ Pulling updates...')
  })

  it('switches to a continuous bar above 12 steps without naming any CLI in the wording', async () => {
    const f = await setup(running(
      { channel: 'takeover', readable: false, byteProgress: false, byteProgressState: 'none', currentStep: 48, totalSteps: 122, stepName: '安装依赖包', resumeCount: 0 },
      { phase: 'installing', intent: 'install' },
    ))
    const row = f.rowOf('codex')
    expect(byClass(row, 'cwn-update-seg')).toHaveLength(0)
    const [bar] = bars(row)
    expect(bar!.props.className).toBe('cwn-update-bar')
    expect(bar!.props).toMatchObject({ 'aria-valuemin': 0, 'aria-valuemax': 122, 'aria-valuenow': 48, 'aria-valuetext': '第 48 步，共 122 步', 'aria-label': 'Codex 安装进度' })
    expect(parseFloat(bar!.findByType('span').props.style.width)).toBeCloseTo((48 / 122) * 100, 5)
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['第 48/122 步：安装依赖包'])
    expect(byClass(row, 'cwn-update-meta-side')).toHaveLength(0)
  })

  it('gives Hermes its own rule hint instead of the generic plugin-download hint', async () => {
    const hermes = (progress: CliDownloadProgress) => data({ snapshot: snapshot({
      entries: [entry('hermes', { group: 'updatable', source: 'self-update', currentVersion: '0.21.7', latestVersion: '0.23.1', planToken: 'SIMULATED-plan' })],
      operation: { id: 'SIMULATED-op', intent: 'update', cli: 'hermes', phase: 'installing', startedAt: 1, targetVersion: '0.23.1', outputTail: '', progress },
    }) })
    const rule = '拉取代码过慢会改由插件分段拉取；仅在确认工具下载停滞时停止后重跑，构建及更新收尾会继续等待'
    const f = await setup(hermes({ channel: 'official', readable: false, byteProgress: false, byteProgressState: 'none', stage: '执行 Hermes 官方更新', elapsedSeconds: 20, resumeCount: 0 }))
    expect(hints(f.rowOf('hermes'))).toEqual([rule])
    await f.update(hermes({ channel: 'official', readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: 2048, elapsedSeconds: 30, resumeCount: 0 }))
    expect(hints(f.rowOf('hermes'))).toEqual([rule])
    expect(textOf(f.rowOf('hermes'))).not.toContain('改由插件下载')
    // Normal receipts give six steps: the rule hint stays.
    await f.update(hermes({ channel: 'official', readable: false, byteProgress: false, byteProgressState: 'none', currentStep: 3, totalSteps: 6, stepName: 'apply', elapsedSeconds: 40, resumeCount: 0 }))
    expect(hints(f.rowOf('hermes'))).toContain(rule)
    // Takeover: Hermes-specific callout, no cleanup or 7-day claim, no byte-resume count.
    await f.update(hermes({ channel: 'takeover', reason: 'OFFICIAL_SLOW', readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: 4096, currentStep: 2, totalSteps: 10, stepName: '第 2/10 段（v0.22.1）', elapsedSeconds: 50, resumeCount: 0, retryCount: 1 }))
    const row = f.rowOf('hermes')
    const callout = byClass(row, 'cwn-update-callout').map(textOf).join('')
    expect(callout).toContain('改由插件按版本分段拉取代码')
    expect(callout).not.toContain('7 天')
    expect(callout).not.toContain('删除')
    expect(textOf(row)).not.toContain('已自动续传')
    expect(textOf(row)).toContain('已自动重试 1 次')
  })

  it('shows only the stage line for phase-only official progress, as plain text', async () => {
    const hostile = '<b>Downloading update...</b>'
    const f = await setup(running({ channel: 'official', readable: false, byteProgress: false, byteProgressState: 'none', stage: hostile, elapsedSeconds: 35, resumeCount: 0 }))
    const row = f.rowOf('codex')
    expect(bars(row)).toHaveLength(0)
    const main = byClass(row, 'cwn-update-meta-main')
    expect(main.map(textOf)).toEqual([hostile])
    expect(main[0]!.props.title).toBe(hostile)
    expect(row.findAll((node) => node.type === 'b')).toHaveLength(0)
    expect(hints(row)).toEqual(['官方更新不显示下载字节；超时未完成会停止官方更新，改由插件下载'])
    expect(textOf(row)).not.toContain('已自动续传')
    expect(textOf(row)).not.toContain('下载进度无法读取')
  })

  it('reports an official "already latest" result without claiming an update', async () => {
    const result: CliUpdateOperation = {
      id: 'SIMULATED-latest', intent: 'update', cli: 'kimi', phase: 'succeeded', startedAt: 1, finishedAt: 2,
      beforeVersion: '1.6.0', targetVersion: '1.7.0', afterVersion: '1.6.0', outputTail: '官方命令报告已是最新，未切换接管。',
      progress: { channel: 'official', readable: false, byteProgress: false, resumeCount: 0, stage: '已是最新', reason: 'ALREADY_LATEST' },
    }
    const f = await setup(data({ snapshot: snapshot({ results: [result] }) }))
    const row = f.rowOf('kimi')
    expect(textOf(byClass(row, 'cwn-update-desc')[0]!)).toBe('已是最新 1.6.0')
    expect(textOf(row)).not.toContain('已更新到')
    expect(hints(row)).toEqual(['官方报告已是最新，未改由插件下载，也不降级'])
    // Opening the output keeps the note once, inside the same block.
    await act(async () => f.button('查看输出', row)!.props.onClick())
    expect(hints(f.rowOf('kimi'))).toEqual(['官方报告已是最新，未改由插件下载，也不降级'])
    expect(textOf(f.rowOf('kimi'))).toContain('官方命令报告已是最新')
  })

  it('renders the new progress wording in English', async () => {
    const f = await setup(running({ channel: 'takeover', reason: 'OFFICIAL_SLOW', readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: 2048, resumeCount: 0 }))
    setLanguagePreference('en')
    await f.update(running({ channel: 'takeover', reason: 'OFFICIAL_SLOW', readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: 2048, resumeCount: 0 }))
    const row = f.rowOf('codex')
    expect(byClass(row, 'cwn-update-chan').map(textOf)).toEqual(['Plugin takeover'])
    expect(textOf(byClass(row, 'cwn-update-callout')[0]!)).toMatch(/^The official download was too slow\. .* Codex updates on this computer/)
    expect(byClass(row, 'cwn-update-meta-main').map(textOf)).toEqual(['Received 2.0 KB, total size unknown'])
  })
})
