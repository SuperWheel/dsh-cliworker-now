import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliUpdatePane } from '../src/client/cli-update-page.tsx'
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
    expect(textOf(row)).toContain('可用 90.0 GB，安装需要约 480 MB')
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

  it('greys out write buttons on a Host without the write methods', async () => {
    const f = await setup(data(), { startCliOperation: undefined, updateAllClis: undefined })
    expect(f.button('更新', f.rowOf('codex'))!.props.disabled).toBe(true)
    expect(f.button('全部更新')!.props.disabled).toBe(true)
    expect(
      f.rowOf('codex').findAll((node) => node.props['data-tip'] === '当前 Host 版本不支持此操作，请更新 CLI Worker 插件'),
    ).toHaveLength(1)
  })
})
