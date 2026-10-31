import { createElement, forwardRef, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { setLanguagePreference } from '../src/client/i18n.ts'
import { SettingsDialog } from '../src/client/settings-dialog.tsx'
import type { API } from '../src/client/workers.ts'
import type { AccountStatus } from '../src/shared/accounts.ts'
import { CLI_IDS, CLI_LABELS, type CliId } from '../src/shared/types.ts'
import { MULTI_ACCOUNT_CLIS } from '../src/shared/account-links.ts'

// Explicit simulation: no CLI, login flow or native portal is started in these tests.
const terminal = vi.hoisted(() => ({ started: vi.fn(), stopped: vi.fn(), close: vi.fn(async () => true) }))
vi.mock('../src/client/account-terminal.tsx', () => ({
  AccountTerminal: ({ cli, action, source, provider, login, replaces, onClose, onFinished, closeControl }: any) => {
    const target =
      provider || login
        ? { ...(provider ? { provider } : {}), ...(login ? { login } : {}), ...(replaces ? { replaces } : {}) }
        : undefined
    useEffect(() => {
      closeControl.current = async () => {
        if (!(await terminal.close())) return false
        onClose()
        return true
      }
      return () => {
        closeControl.current = undefined
      }
    })
    useEffect(() => {
      if (target) terminal.started(cli, action, target)
      else if (source) terminal.started(cli, action, source)
      else terminal.started(cli, action)
      return () => {
        if (target) terminal.stopped(cli, action, target)
        else if (source) terminal.stopped(cli, action, source)
        else terminal.stopped(cli, action)
      }
    }, [cli, action, source, provider, login, replaces])
    return createElement(
      'div',
      { 'data-terminal': cli },
      createElement('button', { onClick: onClose }, '关闭模拟账号操作'),
      createElement('button', { onClick: onFinished }, '完成模拟账号操作'),
    )
  },
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ open, title, children, onClose, closeLabel }: any) =>
    open
      ? createElement(
          'section',
          { role: 'dialog', 'aria-label': title },
          createElement('button', { 'aria-label': closeLabel, onClick: onClose }, closeLabel),
          children,
        )
      : null,
  StateDot: () => createElement('svg', { 'data-loading': true }),
  Switch: ({ checked, onChange, label, disabled }: any) =>
    createElement('button', {
      role: 'switch',
      'aria-label': label,
      'aria-checked': checked,
      disabled,
      onClick: () => onChange(!checked),
    }),
  Tooltip: ({ children }: any) => children,
  IconSettingsOutlineRegular: () => createElement('svg'),
  IconCopyOutlineRegular: () => createElement('svg'),
  IconChevronDownOutlineRegular: () => createElement('svg'),
  IconLinkOutlineRegular: () => createElement('svg'),
  IconRefreshOutlineRegular: () => createElement('svg'),
  IconPlusOutlineRegular: () => createElement('svg'),
  IconUserOutlineRegular: () => createElement('svg'),
  Menu: ({ anchor, open, items = [], onSelect }: any) =>
    createElement(
      'div',
      {},
      anchor,
      open &&
        createElement(
          'div',
          { role: 'menu' },
          items.map((item: any) =>
            createElement(
              'button',
              { key: item.id, disabled: item.disabled, onClick: () => onSelect(item.id) },
              item.label,
            ),
          ),
        ),
    ),
  Button: forwardRef(({ children, variant: _variant, size: _size, ...props }: any, ref) =>
    createElement('button', { type: 'button', ...props, ref }, children),
  ),
  Input: forwardRef(({ icon, ...props }: any, ref) =>
    createElement('span', {}, icon, createElement('input', { ...props, ref })),
  ),
}))
const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  terminal.close.mockReset().mockResolvedValue(true)
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount()
  })
  setLanguagePreference('follow')
  vi.clearAllMocks()
})
function deferred() {
  let resolve!: (value: any) => void, reject!: (reason: unknown) => void
  const promise = new Promise<any>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const remote = (data: unknown) => ({ ok: true, value: JSON.stringify(data) })
const catalog = (cli: CliId, model = `${cli}-fixture`) =>
  remote({ cli, models: [{ id: model, efforts: ['low', 'high'] }] })
const status = (cli: CliId, changes: Partial<AccountStatus> = {}) =>
  remote({
    cli,
    installed: true,
    state: 'unknown',
    summary: `${cli} 模拟状态待确认`,
    actions: [],
    ...changes,
  })
const accountActions: AccountStatus['actions'] = [
  { id: 'login', label: '登录 / 切换账号', description: '模拟登录能力说明' },
  { id: 'logout', label: '退出登录', description: '模拟退出能力说明' },
  { id: 'manage', label: '账号终端', description: '模拟管理能力说明' },
]
async function setup(
  overrides: Record<string, any> = {},
  openNativeSettings?: () => void,
  initialCli: CliId = 'antigravity',
) {
  const catalogForCli = vi.fn(async (_session, cli: CliId) => catalog(cli))
  const refreshCatalogForCli = vi.fn(async (_session, cli: CliId) => catalog(cli))
  const accountStatus = vi.fn(async (_session, cli: CliId) => status(cli))
  const configure = vi.fn().mockResolvedValue(remote({}))
  const paths = new Map<CliId, { cli: CliId; path: string; source: string; available: boolean }>()
  const defaultPath = (cli: CliId) => ({
    cli,
    path: `E:\\模拟 CLI\\${cli}.exe`,
    source: 'auto',
    available: true,
  })
  const cliExecutablePath = vi.fn(async (_session, cli: CliId) => remote(paths.get(cli) ?? defaultPath(cli)))
  const runningMessageSettings = vi.fn(async (_session, cli: CliId) =>
    remote({
      cli,
      mode: cli === 'pi' || cli === 'omp' ? 'steer' : 'queue',
      canSteer: cli === 'pi' || cli === 'omp',
    }),
  )
  const saveRunningMessageMode = vi.fn(async (_session, cli: CliId, mode: string) =>
    remote({
      cli,
      mode,
      canSteer: cli === 'pi' || cli === 'omp',
    }),
  )
  const refreshCliExecutablePath = vi.fn(async (_session, cli: CliId, path: string, action: string) => {
    const next =
      action === 'auto'
        ? defaultPath(cli)
        : action === 'manual'
          ? { cli, path, source: 'manual', available: true }
          : (paths.get(cli) ?? defaultPath(cli))
    paths.set(cli, next)
    return remote(next)
  })
  let enabled = Object.fromEntries(CLI_IDS.map((cli) => [cli, true]))
  const cliSettings = vi.fn(async () => remote({ enabled }))
  const setCliEnabled = vi.fn(async (_session, cli: CliId, next: boolean) => {
    enabled = { ...enabled, [cli]: next }
    return remote({ enabled })
  })
  const api = {
    cliworker: {
      catalogForCli,
      refreshCatalogForCli,
      accountStatus,
      configure,
      cliSettings,
      setCliEnabled,
      cliExecutablePath,
      refreshCliExecutablePath,
      runningMessageSettings,
      saveRunningMessageMode,
      ...overrides,
    },
  } as unknown as API
  let r!: ReactTestRenderer
  const render = (open: boolean) => (
    <SettingsDialog
      open={open}
      onClose={() => r.update(render(false))}
      api={api}
      sessionId="simulation-parent"
      initialCli={initialCli}
      openNativeSettings={openNativeSettings}
    />
  )
  await act(async () => {
    r = create(render(true))
    mounted.push(r)
  })
  const text = () => JSON.stringify(r.toJSON())
  const button = (label: string) =>
    r.root.findAllByType('button').find((b) => b.props['aria-label'] === label || b.children.includes(label))!
  const click = async (label: string) => {
    await act(async () => button(label).props.onClick())
  }
  const open = async () => {
    await act(async () => r.update(render(true)))
  }
  const chooseModel = async (label: string) => {
    await click('默认模型')
    await click(label)
  }
  const chooseEffort = async (label: string) => {
    await click('默认思考强度')
    await click(label)
  }
  return {
    r,
    text,
    button,
    click,
    open,
    chooseModel,
    chooseEffort,
    api,
    configure,
    accountStatus,
    catalogForCli,
    refreshCatalogForCli,
    cliSettings,
    setCliEnabled,
    cliExecutablePath,
    refreshCliExecutablePath,
    runningMessageSettings,
    saveRunningMessageMode,
  }
}
function warmMetadata() {
  return { policy: 1, host: 'SIMULATED-host', project: 'SIMULATED-project',
    revisions: Object.fromEntries(CLI_IDS.map(id => [id, '0:0'])),
    catalogReady: Object.fromEntries(CLI_IDS.map(id => [id, true])), preferences: {} as Record<string, any> }
}
async function setupWarm(overrides: Record<string, any> = {}, ids: readonly CliId[] = CLI_IDS, initial: CliId = 'codex') {
  const metadata = warmMetadata(), enabled = Object.fromEntries(CLI_IDS.map(id => [id, ids.includes(id)]))
  const cliSettings = vi.fn(async () => remote({ enabled, settingsCache: metadata }))
  const setCliEnabled = vi.fn(async (_session, cli: CliId, next: boolean) => {
    enabled[cli] = next; metadata.revisions[cli] += ':changed'; return remote({ enabled })
  })
  const configure = vi.fn(async (_session, raw: string) => {
    const pref = JSON.parse(raw); metadata.preferences[pref.cli] = pref; return remote(pref)
  })
  const t = await setup({ cliSettings, setCliEnabled, configure, ...overrides }, undefined, initial)
  return { ...t, metadata, enabled, settingsRead: cliSettings, savedPreference: configure }
}

it('warms every enabled CLI model and effort list once and reuses the receipts on close/reopen and navigation', async () => {
  const t = await setupWarm()
  expect(t.accountStatus).toHaveBeenCalledTimes(CLI_IDS.length)
  expect(t.catalogForCli).toHaveBeenCalledTimes(CLI_IDS.length)
  expect(new Set(t.catalogForCli.mock.calls.map(call => call[1])).size).toBe(CLI_IDS.length)
  expect(t.savedPreference).not.toHaveBeenCalled()
  await t.click('关闭设置'); await t.open(); await t.click(`${CLI_LABELS.qoder} 设置`); await t.click('默认思考强度')
  expect(t.button('High')).toBeDefined()
  expect(t.accountStatus).toHaveBeenCalledTimes(CLI_IDS.length)
  expect(t.catalogForCli).toHaveBeenCalledTimes(CLI_IDS.length)
  expect(t.settingsRead).toHaveBeenCalledTimes(2)
})

it('bounds combined account/model warmup to two jobs and promotes a newly selected queued CLI', async () => {
  const reads = new Map<CliId, ReturnType<typeof deferred>>(), models = new Map<CliId, ReturnType<typeof deferred>>()
  const accountStatus = vi.fn((_parent, cli: CliId) => { const d = deferred(); reads.set(cli, d); return d.promise })
  const catalogForCli = vi.fn((_parent, cli: CliId) => { const d = deferred(); models.set(cli, d); return d.promise })
  const t = await setupWarm({ accountStatus, catalogForCli })
  expect(accountStatus.mock.calls.map(call => call[1])).toEqual(['codex', 'antigravity'])
  await act(async () => reads.get('codex')!.resolve(status('codex')))
  expect(catalogForCli.mock.calls.map(call => call[1])).toEqual(['codex'])
  expect(accountStatus).toHaveBeenCalledTimes(2)
  await t.click(`${CLI_LABELS.qoder} 设置`)
  await act(async () => models.get('codex')!.resolve(catalog('codex')))
  expect(accountStatus.mock.calls.map(call => call[1])).toEqual(['codex', 'antigravity', 'qoder'])
  await t.click('关闭设置')
  expect(accountStatus.mock.calls[1]![2].aborted).toBe(true)
  expect(accountStatus.mock.calls[2]![2].aborted).toBe(true)
  await act(async () => { for (const [id, d] of reads) d.resolve(status(id)) })
  expect(catalogForCli).toHaveBeenCalledTimes(1)
})

it('keeps a completed account when closing during model discovery and fills only the cancelled model on reopen', async () => {
  const first = deferred(), catalogForCli = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(catalog('codex', 'fresh-model'))
  const t = await setupWarm({ catalogForCli }, ['codex'])
  expect(t.accountStatus).toHaveBeenCalledTimes(1)
  await t.click('关闭设置')
  expect(catalogForCli.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => first.resolve(catalog('codex', 'STALE-model')))
  await t.open()
  expect(t.accountStatus).toHaveBeenCalledTimes(1)
  expect(catalogForCli).toHaveBeenCalledTimes(2)
  expect(t.text()).toContain('fresh-model'); expect(t.text()).not.toContain('STALE-model')
})

it('uses a fresh model query for explicit refresh while retaining account evidence and the refreshed display cache', async () => {
  const t = await setupWarm({}, ['codex'])
  await t.click('刷新模型')
  expect(t.refreshCatalogForCli).toHaveBeenCalledExactlyOnceWith('simulation-parent', 'codex', expect.any(AbortSignal))
  expect(t.accountStatus).toHaveBeenCalledTimes(1)
  await t.click('关闭设置'); await t.open()
  expect(t.catalogForCli).toHaveBeenCalledTimes(1)
  expect(t.refreshCatalogForCli).toHaveBeenCalledTimes(1)
})

it('waits for a fresh account before forcing its model directory and never reloads other CLIs', async () => {
  const pending = deferred(), accountStatus = vi.fn(async (_parent, cli: CliId) => status(cli))
  const t = await setupWarm({ accountStatus }, ['codex', 'qoder'])
  accountStatus.mockReturnValueOnce(pending.promise)
  await t.click('刷新状态')
  expect(t.refreshCatalogForCli).not.toHaveBeenCalled()
  expect(t.button('默认模型').props.disabled).toBe(true)
  await act(async () => pending.resolve(status('codex', { state: 'authenticated' })))
  expect(t.refreshCatalogForCli).toHaveBeenCalledExactlyOnceWith('simulation-parent', 'codex', expect.any(AbortSignal))
  expect(accountStatus.mock.calls.filter(call => call[1] === 'qoder')).toHaveLength(1)
})

it('keeps a failed refreshed directory unknown across reopen instead of reviving the old cached model', async () => {
  const refreshCatalogForCli = vi.fn().mockRejectedValue(new Error('SIMULATED fresh source failure'))
  const t = await setupWarm({ refreshCatalogForCli }, ['codex'])
  await t.click('刷新模型')
  expect(t.text()).toContain('SIMULATED fresh source failure')
  expect(t.button('默认模型').props.disabled).toBe(true)
  await t.click('关闭设置'); await t.open()
  expect(t.text()).toContain('SIMULATED fresh source failure')
  expect(t.catalogForCli).toHaveBeenCalledTimes(1)
  expect(t.accountStatus).toHaveBeenCalledTimes(1)
})

it('invalidates only the CLI whose Host source changed and resets all receipts after a Host restart', async () => {
  const t = await setupWarm({}, ['codex', 'qoder'])
  await t.click('关闭设置'); t.metadata.revisions.qoder = '1:0'; await t.open()
  expect(t.accountStatus.mock.calls.filter(call => call[1] === 'codex')).toHaveLength(1)
  expect(t.accountStatus.mock.calls.filter(call => call[1] === 'qoder')).toHaveLength(2)
  await t.click('关闭设置'); t.metadata.host = 'SIMULATED-new-host'; await t.open()
  expect(t.accountStatus.mock.calls.filter(call => call[1] === 'codex')).toHaveLength(2)
  expect(t.accountStatus.mock.calls.filter(call => call[1] === 'qoder')).toHaveLength(3)
})

it('applies current saved defaults on reopen without querying models or writing a replacement preference', async () => {
  const t = await setupWarm({}, ['codex'])
  await t.click('关闭设置')
  t.metadata.preferences.codex = { cli: 'codex', model: 'codex-fixture', effort: 'high' }
  await t.open()
  expect(visibleText(t.button('默认思考强度'))).toContain('High')
  expect(t.catalogForCli).toHaveBeenCalledTimes(1)
  expect(t.savedPreference).not.toHaveBeenCalled()
})

it('preserves a human-saved model-effort pair across navigation and reopen without a second save', async () => {
  const t = await setupWarm({}, ['codex'])
  await t.chooseEffort('High')
  expect(t.savedPreference).not.toHaveBeenCalled()
  await t.click(`${CLI_LABELS.qoder} 设置`)
  expect(t.savedPreference).toHaveBeenCalledTimes(1)
  await t.click('Codex 设置')
  expect(visibleText(t.button('默认思考强度'))).toContain('High')
  await t.click('关闭设置'); await t.open()
  expect(visibleText(t.button('默认思考强度'))).toContain('High')
  expect(t.savedPreference).toHaveBeenCalledTimes(1)
  expect(t.catalogForCli).toHaveBeenCalledTimes(1)
})

it('does not warm disabled CLIs and clears the selected cache when a CLI is disabled', async () => {
  const t = await setupWarm({}, ['codex'])
  expect(t.accountStatus.mock.calls.map(call => call[1])).toEqual(['codex'])
  const toggle = t.r.root.findAllByType('button').find(button => button.props.role === 'switch')!
  await act(async () => toggle.props.onClick())
  await t.click('关闭设置'); await t.open()
  expect(t.accountStatus).toHaveBeenCalledTimes(1)
  expect(t.button('默认模型').props.disabled).toBe(true)
})

it('starts the selected CLI first and bounds background account discovery', async () => {
  const reads = new Map<CliId, ReturnType<typeof deferred>>()
  const accountStatus = vi.fn((_parent, cli: CliId) => {
    const read = deferred()
    reads.set(cli, read)
    return read.promise
  })
  const t = await setup({ accountStatus }, undefined, 'mimo')
  expect(accountStatus.mock.calls.map((call) => call[1])).toEqual(['mimo', 'antigravity'])
  expect(t.catalogForCli).not.toHaveBeenCalled()
  expect(t.button('MiMo 设置').findByProps({ role: 'img', 'aria-label': '正在检查连接' })).toBeDefined()
  await t.click('关闭设置')
  for (const call of accountStatus.mock.calls) expect(call[2].aborted).toBe(true)
  await act(async () => {
    for (const [id, read] of reads) read.resolve(status(id))
  })
  expect(accountStatus).toHaveBeenCalledTimes(2)
})

it('promotes a newly selected pending CLI after an in-flight read settles without cancelling it', async () => {
  const reads = new Map<CliId, ReturnType<typeof deferred>>()
  const accountStatus = vi.fn((_parent, cli: CliId) => {
    const read = deferred()
    reads.set(cli, read)
    return read.promise
  })
  const t = await setup({ accountStatus })
  expect(accountStatus.mock.calls.map((call) => call[1])).toEqual(['antigravity', 'codex'])
  await t.click('MiMo 设置')
  expect(accountStatus.mock.calls[0]![2].aborted).toBe(false)
  expect(accountStatus.mock.calls[1]![2].aborted).toBe(false)
  expect(accountStatus).toHaveBeenCalledTimes(2)
  await act(async () => reads.get('antigravity')!.resolve(status('antigravity')))
  expect(accountStatus.mock.calls.map((call) => call[1])).toEqual(['antigravity', 'codex', 'mimo'])
  await t.click('启用 MiMo')
  expect(accountStatus.mock.calls[2]![2].aborted).toBe(true)
  await act(async () => reads.get('mimo')!.resolve(status('mimo', { state: 'authenticated' })))
  expect(t.catalogForCli).not.toHaveBeenCalled()
  expect(t.button('MiMo 设置').props['data-enabled']).toBe(false)
  await t.click('关闭设置')
})

it('rechecks a CLI re-enabled before its cancelled request settles and ignores the old result', async () => {
  const old = deferred(),
    fresh = deferred()
  let mimoReads = 0
  const accountStatus = vi.fn((_parent, cli: CliId) => {
    if (cli !== 'mimo') return Promise.resolve(status(cli))
    return ++mimoReads === 1 ? old.promise : fresh.promise
  })
  const t = await setup({ accountStatus }, undefined, 'mimo')
  await t.click('启用 MiMo')
  expect(accountStatus.mock.calls.find((call) => call[1] === 'mimo')![2].aborted).toBe(true)
  await t.click('启用 MiMo')
  expect(t.button('MiMo 设置').props['data-enabled']).toBe(true)
  expect(mimoReads).toBe(1)
  expect(t.button('MiMo 设置').findByProps({ role: 'img', 'aria-label': '正在检查连接' })).toBeDefined()
  await act(async () =>
    old.resolve(
      status('mimo', {
        state: 'authenticated',
        accountLabel: 'old-mimo-fixture@example.invalid',
        actions: accountActions,
      }),
    ),
  )
  expect(mimoReads).toBe(2)
  expect(t.text()).not.toContain('old-mimo-fixture@example.invalid')
  expect(t.button('MiMo 设置').findByProps({ role: 'img', 'aria-label': '正在检查连接' })).toBeDefined()
  await act(async () =>
    fresh.resolve(
      status('mimo', {
        state: 'authenticated',
        accountLabel: 'fresh-mimo-fixture@example.invalid',
        actions: accountActions,
      }),
    ),
  )
  expect(t.text()).toContain('fresh-mimo-fixture@example.invalid')
  expect(t.button('MiMo 设置').findAllByProps({ role: 'img', 'aria-label': '正在检查连接' })).toHaveLength(0)
  expect(mimoReads).toBe(2)
})
it('keeps CLI navigation and dismissal available while account and model discovery are delayed', async () => {
  const models = deferred(),
    account = deferred()
  const t = await setup({
    catalogForCli: vi.fn((_session, cli) =>
      cli === 'antigravity' ? models.promise : Promise.resolve(catalog(cli)),
    ),
    accountStatus: vi.fn((_session, cli) =>
      cli === 'antigravity' ? account.promise : Promise.resolve(status(cli)),
    ),
  })
  expect(t.text()).toContain('正在读取 Antigravity 模型')
  expect(t.text()).toContain('正在读取 Antigravity 账号')
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(t.button('Codex 设置').props.disabled).not.toBe(true)
  expect(t.button('关闭设置').props.disabled).not.toBe(true)
  await t.click('Codex 设置')
  expect(t.text()).toContain('codex-fixture')
  await act(async () => {
    models.resolve(catalog('antigravity', 'stale-model'))
    account.resolve(status('antigravity', { summary: 'stale-account' }))
  })
  expect(t.text()).not.toContain('stale-model')
  expect(visibleText(accountSummary(t.r))).not.toContain('stale-account')
  await t.click('关闭设置')
  expect(t.r.toJSON()).toBe(null)
})
it('ignores a request from a previous dialog instance after closing and reopening', async () => {
  const old = deferred()
  const t = await setup({
    catalogForCli: vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(catalog('antigravity', 'fresh-model')),
  })
  await t.click('关闭设置')
  await t.open()
  expect(t.text()).toContain('fresh-model')
  await act(async () => old.resolve(catalog('antigravity', 'old-model')))
  expect(t.text()).not.toContain('old-model')
  expect(t.text()).toContain('fresh-model')
})
it('lets model defaults work independently when account discovery fails', async () => {
  const t = await setup({ accountStatus: vi.fn().mockRejectedValue(new Error('模拟账号查询失败')) })
  expect(t.text()).toContain('模拟账号查询失败')
  expect(t.button('默认模型').props.disabled).toBe(false)
  expect(t.configure).not.toHaveBeenCalled()
  await t.chooseModel('antigravity-fixture')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({
    cli: 'antigravity',
    model: 'antigravity-fixture',
    effort: 'low',
  })
  expect(t.configure).toHaveBeenCalledOnce()
})
it('never treats unknown account status as logged out or mounts a terminal without an explicit action', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) =>
      status(cli, {
        summary: '模拟状态无法确认',
        actions: [{ id: 'manage', label: '账号终端', description: '由模拟 Host 提供' }],
      }),
    ),
  })
  expect(visibleText(accountSummary(t.r))).toContain('模拟状态无法确认')
  expect(t.text()).not.toContain('未登录')
  expect(t.button('登录')).toBeUndefined()
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('账号终端')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('antigravity', 'manage')
  const dialog = t.r.root.findByProps({ role: 'dialog', 'aria-label': 'Antigravity · 账号终端' })
  expect(dialog.findByProps({ 'data-terminal': 'antigravity' })).toBeDefined()
  await t.click('Codex 设置')
  expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'manage')
  expect(terminal.started).toHaveBeenCalledTimes(1)
})
it('keeps a delayed save scoped to its original CLI and leaves navigation usable', async () => {
  const saved = deferred()
  const configure = vi.fn().mockReturnValue(saved.promise)
  const t = await setup({ configure })
  await t.chooseEffort('High')
  expect(configure).not.toHaveBeenCalled()
  expect(t.button('Kimi 设置').props.disabled).not.toBe(true)
  await t.click('Kimi 设置')
  expect(configure).toHaveBeenCalledOnce()
  expect(configure.mock.calls[0]![2].aborted).toBe(false)
  await act(async () => saved.reject(new Error('stale save failure')))
  expect(t.text()).not.toContain('stale save failure')
  expect(t.text()).not.toContain('默认设置已保存')
  expect(t.text()).toContain('kimi-fixture')
})
it('refreshes real capability data after a user-operated account flow finishes', async () => {
  const accountStatus = vi.fn(async (_parent, cli: CliId) =>
    status(cli, { actions: [{ id: 'login', label: '登录 / 切换账号', description: '模拟' }] }),
  )
  const t = await setup({ accountStatus })
  await t.click('登录 / 切换账号')
  await t.click('完成模拟账号操作')
  expect(accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(2)
  expect(t.catalogForCli).toHaveBeenCalledTimes(2)
  await t.click('关闭设置')
  expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'login')
})

it('replaces a pending account check after an account action finishes and rechecks on outer dismissal', async () => {
  const stale = deferred()
  const accountStatus = accountFixture({
    state: 'authenticated',
    verification: 'cli',
    actions: accountActions,
  })
  const t = await setup({ accountStatus })
  await t.click('登录 / 切换账号')
  accountStatus.mockReturnValueOnce(stale.promise)
  await t.click('刷新状态')
  const pendingSignal = accountStatus.mock.calls.at(-1)![2]
  await t.click('完成模拟账号操作')
  expect(pendingSignal.aborted).toBe(true)
  // Replacing a read waits for its cancelled Host process range to settle.
  expect(accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(2)
  await act(async () =>
    stale.resolve(status('antigravity', { state: 'unauthenticated', summary: 'stale-before-login' })),
  )
  expect(accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(3)
  expect(t.text()).not.toContain('stale-before-login')
  const modelsBeforeClose = t.catalogForCli.mock.calls.length
  await t.click('关闭账号操作')
  expect(accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(4)
  expect(t.catalogForCli.mock.calls.length).toBe(modelsBeforeClose + 1)
  expect(t.configure).not.toHaveBeenCalled()
})

it('opens an account action in its own dialog only after a click and dismisses it without closing settings', async () => {
  const t = await setup({ accountStatus: accountFixture({ actions: accountActions }) })
  expect(t.r.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('刷新状态')
  await t.click('刷新模型')
  expect(terminal.started).not.toHaveBeenCalled()

  await t.click('登录 / 切换账号')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('antigravity', 'login')
  expect(t.r.root.findAllByProps({ role: 'dialog' })).toHaveLength(2)
  const dialog = t.r.root.findByProps({ role: 'dialog', 'aria-label': 'Antigravity · 登录 / 切换账号' })
  expect(dialog.findByProps({ 'data-terminal': 'antigravity' })).toBeDefined()
  expect(t.button('登录 / 切换账号').props.disabled).toBe(true)
  expect(t.button('账号终端').props.disabled).toBe(true)

  await t.click('关闭账号操作')
  expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'login')
  expect(t.r.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
  expect(t.r.root.findByProps({ role: 'dialog', 'aria-label': 'CLI Worker 设置' })).toBeDefined()
  expect(t.button('登录 / 切换账号').props.disabled).toBe(false)
  expect(terminal.started).toHaveBeenCalledTimes(1)
})

it.each(['关闭账号操作', 'Codex 设置'])(
  'cleans up the account action via %s even when its completion status refresh fails',
  async (dismiss) => {
    const accountStatus = accountFixture({ actions: accountActions })
    const t = await setup({ accountStatus })
    await t.click('登录 / 切换账号')
    accountStatus.mockImplementation(async (_parent, cli: CliId) => {
      if (cli === 'antigravity') throw new Error('模拟：操作后状态查询失败')
      return status(cli)
    })
    await t.click('完成模拟账号操作')
    expect(visibleText(accountSummary(t.r))).toContain('模拟：操作后状态查询失败')
    expect(
      t.r.root.findByProps({ role: 'dialog', 'aria-label': 'Antigravity · 登录 / 切换账号' }),
    ).toBeDefined()
    expect(t.button('关闭账号操作').props.disabled).not.toBe(true)
    await t.click(dismiss)
    expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'login')
    expect(t.r.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(t.r.root.findAllByProps({ 'data-terminal': 'antigravity' })).toHaveLength(0)
    await t.click('Antigravity 设置')
    expect(terminal.started).toHaveBeenCalledTimes(1)
    expect(t.button('登录 / 切换账号').props.disabled).toBe(true)
  },
)

it.each(['关闭账号操作', '关闭设置', 'Codex 设置', '智能体设置'])(
  'waits for terminal cleanup and retains the current terminal for retry via %s',
  async (dismiss) => {
    const t = await setup({ accountStatus: accountFixture({ actions: accountActions }) })
    await t.click('登录 / 切换账号')
    const cleanup = deferred()
    terminal.close.mockReturnValueOnce(cleanup.promise)
    await t.click(dismiss)
    expect(t.r.root.findAllByProps({ 'data-terminal': 'antigravity' })).toHaveLength(1)
    expect(terminal.stopped).not.toHaveBeenCalled()
    await act(async () => cleanup.resolve(false))
    expect(t.r.root.findAllByProps({ 'data-terminal': 'antigravity' })).toHaveLength(1)
    await t.click(dismiss)
    expect(terminal.started).toHaveBeenCalledOnce()
    expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'login')
    if (dismiss === '关闭设置') expect(t.r.toJSON()).toBe(null)
    else expect(t.r.root.findAllByProps({ 'data-terminal': 'antigravity' })).toHaveLength(0)
  },
)

it.each<AccountStatus['state']>(['unknown', 'configured', 'unconfigured', 'unauthenticated', 'unavailable'])(
  'does not offer logout for %s status even if the CLI declares that capability',
  async (state) => {
    const t = await setup({ accountStatus: accountFixture({ state, actions: accountActions }) })
    expect(t.button('退出登录')).toBeUndefined()
    expect(terminal.started).not.toHaveBeenCalled()
  },
)

it('offers logout alongside an authenticated account and dispatches only logout after an explicit click', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'cli',
      accountLabel: 'fixture@example.invalid',
      actions: accountActions,
    }),
  })
  expect(
    accountSummary(t.r)
      .findAllByType('button')
      .some((button) => button.props['aria-label'] === '退出登录'),
  ).toBe(true)
  expect(t.button('退出登录').props.disabled).toBe(false)
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('刷新状态')
  await t.click('Codex 设置')
  expect(t.button('退出登录')).toBeUndefined()
  await t.click('Antigravity 设置')
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('退出登录')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('antigravity', 'logout')
  expect(t.r.root.findByProps({ role: 'dialog', 'aria-label': 'Antigravity · 退出登录' })).toBeDefined()
  await t.click('关闭账号操作')
  expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('antigravity', 'logout')
  expect(terminal.started).toHaveBeenCalledTimes(1)
})
const scopedLogoutActions: AccountStatus['actions'] = [
  {
    id: 'logout',
    label: '退出登录',
    description: '模拟：只退出所选原生来源',
    sources: [
      { id: 'native', label: '原生目录' },
      { id: 'plugin', label: '插件目录' },
    ],
  },
]
const zcodeActions: AccountStatus['actions'] = [
  {
    id: 'login',
    label: '登录 / 切换账号',
    description: '模拟登录能力说明',
    providers: [
      { id: 'bigmodel', label: '中国智谱 BigModel' },
      { id: 'zai', label: '海外 Z.AI' },
    ],
  },
  { id: 'logout', label: '退出登录', description: '模拟退出能力说明' },
  { id: 'manage', label: '账号终端', description: '模拟管理能力说明' },
]
it.each([
  ['bigmodel', '中国智谱 BigModel'],
  ['zai', '海外 Z.AI'],
] as const)(
  'starts ZCode login only after choosing %s in the account window and resets it on reopen',
  async (provider, label) => {
    const t = await setup(
      { accountStatus: accountFixture({ state: 'authenticated', actions: zcodeActions }, 'zcode') },
      undefined,
      'zcode',
    )
    expect(t.button('退出登录')).toBeUndefined()
    await t.click('账号')
    expect(t.r.root.findByProps({ role: 'dialog', 'aria-label': 'ZCode · 账号' })).toBeDefined()
    await t.click('添加账号')
    expect(t.button('其他服务商（在原生终端中选择）')).toBeUndefined()
    if (provider === 'zai') {
      await t.click(label)
    }
    expect(terminal.started).not.toHaveBeenCalled()
    await t.click('继续')
    expect(terminal.started).toHaveBeenCalledExactlyOnceWith('zcode', 'login', { provider })
    expect(t.configure).not.toHaveBeenCalled()
    await t.click('关闭账号操作')
    expect(terminal.stopped).toHaveBeenCalledExactlyOnceWith('zcode', 'login', { provider })
    await t.click('账号')
    expect(t.button('添加账号')).toBeDefined()
    expect(terminal.started).toHaveBeenCalledTimes(1)
  },
)
it('closes the ZCode account window without a process and signs out both providers only after confirming', async () => {
  const t = await setup(
    { accountStatus: accountFixture({ state: 'authenticated', actions: zcodeActions }, 'zcode') },
    undefined,
    'zcode',
  )
  await t.click('账号')
  await t.click('关闭账号操作')
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('账号终端')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('zcode', 'manage')
  await t.click('关闭账号操作')
  await t.click('账号')
  await t.click('退出')
  expect(t.text()).toContain('BigModel 和 Z.AI 的登录会一起退出。')
  expect(terminal.started).toHaveBeenCalledTimes(1)
  await t.click('确认退出')
  expect(terminal.started).toHaveBeenLastCalledWith('zcode', 'logout')
  expect(t.configure).not.toHaveBeenCalled()
})
it.each(['native', 'plugin'] as const)(
  'waits for an explicit %s logout source choice before mounting the native terminal',
  async (source) => {
    const t = await setup({
      accountStatus: accountFixture({ state: 'authenticated', actions: scopedLogoutActions }),
    })
    await t.click('退出登录')
    expect(t.r.root.findByProps({ 'aria-label': '选择退出账号来源' })).toBeDefined()
    expect(terminal.started).not.toHaveBeenCalled()
    await t.click(source === 'native' ? '原生目录' : '插件目录')
    expect(terminal.started).toHaveBeenCalledExactlyOnceWith('antigravity', 'logout', source)
    expect(t.configure).not.toHaveBeenCalled()
  },
)
it('cancels a logout source picker without starting or stopping an account terminal', async () => {
  const t = await setup({
    accountStatus: accountFixture({ state: 'authenticated', actions: scopedLogoutActions }),
  })
  await t.click('退出登录')
  await t.click('关闭账号操作')
  expect(terminal.started).not.toHaveBeenCalled()
  expect(terminal.stopped).not.toHaveBeenCalled()
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('退出登录')
  expect(t.r.root.findByProps({ 'aria-label': '选择退出账号来源' })).toBeDefined()
  expect(terminal.started).not.toHaveBeenCalled()
})
it.each(['native', 'plugin'] as const)(
  'passes the only advertised %s logout source directly',
  async (source) => {
    const t = await setup({
      accountStatus: accountFixture({
        state: 'authenticated',
        actions: [{ ...scopedLogoutActions[0]!, sources: [{ id: source, label: '模拟自身账号' }] }],
      }),
    })
    await t.click('退出登录')
    expect(t.r.root.findAllByProps({ 'aria-label': '选择退出账号来源' })).toHaveLength(0)
    expect(terminal.started).toHaveBeenCalledExactlyOnceWith('antigravity', 'logout', source)
  },
)
it('does not fall back to an unscoped logout for an unknown source descriptor', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      actions: [{ ...scopedLogoutActions[0]!, sources: [{ id: 'other-cli', label: '模拟无效来源' }] as any }],
    }),
  })
  await t.click('退出登录')
  expect(t.text()).toContain('账号来源不可用')
  expect(terminal.started).not.toHaveBeenCalled()
})

it('displays only the native model name while saving the exact provider/model identifier', async () => {
  const id = 'account:bigmodel-individual-coding-plan/GLM-5.3'
  const label = 'GLM-5.3（BigModel · 模拟）'
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'zcode' ? remote({ cli, models: [{ id, label, efforts: ['default'] }] }) : catalog(cli),
    ),
  })
  await t.click('ZCode 设置')
  expect(visibleText(t.button('默认模型'))).toContain('GLM-5.3')
  expect(visibleText(t.button('默认模型'))).not.toContain('BigModel')
  expect(visibleText(t.button('默认模型'))).not.toMatch(/[()（）]/u)
  expect(t.configure).not.toHaveBeenCalled()
  await t.chooseModel('GLM-5.3')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({ cli: 'zcode', model: id, effort: 'default' })
})

it('deduplicates route names and puts proven free models first without combining route capabilities', async () => {
  const models = [
    { id: 'paid/GLM-5.3', label: 'GLM-5.3（paid source）', cost: 'paid', efforts: ['high'] },
    { id: 'paid/GLM-5.3-Flash', label: 'GLM-5.3-Flash（paid source）', cost: 'paid', efforts: ['medium'] },
    { id: 'free/glm-5.3', label: 'GLM-5.3 (free source)', cost: 'free', efforts: ['default'] },
  ]
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'zcode' ? remote({ cli, models }) : catalog(cli),
    ),
  })
  await t.click('ZCode 设置')
  expect(visibleText(t.button('默认模型')).trim()).toBe('GLM-5.3')
  expect(visibleText(t.button('默认思考强度'))).toContain('默认')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('默认模型')
  const menu = t.r.root.findByProps({ role: 'menu' })
  expect(menu.findAllByType('button').map((button) => visibleText(button))).toEqual([
    'GLM-5.3',
    'GLM-5.3-Flash',
  ])
  expect(visibleText(menu)).not.toMatch(/source|[()（）]/u)
  await t.click('GLM-5.3-Flash')
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Medium')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({
    cli: 'zcode',
    model: 'paid/GLM-5.3-Flash',
    effort: 'medium',
  })
})

it('retains the exact valid saved paid route when a free duplicate is available', async () => {
  const models = [
    { id: 'free/chat', label: 'Chat（free source）', cost: 'free', efforts: ['default'] },
    { id: 'paid/chat', label: 'Chat（paid source）', cost: 'paid', efforts: ['high'] },
  ]
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'pi'
        ? remote({ cli, models, preference: { cli, model: 'paid/chat', effort: 'high' } })
        : catalog(cli),
    ),
  })
  await t.click('Pi 设置')
  expect(visibleText(t.button('默认模型')).trim()).toBe('Chat')
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('默认模型')
  expect(t.r.root.findByProps({ role: 'menu' }).findAllByType('button')).toHaveLength(1)
  await t.click('Chat')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({ cli: 'pi', model: 'paid/chat', effort: 'high' })
})

it('asks to reselect an unavailable saved route instead of silently switching to a duplicate', async () => {
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'omp'
        ? remote({
            cli,
            models: [{ id: 'free/chat', label: 'Chat（free source）', cost: 'free', efforts: ['default'] }],
            preference: { cli, model: 'removed/chat', effort: 'high' },
          })
        : catalog(cli),
    ),
  })
  await t.click('OMP 设置')
  expect(visibleText(t.button('默认模型')).trim()).toBe('选择模型')
  expect(t.text()).toContain('原默认模型已不可用，请重新选择模型')
  expect(t.button('默认模型').props.disabled).toBe(false)
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('默认模型')
  await t.click('Chat')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({
    cli: 'omp',
    model: 'free/chat',
    effort: 'default',
  })
})

it('uses Kimi supported default effort without a saved preference and can persist it', async () => {
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'kimi'
        ? remote({ cli, models: [{ id: 'kimi-simulation', efforts: ['default'] }] })
        : catalog(cli),
    ),
  })
  await t.click('Kimi 设置')
  expect(t.text()).toContain('kimi-simulation')
  expect(t.text()).toContain('默认')
  expect(t.button('默认模型').props.disabled).toBe(false)
  await t.click('默认思考强度')
  expect(
    t.r.root
      .findAllByProps({ role: 'menu' })[0]!
      .findAllByType('button')
      .map((item) => item.children.join('')),
  ).toEqual(['默认'])
  await t.click('默认')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({
    cli: 'kimi',
    model: 'kimi-simulation',
    effort: 'default',
  })
  expect(t.configure).toHaveBeenCalledOnce()
})

it('persists each CLI switch without moving the current navigation row until reopening', async () => {
  const t = await setup()
  const navigation = () =>
    t.r.root
      .findByProps({ 'aria-label': 'CLI 设置导航' })
      .findAllByType('button')
      .filter((button) => button.props.className === 'cwn-settings-cli-item')
  expect(navigation().map((button) => button.props['aria-label'])).toEqual(
    CLI_IDS.map((id) => `${CLI_LABELS[id]} 设置`),
  )
  await t.click('启用 Antigravity')
  expect(t.setCliEnabled.mock.calls[0]!.slice(0, 3)).toEqual(['simulation-parent', 'antigravity', false])
  expect(t.button('启用 Antigravity').props['aria-checked']).toBe(false)
  expect(t.button('Antigravity 设置').props['data-enabled']).toBe(false)
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(navigation()[0]!.props['aria-label']).toBe('Antigravity 设置')
  await t.click('Codex 设置')
  expect(t.button('启用 Codex').props['aria-checked']).toBe(true)
  await t.click('关闭设置')
  await t.open()
  expect(navigation().at(-1)!.props['aria-label']).toBe('Antigravity 设置')
  expect(t.button('启用 Antigravity').props['aria-checked']).toBe(false)
})
it('opens the role library separately from CLI settings and returns to the same CLI', async () => {
  const rolePresets = vi.fn(async () =>
    remote([{ id: 'logic', name: '逻辑审稿人', summary: '模拟因果审查', prompt: '模拟角色' }]),
  )
  const t = await setup({ rolePresets })
  await t.click('Codex 设置')
  await t.click('智能体设置')
  expect(rolePresets).toHaveBeenCalledOnce()
  expect(t.text()).toContain('模拟因果审查')
  expect(t.button('Codex 设置').props['aria-pressed']).toBe(false)
  expect(t.r.root.findAllByProps({ 'aria-label': 'Codex 配置' })).toHaveLength(0)
  await t.click('Codex 设置')
  expect(t.button('Codex 设置').props['aria-pressed']).toBe(true)
  expect(t.r.root.findAllByProps({ 'aria-label': 'Codex 配置' })).toHaveLength(1)
})
it('collapses CLI navigation without changing the selected page or restarting its account flow', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) => status(cli, { actions: accountActions })),
  })
  await t.click('Codex 设置')
  await t.click('登录 / 切换账号')
  const callsBefore = t.catalogForCli.mock.calls.length
  const groupId = t.button('CLI 连接').props['aria-controls']
  const group = () => t.r.root.findByProps({ id: groupId })
  expect(t.button('CLI 连接').props['aria-expanded']).toBe(true)
  expect(t.button('Codex 设置').props.tabIndex).toBeUndefined()

  await t.click('CLI 连接')
  expect(t.button('CLI 连接').props['aria-expanded']).toBe(false)
  expect(group().props['aria-hidden']).toBe(true)
  expect(group().props.inert).toBe('')
  expect(
    group()
      .findAllByType('button')
      .every((button) => button.props.tabIndex === -1),
  ).toBe(true)
  expect(t.button('Codex 设置').props['aria-pressed']).toBe(true)
  expect(t.r.root.findAllByProps({ 'aria-label': 'Codex 配置' })).toHaveLength(1)
  expect(terminal.stopped).not.toHaveBeenCalled()

  await t.click('CLI 连接')
  expect(t.button('CLI 连接').props['aria-expanded']).toBe(true)
  expect(group().props['aria-hidden']).toBe(false)
  expect(group().props.inert).toBeUndefined()
  expect(t.button('Codex 设置').props.tabIndex).toBeUndefined()
  expect(t.catalogForCli).toHaveBeenCalledTimes(callsBefore)
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('codex', 'login')
})
it('keeps the same account action and form controls while discovery is pending and after it completes', async () => {
  const pendingAccount = deferred(),
    pendingModels = deferred()
  const t = await setup({
    accountStatus: vi.fn((_parent, cli: CliId) =>
      cli === 'antigravity' ? pendingAccount.promise : Promise.resolve(status(cli)),
    ),
    catalogForCli: vi.fn(() => pendingModels.promise),
  })
  const actionButtons = () =>
    t.r.root.findByProps({ className: 'cwn-account-actions' }).findAllByType('button')
  expect(actionButtons().map((button) => button.props['aria-label'])).toEqual(['登录 / 切换账号', '账号终端'])
  expect(actionButtons().every((button) => button.props.disabled)).toBe(true)
  expect(t.button('默认模型')).toBeDefined()
  expect(t.button('默认思考强度')).toBeDefined()
  const sectionsBefore = t.r.root.findAllByProps({ className: 'cwn-settings-section' }).length
  await act(async () => {
    pendingAccount.resolve(
      status('antigravity', { actions: [{ id: 'login', label: '登录 / 切换账号', description: '模拟' }] }),
    )
    pendingModels.resolve(catalog('antigravity'))
  })
  expect(actionButtons().map((button) => button.props['aria-label'])).toEqual(['登录 / 切换账号', '账号终端'])
  expect(t.button('登录 / 切换账号').props.disabled).toBe(false)
  expect(t.r.root.findAllByProps({ className: 'cwn-settings-section' })).toHaveLength(sectionsBefore)
  expect(t.button('默认模型').props.disabled).toBe(false)
})
it('does not query disabled CLIs and never allows stale account results to re-enable their controls', async () => {
  const pending = deferred()
  const t = await setup({
    accountStatus: vi.fn((_parent, cli: CliId) =>
      cli === 'antigravity' ? pending.promise : Promise.resolve(status(cli)),
    ),
  })
  await t.click('启用 Antigravity')
  await act(async () =>
    pending.resolve(
      status('antigravity', {
        summary: 'stale disabled account',
        actions: [{ id: 'login', label: '登录 / 切换账号', description: '模拟' }],
      }),
    ),
  )
  expect(t.text()).not.toContain('stale disabled account')
  expect(t.button('登录 / 切换账号').props.disabled).toBe(true)
  expect(terminal.started).not.toHaveBeenCalled()
  const modelsBeforeReopen = t.catalogForCli.mock.calls.length
  await t.click('关闭设置')
  await t.open()
  expect(t.catalogForCli.mock.calls.length).toBe(modelsBeforeReopen)
  expect(t.button('默认模型').props.disabled).toBe(true)
  await t.click('启用 Antigravity')
  expect(t.catalogForCli.mock.calls.length).toBe(modelsBeforeReopen + 1)
})
it('shows truthful connection dots and distinguishes CLI availability from verified authentication', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) =>
      status(cli, {
        state: cli === 'codex' ? 'authenticated' : cli === 'claude' ? 'unauthenticated' : 'unknown',
        verification: 'cli',
      }),
    ),
  })
  expect(t.button('Codex 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe(
    'connected',
  )
  expect(t.button('Codex 设置').findByProps({ role: 'img' }).props['aria-label']).toBe('已登录')
  expect(
    t.button('Claude Code 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('failed')
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(
    'antigravity 模拟状态待确认',
  )
})
it.each(['zcode', 'grok', 'omp', 'pi', 'hermes', 'opencode'] as const)(
  'keeps %s configured credentials neutral before and after its model directory loads',
  async (cli) => {
    const models = deferred()
    const t = await setup({
      accountStatus: vi.fn(async (_parent, id: CliId) =>
        status(id, {
          state: 'configured',
          verification: 'local',
          authMethod: 'oauth',
          accountLabel: 'fixture@example.invalid',
        }),
      ),
      catalogForCli: vi.fn((_parent, id: CliId) =>
        id === cli ? models.promise : Promise.resolve(catalog(id)),
      ),
    })
    const nav = `${CLI_LABELS[cli]} 设置`
    expect(t.button(nav).findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe(
      'unverified',
    )
    await t.click(nav)
    expect(t.button(nav).findAllByProps({ 'data-loading': true })).toHaveLength(0)
    expect(t.button('默认模型').props.disabled).toBe(true)
    await act(async () => models.resolve(catalog(cli)))
    expect(t.button(nav).findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe(
      'unverified',
    )
    expect(visibleText(accountSummary(t.r))).toContain(`${cli} 模拟状态待确认`)
    expect(visibleText(accountSummary(t.r))).not.toContain('已登录')
    expect(terminal.started).not.toHaveBeenCalled()
    expect(t.configure).not.toHaveBeenCalled()
  },
)

it.each(['antigravity', 'mimo'] as const)(
  'keeps %s logged in while invalidating model choices during a catalog refresh and failure',
  async (cli) => {
    const read = deferred()
    const t = await setup({
      accountStatus: vi.fn(async (_parent, id: CliId) =>
        status(id, { state: 'authenticated', verification: 'cli' }),
      ),
    })
    await t.click(`${CLI_LABELS[cli]} 设置`)
    expect(t.button('默认模型').props.disabled).toBe(false)
    t.refreshCatalogForCli.mockReturnValueOnce(read.promise)
    await t.click('刷新模型')
    expect(t.button(`${CLI_LABELS[cli]} 设置`).findAllByProps({ 'data-loading': true })).toHaveLength(0)
    expect(visibleText(accountSummary(t.r))).toContain('已登录')
    expect(visibleText(t.button('默认模型'))).toContain('选择模型')
    expect(t.button('默认模型').props.disabled).toBe(true)
    await act(async () => read.reject(new Error('模拟：当前账号无可用模型')))
    expect(
      t.button(`${CLI_LABELS[cli]} 设置`).findByProps({ className: 'cwn-connection-dot' }).props[
        'data-state'
      ],
    ).toBe('connected')
    expect(visibleText(accountSummary(t.r))).toContain('已登录')
    expect(t.text()).not.toContain(`${cli}-fixture`)
    expect(t.button('默认模型').props.disabled).toBe(true)
    expect(t.text()).toContain('模拟：当前账号无可用模型')
    expect(t.configure).not.toHaveBeenCalled()
  },
)

it('waits for a refreshed account before reading its new model scope and ignores the superseded catalog', async () => {
  const oldModels = deferred(),
    freshModels = deferred(),
    account = deferred()
  const catalogForCli = vi
    .fn()
    .mockResolvedValueOnce(catalog('antigravity', 'original-model'))
    .mockReturnValueOnce(freshModels.promise)
  const refreshCatalogForCli = vi.fn().mockReturnValueOnce(oldModels.promise)
  const accountStatus = accountFixture({ state: 'authenticated', verification: 'cli' })
  const t = await setup({ catalogForCli, refreshCatalogForCli, accountStatus })
  await t.click('刷新模型')
  accountStatus.mockReturnValueOnce(account.promise)
  await t.click('刷新状态')
  expect(catalogForCli).toHaveBeenCalledTimes(1)
  expect(refreshCatalogForCli).toHaveBeenCalledTimes(1)
  expect(refreshCatalogForCli.mock.calls[0]![2].aborted).toBe(true)
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(visibleText(accountSummary(t.r))).toContain('已登录')
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('connected')
  await act(async () => oldModels.resolve(catalog('antigravity', 'stale-account-model')))
  expect(t.text()).not.toContain('stale-account-model')
  await act(async () =>
    account.resolve(status('antigravity', { state: 'configured', verification: 'local' })),
  )
  expect(catalogForCli).toHaveBeenCalledTimes(2)
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(visibleText(accountSummary(t.r))).toContain('antigravity 模拟状态待确认')
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('unverified')
  await act(async () => freshModels.resolve(catalog('antigravity', 'new-account-model')))
  expect(t.text()).toContain('new-account-model')
  expect(t.text()).not.toContain('original-model')
  expect(t.configure).not.toHaveBeenCalled()
})

it('rejects cross-CLI account and model responses without exposing their identities or choices', async () => {
  const t = await setup({
    accountStatus: vi.fn(async () =>
      status('pi', { state: 'authenticated', verification: 'cli', accountLabel: 'wrong-account' }),
    ),
    catalogForCli: vi.fn(async () => catalog('pi', 'wrong-cli-model')),
  })
  expect(t.text()).toContain('收到不匹配的 CLI 账号状态')
  expect(t.text()).toContain('收到不匹配的 CLI 模型目录')
  expect(t.text()).not.toContain('wrong-account')
  expect(t.text()).not.toContain('wrong-cli-model')
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(terminal.started).not.toHaveBeenCalled()
})

it('shows an empty catalog reason and releases its pending navigation indicator when switching away', async () => {
  const read = deferred()
  const t = await setup({
    catalogForCli: vi.fn((_parent, cli: CliId) =>
      cli === 'antigravity'
        ? read.promise
        : Promise.resolve(
            remote({
              cli,
              models: [],
              notice: '模拟：当前账号范围未知，请完成原生登录后刷新',
            }),
          ),
    ),
  })
  await t.click('Codex 设置')
  expect(t.button('Antigravity 设置').findAllByProps({ 'data-loading': true })).toHaveLength(0)
  expect(t.text()).toContain('模拟：当前账号范围未知，请完成原生登录后刷新')
  await t.click('默认模型')
  expect(t.r.root.findByProps({ role: 'menu' }).findAllByType('button')).toHaveLength(0)
  expect(t.button('默认思考强度').props.disabled).toBe(true)
  expect(t.configure).not.toHaveBeenCalled()
  await act(async () => read.resolve(catalog('antigravity', 'late-model')))
  expect(t.text()).not.toContain('late-model')
})
it('keeps a rejected enablement change scoped to its CLI and preserves the saved state', async () => {
  const write = deferred()
  const t = await setup({ setCliEnabled: vi.fn(() => write.promise) })
  await t.click('启用 Antigravity')
  await t.click('Codex 设置')
  expect(t.button('启用 Codex').props.disabled).toBe(true)
  await act(async () => write.reject(new Error('模拟：CLI 有活动任务')))
  expect(t.text()).not.toContain('模拟：CLI 有活动任务')
  expect(t.button('启用 Codex').props.disabled).toBe(false)
  await t.click('Antigravity 设置')
  expect(t.text()).toContain('模拟：CLI 有活动任务')
  expect(t.button('启用 Antigravity').props['aria-checked']).toBe(true)
})

it('does not start discovery before saved enablement loads and keeps navigation available', async () => {
  const preferences = deferred()
  const t = await setup({ cliSettings: vi.fn(() => preferences.promise) })
  expect(t.catalogForCli).not.toHaveBeenCalled()
  expect(t.accountStatus).not.toHaveBeenCalled()
  expect(t.button('启用 Antigravity').props.disabled).toBe(true)
  expect(t.button('默认模型')).toBeDefined()
  await t.click('Codex 设置')
  expect(t.button('启用 Codex').props.disabled).toBe(true)
  await act(async () =>
    preferences.resolve(
      remote({ enabled: Object.fromEntries(CLI_IDS.map((id) => [id, id !== 'antigravity'])) }),
    ),
  )
  expect(t.catalogForCli.mock.calls.map((call) => call[1])).toEqual(['codex'])
  expect(t.accountStatus.mock.calls.map((call) => call[1])).not.toContain('antigravity')
  expect(t.button('启用 Codex').props.disabled).toBe(false)
})
it('caches status across navigation and permits only one in-flight status probe per CLI', async () => {
  const t = await setup()
  await t.click('Codex 设置')
  await t.click('Antigravity 设置')
  expect(t.accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(1)
  const pending = deferred()
  t.accountStatus.mockReturnValueOnce(pending.promise)
  await t.click('刷新状态')
  expect(t.button('刷新状态').props.disabled).toBe(true)
  // Directly invoke the disabled handler as a stress check on the parent guard.
  await t.click('刷新状态')
  expect(t.accountStatus.mock.calls.filter((call) => call[1] === 'antigravity')).toHaveLength(2)
  await act(async () => pending.resolve(status('antigravity')))
  expect(t.button('刷新状态').props.disabled).toBe(false)
})
it('stops loading indicators after an enablement query failure without dispatching CLI probes', async () => {
  const t = await setup({ cliSettings: vi.fn().mockRejectedValue(new Error('模拟：设置读取失败')) })
  expect(t.text()).toContain('模拟：设置读取失败')
  expect(t.text()).not.toContain('data-loading')
  expect(t.accountStatus).not.toHaveBeenCalled()
  expect(t.catalogForCli).not.toHaveBeenCalled()
  expect(t.button('启用 Antigravity').props.disabled).toBe(true)
  expect(t.button('关闭设置').props.disabled).not.toBe(true)
})

it('keeps unknown accounts grey even after reading models and shows configured credentials with their evidence scope', async () => {
  const models = deferred()
  const t = await setup({
    catalogForCli: vi.fn((_parent, cli: CliId) =>
      cli === 'antigravity' ? models.promise : Promise.resolve(catalog(cli)),
    ),
    accountStatus: vi.fn(async (_parent, cli: CliId) =>
      status(cli, { state: cli === 'kimi' ? 'configured' : 'unknown' }),
    ),
  })
  expect(t.button('Antigravity 设置').findAllByProps({ 'data-loading': true })).toHaveLength(0)
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(
    'antigravity 模拟状态待确认',
  )
  expect(t.button('Codex 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe(
    'unknown',
  )
  expect(t.button('Kimi 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe(
    'unverified',
  )
  expect(t.button('Kimi 设置').findByProps({ role: 'img' }).props['aria-label']).toBe('kimi 模拟状态待确认')
  await act(async () => models.resolve(catalog('antigravity')))
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('unknown')
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(
    'antigravity 模拟状态待确认',
  )
})

it('dismisses an open model menu when its CLI is disabled and does not reopen it on enable', async () => {
  const t = await setup()
  await t.click('默认模型')
  expect(t.button('默认模型').props['aria-expanded']).toBe(true)
  await t.click('启用 Antigravity')
  expect(t.button('默认模型').props['aria-expanded']).toBe(false)
  await t.click('启用 Antigravity')
  expect(t.button('默认模型').props.disabled).toBe(false)
  expect(t.button('默认模型').props['aria-expanded']).toBe(false)
})

it('keeps an unknown Antigravity account grey across catalog failure and retry', async () => {
  const refreshCatalogForCli = vi
    .fn()
    .mockRejectedValueOnce(new Error('模拟目录连接失败'))
    .mockResolvedValueOnce(catalog('antigravity'))
  const t = await setup({ refreshCatalogForCli })
  const dot = () =>
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state']
  expect(dot()).toBe('unknown')
  await t.click('刷新模型')
  expect(dot()).toBe('unknown')
  expect(t.text()).toContain('模拟目录连接失败')
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(
    'antigravity 模拟状态待确认',
  )
  await t.click('刷新模型')
  expect(dot()).toBe('unknown')
})
it.each(['rejected', 'empty'] as const)(
  'keeps the authenticated account summary short and shows the useful model error from a %s catalog',
  async (failure) => {
    const reason = '模拟：无法确认当前自身账号，请登录后刷新'
    const t = await setup({
      accountStatus: accountFixture({
        state: 'authenticated',
        authMethod: 'oauth',
        accountLabel: 'fixture@example.invalid',
        actions: accountActions,
      }),
      catalogForCli: vi.fn(async (_parent, cli: CliId) => {
        if (failure === 'rejected') throw new Error(`CliAccountBindingError: ${reason}`)
        return remote({ cli, models: [], notice: `Error: CliAccountBindingError: ${reason}` })
      }),
    })
    const summary = accountSummary(t.r)
    expect(visibleText(summary.findByProps({ className: 'cwn-account-login' })).trim()).toBe('已登录')
    expect(summary.props['data-account-state']).toBe('authenticated')
    expect(visibleText(summary)).toContain('fixture@example.invalid')
    expect(summary.findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe('connected')
    expect(t.text()).toContain(reason)
    expect(t.text()).not.toContain('Error:')
    if (failure === 'rejected') expect(t.button('默认模型').props.disabled).toBe(true)
    else {
      await t.click('默认模型')
      expect(t.r.root.findByProps({ role: 'menu' }).findAllByType('button')).toHaveLength(0)
    }
    expect(t.button('默认思考强度').props.disabled).toBe(true)
    expect(t.configure).not.toHaveBeenCalled()
  },
)
it('keeps configured credentials neutral when the model catalog is empty', async () => {
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      cli === 'antigravity' ? remote({ cli, models: [] }) : catalog(cli),
    ),
    accountStatus: vi.fn(async (_parent, cli: CliId) => status(cli, { state: 'configured' })),
  })
  const dot = (label: string) =>
    t.button(label).findByProps({ className: 'cwn-connection-dot' }).props['data-state']
  expect(dot('Antigravity 设置')).toBe('unverified')
  expect(dot('Codex 设置')).toBe('unverified')
  await t.click('Codex 设置')
  expect(t.text()).toContain('codex-fixture')
  expect(dot('Codex 设置')).toBe('unverified')
})
it('never upgrades an explicit unauthenticated account to connected after a model catalog succeeds', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) =>
      status(cli, { state: 'unauthenticated', summary: '模拟：请先登录' }),
    ),
  })
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('failed')
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe('模拟：请先登录')
})

function accountSummary(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) =>
      typeof node.props.className === 'string' &&
      node.props.className.split(/\s+/).includes('cwn-account-summary'),
  )
}
function visibleText(node: ReturnType<typeof accountSummary>): string {
  return node.children.map((child) => (typeof child === 'string' ? child : visibleText(child))).join(' ')
}
function accountFixture(changes: Partial<AccountStatus>, selected: CliId = 'antigravity') {
  return vi.fn(async (_parent, cli: CliId) => status(cli, cli === selected ? changes : {}))
}

it.each([
  ['zcode', 'ZCode 账号绑定未确认，请重新登录'],
  ['zcode', 'ZCode 登录凭据已保存，账号绑定未确认，请重新登录'],
  ['zcode', '已保存 ZCode 续期凭据'],
  ['zcode', '已配置 ZCode API'],
  ['mimo', '已配置 MiMo 账号，请检查登录'],
  ['pi', '尚未配置有效凭据'],
  ['omp', '尚未配置有效凭据'],
  ['opencode', '尚未配置有效凭据'],
  ['hermes', 'Hermes 登录已保存，等待自动续期'],
  ['codex', 'CLI 已配置令牌，账号类型待确认'],
  ['qoder', '已配置 Qoder PAT，待原生目录验证'],
  ['kimi', '已配置 Kimi API'],
  ['zcode', ''],
  ['zcode', '   '],
] as const)('preserves the configured %s reason in navigation and account summary: %s', async (cli, summary) => {
  const t = await setup({ accountStatus: accountFixture({ state: 'configured', summary }, cli) }, undefined, cli)
  const expected = summary.trim() || '已配置'
  const nav = t.button(`${CLI_LABELS[cli]} 设置`)
  expect(nav.findByProps({ role: 'img' }).props['aria-label']).toBe(expected)
  expect(visibleText(accountSummary(t.r)).trim()).toBe(expected)
  expect(nav.findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe('unverified')
  expect(accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe('unverified')
  expect(accountSummary(t.r).findAllByProps({ className: 'cwn-account-detail' })).toHaveLength(0)
  expect(terminal.started).not.toHaveBeenCalled()
  expect(t.configure).not.toHaveBeenCalled()
})

it.each([
  { state: 'configured', summary: 'ZCode 账号绑定未确认，请重新登录', label: 'ZCode 账号绑定未确认，请重新登录' },
  { state: 'configured', authMethod: 'api', summary: '已配置 ZCode API', label: '已配置 ZCode API' },
  { state: 'unconfigured', summary: '尚未配置 ZCode API', label: '未登录' },
] as const)('refreshes the ZCode window and settings after synthetic logout: $summary', async (after) => {
  let current: Partial<AccountStatus> = {
    state: 'authenticated', authMethod: 'oauth', summary: '已登录 ZCode', accountLabel: 'fixture@example.invalid',
  }
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) => status(cli, cli === 'zcode'
      ? { ...current, actions: accountActions } : {})),
  }, undefined, 'zcode')
  await t.click('账号')
  await t.click('退出')
  expect(t.text()).toContain('BigModel 和 Z.AI 的登录会一起退出。')
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('确认退出')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('zcode', 'logout')
  current = after
  await t.click('完成模拟账号操作')
  await t.click('关闭模拟账号操作')
  expect(t.text()).toContain('尚未登录 ZCode 的任何账号')
  expect(t.r.root.findAllByProps({ className: 'cwn-accounts-card' })).toHaveLength(0)
  expect(t.text()).not.toContain('fixture@example.invalid')
  expect(visibleText(accountSummary(t.r)).trim()).toBe(after.label)
  expect(t.button('ZCode 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(after.label)
  expect(t.button('登录账号')).toBeDefined()
  expect(t.configure).not.toHaveBeenCalled()
})

it.each(['unconfigured', 'unauthenticated', 'unavailable', 'unknown', 'configured'] as const)(
  'keeps both health indicators consistent for %s while preserving model error evidence',
  async (state) => {
    const t = await setup({
      accountStatus: accountFixture({ state, summary: `模拟：${state}` }),
      catalogForCli: vi.fn(async (_parent, cli: CliId) =>
        cli === 'antigravity' ? remote({ cli, models: [] }) : catalog(cli),
      ),
    })
    const nav = t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props[
      'data-state'
    ]
    const summary = accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props[
      'data-state'
    ]
    expect(nav).toBe(
      state === 'unconfigured'
        ? 'unconfigured'
        : state === 'configured'
          ? 'unverified'
          : state === 'unknown'
            ? 'unknown'
            : 'failed',
    )
    expect(summary).toBe(nav)
    expect(t.text()).toContain('此 CLI 未返回可用模型')
    if (state === 'unconfigured') expect(visibleText(accountSummary(t.r))).toContain('未登录')
    if (state === 'unauthenticated')
      expect(visibleText(accountSummary(t.r))).toContain('模拟：unauthenticated')
  },
)

it('keeps account indicators unchanged after retrying a failed catalog without restarting account actions or altering preferences', async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('模拟：目录损坏'))
    .mockResolvedValue(catalog('antigravity'))
  const t = await setup({
    catalogForCli: read,
    accountStatus: accountFixture({ state: 'configured', verification: 'local' }),
  })
  const dots = () => [
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
    accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state'],
  ]
  expect(dots()).toEqual(['unverified', 'unverified'])
  await t.click('刷新模型')
  expect(dots()).toEqual(['unverified', 'unverified'])
  expect(t.refreshCatalogForCli).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
  expect(t.button('默认模型').props.disabled).toBe(false)
  expect(visibleText(accountSummary(t.r))).toContain('antigravity 模拟状态待确认')
  expect(terminal.started).not.toHaveBeenCalled()
})

it('keeps an absent default installation grey in both indicators despite model lookup failure', async () => {
  const t = await setup({
    accountStatus: accountFixture({ state: 'unconfigured', installed: false, summary: '模拟：尚未安装 CLI' }),
    catalogForCli: vi.fn().mockRejectedValue(new Error('模拟：CLI 不存在')),
  })
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('unconfigured')
  expect(accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe(
    'unconfigured',
  )
  expect(visibleText(accountSummary(t.r))).toContain('未安装')
})

it('refreshes an invalid login to a readable configuration without writing preferences or starting a terminal', async () => {
  const accountStatus = accountFixture({ state: 'unauthenticated', summary: '模拟：登录已过期' })
  const t = await setup({
    accountStatus,
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      remote({
        cli,
        models: [
          { id: 'simulation-first', efforts: ['low'] },
          { id: 'simulation-saved', efforts: ['high'] },
        ],
        preference: { cli, model: 'simulation-saved', effort: 'high' },
      }),
    ),
  })
  const dots = () => [
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
    accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state'],
  ]
  expect(dots()).toEqual(['failed', 'failed'])
  expect(t.button('默认模型').findAllByType('span')[0].children).toContain('simulation-saved')
  accountStatus.mockImplementation((_parent, cli: CliId) =>
    Promise.resolve(status(cli, { state: 'configured', verification: 'local' })),
  )
  await t.click('刷新状态')
  expect(dots()).toEqual(['unverified', 'unverified'])
  expect(visibleText(accountSummary(t.r))).toContain('antigravity 模拟状态待确认')
  expect(t.button('默认模型').findAllByType('span')[0].children).toContain('simulation-saved')
  expect(t.configure).not.toHaveBeenCalled()
  expect(terminal.started).not.toHaveBeenCalled()
})

it('shows the authenticated OAuth account with its login indicator in the persistent account summary', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'cli',
      accountLabel: 'Fixture Person · fixture@example.invalid',
      summary: '模拟：原生 CLI 报告已登录',
    }),
  })
  const summary = accountSummary(t.r)
  expect(visibleText(summary)).toContain('已登录')
  expect(visibleText(summary)).toContain('Fixture Person · fixture@example.invalid')
  expect(summary.findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe('connected')
})
it('labels API authentication distinctly and never renders an API account label supplied by the host', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'api',
      verification: 'cli',
      accountLabel: 'SIMULATED_SECRET_MUST_NOT_RENDER',
      summary: '模拟：API 凭据已配置',
    }),
  })
  expect(visibleText(accountSummary(t.r))).toContain('API 登录')
  expect(t.text()).not.toContain('SIMULATED_SECRET_MUST_NOT_RENDER')
  expect(accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe(
    'connected',
  )
})
it.each(['omp', 'pi', 'hermes', 'opencode'] as const)(
  'shows %s own provider API authentication consistently in the account row and navigation',
  async (cli) => {
    const t = await setup({
      accountStatus: vi.fn(async (_parent, id: CliId) =>
        status(id, {
          state: 'authenticated',
          verification: 'local',
          logins: [{ providerLabel: 'zai.cn', authMethod: 'api', accountLabel: 'SYNTHETIC_SECRET' }],
        }),
      ),
    })
    await t.click(`${CLI_LABELS[cli]} 设置`)
    const summary = accountSummary(t.r)
    expect(visibleText(summary)).toContain('zai.cn API 登录')
    expect(summary.findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe('connected')
    const nav = t.button(`${CLI_LABELS[cli]} 设置`)
    expect(nav.findByProps({ className: 'cwn-connection-dot' }).props['data-state']).toBe('connected')
    expect(nav.findByProps({ role: 'img' }).props['aria-label']).toBe('zai.cn API 登录')
    expect(summary.findAllByProps({ className: 'cwn-account-detail' })).toHaveLength(0)
    expect(t.text()).not.toContain('SYNTHETIC_SECRET')
    expect(terminal.started).not.toHaveBeenCalled()
    expect(t.configure).not.toHaveBeenCalled()
  },
)
it('shows only deduplicated OAuth providers while retaining all safe authentication details', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      logins: [
        { providerLabel: 'OpenAI', authMethod: 'oauth', accountLabel: 'fixture@example.invalid' },
        { providerLabel: 'zai.cn', authMethod: 'api', accountLabel: 'SYNTHETIC_API_SECRET' },
        { providerLabel: 'OpenAI', authMethod: 'api' },
        { providerLabel: 'OpenAI', authMethod: 'oauth', accountLabel: 'second@example.invalid' },
        { providerLabel: 'Nous', authMethod: 'oauth' },
      ],
    }),
  })
  const label = 'OpenAI账号登录 · Nous账号登录'
  const summary = accountSummary(t.r)
  const line = summary.findByProps({ className: 'cwn-account-logins' })
  expect(visibleText(line)).toBe(label)
  expect(line.props['aria-label']).toBe(label)
  expect(line.props.title).toBe(
    'OpenAI账号登录 fixture@example.invalid · zai.cn API 登录 · OpenAI API 登录 · OpenAI账号登录 second@example.invalid · Nous账号登录',
  )
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe(label)
  expect(t.text()).not.toContain('SYNTHETIC_API_SECRET')
  expect(summary.findAllByProps({ className: 'cwn-account-label' })).toHaveLength(0)
})
it('keeps each API-only provider visible while removing duplicate authentication labels', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      logins: [
        { providerLabel: 'zai.cn', authMethod: 'api' },
        { providerLabel: 'OpenAI', authMethod: 'api', accountLabel: 'SYNTHETIC_SECRET' },
        { providerLabel: 'zai.cn', authMethod: 'api' },
      ],
    }),
  })
  const line = accountSummary(t.r).findByProps({ className: 'cwn-account-logins' })
  expect(visibleText(line)).toBe('zai.cn API 登录 · OpenAI API 登录')
  expect(line.props.title).toBe('zai.cn API 登录 · OpenAI API 登录')
  expect(t.text()).not.toContain('SYNTHETIC_SECRET')
})
it('keeps the current Kimi account identity visibly separate from its legacy login summary', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) =>
      status(cli, {
        state: 'authenticated',
        authMethod: 'oauth',
        accountLabel: 'fixture-kimi@example.invalid',
        actions: accountActions,
      }),
    ),
  })
  await t.click('Kimi 设置')
  const summary = accountSummary(t.r)
  expect(visibleText(summary)).toContain('已登录')
  expect(visibleText(summary.findByProps({ className: 'cwn-account-label' }))).toBe(
    'fixture-kimi@example.invalid',
  )
  expect(summary.findAllByProps({ className: 'cwn-account-logins' })).toHaveLength(0)
})
it.each(['omp', 'pi', 'hermes'] as const)(
  'opens the %s native sign-out from its account window after an explicit click',
  async (cli) => {
    const t = await setup({
      accountStatus: vi.fn(async (_parent, id: CliId) =>
        status(id, {
          state: 'authenticated',
          // A stored login without its own handle: its CLI's menu, in its own location.
          logins: [{ providerLabel: 'OpenAI', authMethod: 'oauth', source: 'native' }],
          actions: accountActions,
        }),
      ),
    })
    await t.click(`${CLI_LABELS[cli]} 设置`)
    expect(t.button('退出登录')).toBeUndefined()
    await t.click('账号')
    expect(t.text()).toContain('OpenAI账号登录')
    expect(terminal.started).not.toHaveBeenCalled()
    await t.click('在原生终端中退出')
    expect(terminal.started).toHaveBeenCalledExactlyOnceWith(cli, 'logout', 'native')
    expect(t.configure).not.toHaveBeenCalled()
  },
)
it('groups Pi logins by location, signs out each one where it is stored and leaves config keys alone', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, id: CliId) =>
      status(id, {
        state: 'authenticated',
        logins: [
          { providerLabel: 'DeepSeek', authMethod: 'api', id: 'pi:deepseek:plugin', source: 'plugin' },
          { providerLabel: 'Anthropic', authMethod: 'oauth', id: 'pi:anthropic:native', source: 'native' },
          { providerLabel: 'OpenRouter', authMethod: 'api' },
        ],
        actions: accountActions,
      }),
    ),
  })
  await t.click('Pi 设置')
  await t.click('账号')
  const text = t.text()
  // Native location first, then the plugin's own, then keys from env or config files.
  expect(text.indexOf('原生目录')).toBeLessThan(text.indexOf('插件目录'))
  expect(text.indexOf('插件目录')).toBeLessThan(text.indexOf('其他配置'))
  expect(text).toContain('直接运行 Pi 时也会使用')
  expect(text).toContain('在原配置中管理')
  const signOuts = t.r.root.findAllByType('button').filter((b) => b.children.includes('退出'))
  expect(signOuts).toHaveLength(2)
  // The second row is the plugin's DeepSeek key.
  await act(async () => signOuts[1]!.props.onClick())
  await t.click('确认退出')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('pi', 'logout', { login: 'pi:deepseek:plugin' })
})
it.each([
  { identity: 'fixture@example.invalid', visible: true },
  { identity: 'Bearer SYNTHETIC_SECRET', visible: false },
  { identity: '<fixture@example.invalid>', visible: false },
  { identity: 'fixture\n@example.invalid', visible: false },
] as const)(
  'keeps a safe OAuth email only in provider login details: $identity',
  async ({ identity, visible }) => {
    const t = await setup({
      accountStatus: accountFixture({
        state: 'authenticated',
        logins: [{ providerLabel: 'Nous', authMethod: 'oauth', accountLabel: identity }],
      }),
    })
    const line = accountSummary(t.r).findByProps({ className: 'cwn-account-logins' })
    expect(visibleText(line)).toBe('Nous账号登录')
    expect(line.props.title).toBe(`Nous账号登录${visible ? ` ${identity}` : ''}`)
    if (!visible) expect(t.text()).not.toContain(identity)
  },
)
it('does not render malformed provider projections or credential-shaped provider names', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'api',
      logins: [
        { providerLabel: 'Bearer SYNTHETIC_SECRET', authMethod: 'api' },
        { providerLabel: '<script>', authMethod: 'oauth' },
        { providerLabel: 'zai.cn', authMethod: 'api' },
      ],
    }),
  })
  expect(visibleText(accountSummary(t.r))).toContain('zai.cn API 登录')
  expect(t.text()).not.toMatch(/SYNTHETIC_SECRET|<script>/)
})
it('does not fall back to a legacy identity when all provider login projections are invalid', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      accountLabel: 'SYNTHETIC_LEGACY_SECRET',
      logins: [
        { providerLabel: 'sk-SYNTHETIC_KEY', authMethod: 'api', accountLabel: 'SYNTHETIC_API_SECRET' },
      ],
    }),
  })
  expect(visibleText(accountSummary(t.r))).toContain('已登录')
  expect(t.text()).not.toMatch(/SYNTHETIC_LEGACY_SECRET|SYNTHETIC_KEY|SYNTHETIC_API_SECRET/)
})
it.each(['configured', 'unknown', 'unconfigured', 'unauthenticated', 'unavailable'] as const)(
  'does not promote %s to logged in or expose provider identities from stale projections',
  async (state) => {
    const t = await setup({
      accountStatus: accountFixture({
        state,
        summary: `模拟：${state}`,
        logins: [
          { providerLabel: 'STALE_PROVIDER', authMethod: 'oauth', accountLabel: 'stale@example.invalid' },
        ],
      }),
    })
    expect(
      t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
    ).not.toBe('connected')
    expect(t.text()).not.toMatch(/STALE_PROVIDER|stale@example.invalid/)
  },
)
it('preserves provider logins through a failed model refresh and removes them when refreshed account evidence fails', async () => {
  const accountStatus = accountFixture({
    state: 'authenticated',
    logins: [
      { providerLabel: 'OpenAI', authMethod: 'oauth' },
      { providerLabel: 'zai.cn', authMethod: 'api' },
    ],
  })
  const t = await setup({ accountStatus })
  const label = 'OpenAI账号登录'
  const models = deferred()
  t.refreshCatalogForCli.mockReturnValueOnce(models.promise)
  await t.click('刷新模型')
  expect(visibleText(accountSummary(t.r))).toContain(label)
  expect(t.button('默认模型').props.disabled).toBe(true)
  await act(async () => models.reject(new Error('模拟：当前账号目录不可用')))
  expect(visibleText(accountSummary(t.r))).toContain(label)
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('connected')
  const account = deferred()
  accountStatus.mockReturnValueOnce(account.promise)
  await t.click('刷新状态')
  expect(visibleText(accountSummary(t.r))).toContain(label)
  await act(async () => account.reject(new Error('模拟：账号读取失败')))
  expect(t.text()).not.toMatch(/OpenAI账号登录|zai.cn API 登录/)
  expect(
    t.button('Antigravity 设置').findByProps({ className: 'cwn-connection-dot' }).props['data-state'],
  ).toBe('failed')
  expect(t.configure).not.toHaveBeenCalled()
})
it('shows only the login state when the authenticated CLI has no account identity', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'cli',
      summary: '模拟：已登录',
    }),
  })
  expect(visibleText(accountSummary(t.r))).toContain('已登录')
  expect(visibleText(accountSummary(t.r))).not.toContain('CLI 未提供账号信息')
})
it.each(CLI_IDS)(
  'shows %s native authenticated sessions in one line regardless of local evidence source',
  async (cli) => {
    const t = await setup({
      accountStatus: vi.fn(async (_parent, id: CliId) =>
        status(id, {
          state: 'authenticated',
          authMethod: 'oauth',
          verification: 'local',
          accountLabel: 'fixture-local@example.invalid',
          summary: '模拟：本地登录信息；未进行远程验证；本地凭据不代表登录有效',
          actions: accountActions,
        }),
      ),
    })
    if (cli !== 'antigravity') await t.click(`${CLI_LABELS[cli]} 设置`)
    const summary = accountSummary(t.r)
    expect(visibleText(summary)).toContain('fixture-local@example.invalid')
    expect(visibleText(summary)).toContain('已登录')
    expect(summary.findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe('connected')
    expect(
      t.button(`${CLI_LABELS[cli]} 设置`).findByProps({ className: 'cwn-connection-dot' }).props[
        'data-state'
      ],
    ).toBe('connected')
    expect(summary.findAllByProps({ className: 'cwn-account-detail' })).toHaveLength(0)
    expect(t.text()).not.toMatch(
      /未进行远程验证|本地凭据不代表|模拟登录能力说明|模拟退出能力说明|模拟管理能力说明/,
    )
    if (MULTI_ACCOUNT_CLIS.has(cli)) expect(t.button('账号')).toBeDefined()
    else expect(t.button('登录 / 切换账号').children).toContain('切换账号')
    expect(terminal.started).not.toHaveBeenCalled()
    expect(t.configure).not.toHaveBeenCalled()
  },
)
it('adds a Kimi account in its native terminal from the account window without logging out', async () => {
  const accountStatus = vi.fn(async (_parent, cli: CliId) =>
    status(cli, {
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'local',
      actions: [
        { id: 'login', label: '管理登录', description: '模拟：由用户在原生终端管理登录' },
        { id: 'logout', label: '退出登录', description: '模拟退出' },
        { id: 'manage', label: '账号终端', description: '模拟账号终端' },
      ],
    }),
  )
  const t = await setup({ accountStatus })
  await t.click('Kimi 设置')
  expect(visibleText(accountSummary(t.r))).toContain('已登录')
  await t.click('账号')
  expect(t.r.root.findByProps({ role: 'dialog', 'aria-label': 'Kimi · 账号' })).toBeTruthy()
  expect(t.text()).toContain('在原生终端中选择服务商并登录。')
  await t.click('添加账号')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('kimi', 'login')
  expect(terminal.started).not.toHaveBeenCalledWith('kimi', 'logout')
  expect(t.configure).not.toHaveBeenCalled()
})
it.each([
  { state: 'authenticated', authMethod: 'api', verification: 'local', label: 'API 登录' },
  { state: 'configured', authMethod: 'api', verification: 'cli', label: '已配置 API' },
  { state: 'unconfigured', authMethod: undefined, verification: 'local', label: '未登录' },
] as const)(
  'shows only the short $label state without repeating Host summary or static protocol notes',
  async ({ state, authMethod, verification, label }) => {
    const t = await setup({
      accountStatus: accountFixture({
        state,
        authMethod,
        verification,
        summary: state === 'configured' ? '已配置 API' : '模拟：Host 账号说明；未进行远程验证；本地凭据不代表登录有效',
      }),
      catalogForCli: vi.fn(async (_parent, cli: CliId) =>
        remote({
          cli,
          models: [{ id: `${cli}-fixture`, efforts: ['default'] }],
          notice: '模拟：CLI 协议适配静态备注',
        }),
      ),
    })
    expect(visibleText(accountSummary(t.r))).toContain(label)
    expect(accountSummary(t.r).findAllByProps({ className: 'cwn-account-detail' })).toHaveLength(0)
    expect(t.text()).not.toMatch(
      /模拟：Host 账号说明|未进行远程验证|本地凭据不代表|模拟：CLI 协议适配静态备注/,
    )
    expect(t.button('默认模型')).toBeDefined()
    expect(t.button('默认思考强度')).toBeDefined()
  },
)
it.each([
  { state: 'unauthenticated', summary: '登录已过期，请重新登录' },
  { state: 'unavailable', summary: 'CLI 路径无效，请重新安装' },
] as const)('preserves the actionable $state reason in the account row', async ({ state, summary }) => {
  const t = await setup({ accountStatus: accountFixture({ state, summary }) })
  expect(visibleText(accountSummary(t.r))).toContain(summary)
  expect(accountSummary(t.r).findAllByProps({ className: 'cwn-account-detail' })).toHaveLength(0)
  expect(accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe(
    'failed',
  )
})
it('preserves the last confirmed account while refreshing and replaces it after an account failure', async () => {
  const accountStatus = accountFixture({
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'cli',
    accountLabel: 'stale-fixture@example.invalid',
    summary: '模拟：已登录',
  })
  const t = await setup({ accountStatus })
  const before = accountSummary(t.r)
  expect(visibleText(before)).toContain('stale-fixture@example.invalid')
  const refresh = deferred()
  accountStatus.mockImplementation((_parent, cli: CliId) =>
    cli === 'antigravity' ? refresh.promise : Promise.resolve(status(cli)),
  )
  await t.click('刷新状态')
  expect(accountSummary(t.r)).toBe(before)
  expect(visibleText(accountSummary(t.r))).toContain('stale-fixture@example.invalid')
  expect(visibleText(accountSummary(t.r))).toContain('已登录')
  expect(accountSummary(t.r).findByProps({ className: 'cwn-account-status-dot' }).props['data-state']).toBe(
    'connected',
  )
  expect(t.button('Antigravity 设置').findAllByProps({ 'data-loading': true })).toHaveLength(0)
  expect(t.button('刷新状态').props.disabled).toBe(true)
  expect(t.button('默认模型').props.disabled).toBe(true)
  await act(async () => refresh.reject(new Error('模拟：账号状态刷新失败')))
  expect(accountSummary(t.r)).toBe(before)
  expect(visibleText(accountSummary(t.r))).toContain('模拟：账号状态刷新失败')
  expect(visibleText(accountSummary(t.r))).not.toContain('stale-fixture@example.invalid')
  expect(visibleText(accountSummary(t.r))).not.toContain('已登录')
  expect(accountSummary(t.r).findAllByProps({ 'data-state': 'connected' })).toHaveLength(0)
})
it('keeps the same summary region after disabling a CLI while removing the previous authenticated identity', async () => {
  const t = await setup({
    accountStatus: accountFixture({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'cli',
      accountLabel: 'disabled-fixture@example.invalid',
      summary: '模拟：已登录',
    }),
  })
  const before = accountSummary(t.r)
  await t.click('启用 Antigravity')
  expect(accountSummary(t.r)).toBe(before)
  expect(visibleText(accountSummary(t.r))).not.toContain('disabled-fixture@example.invalid')
  expect(visibleText(accountSummary(t.r))).not.toContain('已登录')
  expect(accountSummary(t.r).findAllByProps({ 'data-state': 'connected' })).toHaveLength(0)
  expect(t.button('登录 / 切换账号').props.disabled).toBe(true)
})

it.each(['pi', 'omp', 'opencode', 'hermes'] as const)(
  '%s opens a terminal login without native settings or redundant notes',
  async (cli) => {
    const actions: AccountStatus['actions'] = [
      { id: 'login', label: '登录设置', description: '模拟：原生登录' },
      { id: 'manage', label: '账号终端', description: '模拟：原生终端' },
    ]
    const openNativeSettings = vi.fn()
    const t = await setup(
      { accountStatus: vi.fn(async (_parent, current: CliId) => status(current, { actions })) },
      openNativeSettings,
    )
    await t.click(`${CLI_LABELS[cli]} 设置`)
    expect(t.button('登录账号').props.disabled).toBe(false)
    expect(t.text()).not.toContain('在原生设置中选择')
    await t.click('登录账号')
    expect(t.text()).toContain(`尚未登录 ${CLI_LABELS[cli]} 的任何账号。`)
    await t.click('添加账号')
    expect(terminal.started).toHaveBeenCalledExactlyOnceWith(cli, 'login')
    expect(openNativeSettings).not.toHaveBeenCalled()
  },
)
it('offers Hermes instead of the removed Harness account settings', async () => {
  const t = await setup()
  expect(t.button('Hermes Agent 设置')).toBeDefined()
  expect(t.button('Harness 设置')).toBeUndefined()
  expect(t.button('Harness（已移除） 设置')).toBeUndefined()
  expect(t.accountStatus.mock.calls.some((call) => call[1] === 'harness')).toBe(false)
  await t.click('Hermes Agent 设置')
  expect(t.catalogForCli).toHaveBeenCalledWith('simulation-parent', 'hermes', expect.any(AbortSignal))
})

// Explicit synthetic path management: these callbacks never launch or discover a real CLI.
const pathInput = (t: Awaited<ReturnType<typeof setup>>) => t.r.root.findByType('input')
const editPath = async (t: Awaited<ReturnType<typeof setup>>, path: string) => {
  await act(async () => pathInput(t).props.onChange({ target: { value: path } }))
}
const submitPath = async (t: Awaited<ReturnType<typeof setup>>) => {
  await act(async () =>
    t.r.root
      .findByProps({ className: 'cwn-cli-path-settings' })
      .findByType('form')
      .props.onSubmit({ preventDefault() {} }),
  )
}
it.each(CLI_IDS)('keeps %s advanced settings folded separately from project model defaults', async (cli) => {
  const t = await setup({}, undefined, cli)
  const project = t.r.root.findByProps({ 'aria-label': '项目默认设置' })
  const advanced = t.r.root.findByProps({ 'aria-label': '高级设置', className: 'cwn-settings-section' })
  expect(project.findByType('h3').children).toContain('项目默认设置')
  expect(advanced.findByType('h3').children).toContain('高级设置')
  expect(advanced.findByType('h3').props.onClick).toBeUndefined()
  expect(advanced.findByType('h3').findAllByType('button')).toHaveLength(0)
  const arrows = advanced
    .findAllByType('button')
    .filter((button) => button.props['aria-label'] === '高级设置')
  expect(arrows).toHaveLength(1)
  expect(visibleText(arrows[0]!).trim()).toBe('')
  expect(arrows[0]!.props['aria-expanded']).toBe(false)
  expect(project.findAllByProps({ 'aria-label': '高级设置' })).toHaveLength(0)
  expect(t.r.root.findAllByProps({ className: 'cwn-cli-path-settings' })).toHaveLength(0)
  expect(t.cliExecutablePath).not.toHaveBeenCalled()
  await t.click('高级设置')
  expect(t.button('高级设置').props['aria-expanded']).toBe(true)
  expect(advanced.findAllByType('h4')).toHaveLength(0)
  expect(advanced.findAllByType('label')).toHaveLength(1)
  expect(visibleText(advanced.findByType('label').findAllByType('span')[0]!).trim()).toBe('CLI 路径管理')
  expect(advanced.findByType('label').props.htmlFor).toBe(pathInput(t).props.id)
  expect(advanced.findAllByProps({ className: 'cwn-cli-path-source' })).toHaveLength(0)
  expect(pathInput(t).props.value).toBe(`E:\\模拟 CLI\\${cli}.exe`)
  expect(pathInput(t).props['aria-label']).toBe(`${CLI_LABELS[cli]} CLI 路径`)
  expect(t.cliExecutablePath).toHaveBeenCalledExactlyOnceWith(
    'simulation-parent',
    cli,
    expect.any(AbortSignal),
  )
  expect(t.refreshCliExecutablePath).not.toHaveBeenCalled()
  expect(t.configure).not.toHaveBeenCalled()
})
it('saves an edited manual path and refreshes account and models without changing project defaults', async () => {
  const t = await setup()
  await t.click('高级设置')
  const calls = t.accountStatus.mock.calls.length
  const models = t.catalogForCli.mock.calls.length
  const nextPath = 'F:\\自定义 工具\\真实入口\\cli.exe'
  await editPath(t, nextPath)
  await submitPath(t)
  expect(t.refreshCliExecutablePath).toHaveBeenCalledExactlyOnceWith(
    'simulation-parent',
    'antigravity',
    nextPath,
    'manual',
    expect.any(AbortSignal),
  )
  expect(pathInput(t).props.value).toBe(nextPath)
  expect(t.accountStatus.mock.calls.length).toBeGreaterThan(calls)
  expect(t.catalogForCli.mock.calls.length).toBeGreaterThan(models)
  expect(t.r.root.findAllByProps({ className: 'cwn-cli-path-source' })).toHaveLength(0)
  expect(t.configure).not.toHaveBeenCalled()
})
it('revalidates an unchanged detected path without turning it into a manual override', async () => {
  const t = await setup()
  await t.click('高级设置')
  await submitPath(t)
  expect(t.refreshCliExecutablePath).toHaveBeenCalledWith(
    'simulation-parent',
    'antigravity',
    'E:\\模拟 CLI\\antigravity.exe',
    'refresh',
    expect.any(AbortSignal),
  )
  expect(t.r.root.findAllByProps({ className: 'cwn-cli-path-source' })).toHaveLength(0)
  expect(t.configure).not.toHaveBeenCalled()
})
it('retains a rejected path draft and allows correction without refreshing an unchanged account', async () => {
  const refreshCliExecutablePath = vi.fn().mockRejectedValue(new Error('模拟：请输入完整的 CLI 路径'))
  const t = await setup({ refreshCliExecutablePath })
  await t.click('高级设置')
  const calls = t.accountStatus.mock.calls.length
  await editPath(t, 'synthetic invalid path')
  await submitPath(t)
  expect(pathInput(t).props.value).toBe('synthetic invalid path')
  expect(t.text()).toContain('模拟：请输入完整的 CLI 路径')
  expect(t.accountStatus).toHaveBeenCalledTimes(calls)
  expect(t.button('刷新 CLI 路径').props.disabled).toBe(false)
  expect(t.configure).not.toHaveBeenCalled()
})
it('retains a saved but unavailable manual path and invalidates the previous account and models', async () => {
  let current = {
    cli: 'antigravity',
    path: 'E:\\模拟 CLI\\old.exe',
    source: 'auto',
    available: true,
    error: '',
  }
  const cliExecutablePath = vi.fn(async () => remote(current))
  const refreshCliExecutablePath = vi.fn(async (_session, cli: CliId, path: string) => {
    current = { cli, path, source: 'manual', available: false, error: '模拟：此路径未找到 CLI' }
    return remote(current)
  })
  const t = await setup({ cliExecutablePath, refreshCliExecutablePath })
  await t.click('高级设置')
  const calls = t.accountStatus.mock.calls.length
  const models = t.catalogForCli.mock.calls.length
  await editPath(t, 'F:\\不存在的工具\\cli.exe')
  await submitPath(t)
  expect(pathInput(t).props.value).toBe('F:\\不存在的工具\\cli.exe')
  expect(t.text()).toContain('模拟：此路径未找到 CLI')
  expect(t.r.root.findAllByProps({ className: 'cwn-cli-path-source' })).toHaveLength(0)
  expect(t.accountStatus.mock.calls.length).toBeGreaterThan(calls)
  expect(t.catalogForCli.mock.calls.length).toBeGreaterThan(models)
  expect(t.configure).not.toHaveBeenCalled()
})
it('restores automatic discovery through the explicit reset button', async () => {
  const t = await setup()
  await t.click('高级设置')
  await editPath(t, 'F:\\手动指定\\cli.exe')
  await submitPath(t)
  await t.click('恢复自动识别')
  expect(t.refreshCliExecutablePath).toHaveBeenLastCalledWith(
    'simulation-parent',
    'antigravity',
    'F:\\手动指定\\cli.exe',
    'auto',
    expect.any(AbortSignal),
  )
  expect(pathInput(t).props.value).toBe('E:\\模拟 CLI\\antigravity.exe')
  expect(t.text()).toContain('已恢复自动识别')
  expect(t.configure).not.toHaveBeenCalled()
})
it('clears the previous manual path when automatic discovery completes without an available CLI', async () => {
  let current = {
    cli: 'antigravity',
    path: 'F:\\已卸载\\cli.exe',
    source: 'manual',
    available: false,
    error: '',
  }
  const cliExecutablePath = vi.fn(async () => remote(current))
  const refreshCliExecutablePath = vi.fn(async () => {
    current = { ...current, path: '', source: 'none', error: '模拟：未找到可用 CLI' }
    return remote(current)
  })
  const t = await setup({ cliExecutablePath, refreshCliExecutablePath })
  await t.click('高级设置')
  await t.click('恢复自动识别')
  expect(pathInput(t).props.value).toBe('')
  expect(t.text()).toContain('模拟：未找到可用 CLI')
})
it('keeps path management available for a disabled CLI without starting account or model probes', async () => {
  const cliSettings = vi.fn(async () =>
    remote({ enabled: Object.fromEntries(CLI_IDS.map((cli) => [cli, false])) }),
  )
  const t = await setup({ cliSettings }, undefined, 'opencode')
  await t.click('高级设置')
  expect(pathInput(t).props.disabled).toBe(false)
  expect(t.button('刷新 CLI 路径').props.disabled).toBe(false)
  await editPath(t, 'F:\\OpenCode CLI\\opencode.exe')
  await submitPath(t)
  expect(t.refreshCliExecutablePath).toHaveBeenCalledOnce()
  expect(t.accountStatus).not.toHaveBeenCalled()
  expect(t.catalogForCli).not.toHaveBeenCalled()
  expect(t.configure).not.toHaveBeenCalled()
})
it('disables path mutation while an account terminal is active', async () => {
  const t = await setup({
    accountStatus: vi.fn(async (_parent, cli: CliId) => status(cli, { actions: accountActions })),
  })
  await t.click('高级设置')
  await t.click('登录 / 切换账号')
  expect(pathInput(t).props.disabled).toBe(true)
  expect(t.button('刷新 CLI 路径').props.disabled).toBe(true)
  expect(t.button('恢复自动识别').props.disabled).toBe(true)
  expect(t.refreshCliExecutablePath).not.toHaveBeenCalled()
  await t.click('关闭模拟账号操作')
  expect(pathInput(t).props.disabled).toBe(false)
})
it('does not allow login or model preference writes during a path mutation', async () => {
  const pending = deferred()
  const refreshCliExecutablePath = vi.fn(() => pending.promise)
  const t = await setup({
    refreshCliExecutablePath,
    accountStatus: vi.fn(async (_parent, cli: CliId) => status(cli, { actions: accountActions })),
  })
  await t.click('高级设置')
  await editPath(t, 'F:\\CLI\\entry.exe')
  await submitPath(t)
  expect(t.button('登录 / 切换账号').props.disabled).toBe(true)
  expect(t.button('默认模型').props.disabled).toBe(true)
  expect(pathInput(t).props.disabled).toBe(true)
  await act(async () =>
    pending.resolve(
      remote({ cli: 'antigravity', path: 'F:\\CLI\\entry.exe', source: 'manual', available: true }),
    ),
  )
  expect(t.button('登录 / 切换账号').props.disabled).toBe(false)
})
it('does not overwrite newly typed input with a late automatic path read', async () => {
  const pending = deferred(),
    cliExecutablePath = vi.fn(() => pending.promise)
  const t = await setup({ cliExecutablePath })
  await t.click('高级设置')
  expect(pathInput(t).props.disabled).toBe(false)
  await editPath(t, 'F:\\刚输入的路径\\cli.exe')
  await act(async () =>
    pending.resolve(
      remote({ cli: 'antigravity', path: 'E:\\旧检测\\cli.exe', source: 'auto', available: true }),
    ),
  )
  expect(pathInput(t).props.value).toBe('F:\\刚输入的路径\\cli.exe')
  expect(t.refreshCliExecutablePath).not.toHaveBeenCalled()
})
it('keeps a dirty path draft when a later account check refreshes automatic discovery', async () => {
  const t = await setup()
  await t.click('高级设置')
  await editPath(t, 'F:\\未保存的输入\\cli.exe')
  await t.click('刷新状态')
  expect(t.cliExecutablePath).toHaveBeenCalledTimes(2)
  expect(pathInput(t).props.value).toBe('F:\\未保存的输入\\cli.exe')
  expect(t.refreshCliExecutablePath).not.toHaveBeenCalled()
})
it.each(['Kimi 设置', '关闭设置'])('cancels path reads on %s and ignores late results', async (leave) => {
  const pending = deferred(),
    cliExecutablePath = vi.fn((_session, _cli, _signal) => pending.promise)
  const t = await setup({ cliExecutablePath })
  await t.click('高级设置')
  const signal = cliExecutablePath.mock.calls[0]![2]
  await t.click(leave)
  expect(signal.aborted).toBe(true)
  await act(async () =>
    pending.resolve(
      remote({ cli: 'antigravity', path: 'E:\\迟到的旧 CLI.exe', source: 'auto', available: true }),
    ),
  )
  expect(t.text()).not.toContain('迟到的旧 CLI')
})
it.each(['Kimi 设置', '关闭设置'])(
  'cancels path writes on %s and does not refresh accounts from a late completion',
  async (leave) => {
    const pending = deferred()
    const refreshCliExecutablePath = vi.fn((_session, _cli, _path, _action, _signal) => pending.promise)
    const t = await setup({ refreshCliExecutablePath })
    await t.click('高级设置')
    await editPath(t, 'F:\\正在保存\\cli.exe')
    await submitPath(t)
    const signal = refreshCliExecutablePath.mock.calls[0]![4]
    const calls = t.accountStatus.mock.calls.length
    await t.click(leave)
    expect(signal.aborted).toBe(true)
    await act(async () =>
      pending.resolve(
        remote({ cli: 'antigravity', path: 'F:\\正在保存\\cli.exe', source: 'manual', available: true }),
      ),
    )
    expect(t.accountStatus).toHaveBeenCalledTimes(calls)
    expect(t.text()).not.toContain('正在保存')
  },
)
it('aborts a folded path read and performs a fresh read when expanded again', async () => {
  const pending = deferred()
  const cliExecutablePath = vi
    .fn((_session, cli: CliId, _signal) =>
      Promise.resolve(remote({ cli, path: 'E:\\新检测\\cli.exe', source: 'auto', available: true })),
    )
    .mockImplementationOnce(() => pending.promise)
  const t = await setup({ cliExecutablePath })
  await t.click('高级设置')
  const signal = cliExecutablePath.mock.calls[0]![2]
  await t.click('高级设置')
  expect(signal.aborted).toBe(true)
  await t.click('高级设置')
  expect(pathInput(t).props.value).toBe('E:\\新检测\\cli.exe')
  await act(async () =>
    pending.resolve(
      remote({ cli: 'antigravity', path: 'E:\\旧检测\\cli.exe', source: 'auto', available: true }),
    ),
  )
  expect(pathInput(t).props.value).toBe('E:\\新检测\\cli.exe')
})
it('clears the previous green account and model choices while validating a newly saved CLI path', async () => {
  const accountStatus = vi.fn(async (_session, cli: CliId) =>
    status(cli, {
      state: 'authenticated',
      authMethod: 'oauth',
      accountLabel: 'old-path@example.invalid',
    }),
  )
  const t = await setup({ accountStatus })
  await t.click('高级设置')
  expect(visibleText(accountSummary(t.r))).toContain('old-path@example.invalid')
  const pending = deferred()
  accountStatus.mockImplementation((_session, cli: CliId) =>
    cli === 'antigravity' ? pending.promise : Promise.resolve(status(cli)),
  )
  await editPath(t, 'F:\\不同安装\\cli.exe')
  await submitPath(t)
  expect(visibleText(accountSummary(t.r))).not.toContain('old-path@example.invalid')
  expect(visibleText(accountSummary(t.r))).not.toContain('已登录')
  expect(t.button('Antigravity 设置').findByProps({ role: 'img' }).props['aria-label']).toBe('正在检查连接')
  expect(t.button('默认模型').props.disabled).toBe(true)
  await act(async () =>
    pending.resolve(
      status('antigravity', {
        installed: false,
        state: 'unavailable',
        summary: '模拟：新路径不可用',
      }),
    ),
  )
  expect(visibleText(accountSummary(t.r))).toContain('模拟：新路径不可用')
  expect(t.configure).not.toHaveBeenCalled()
})

it('does not write model defaults on initialization, capability refresh, or CLI navigation and has no save button', async () => {
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) =>
      remote({
        cli,
        models: [{ id: `${cli}-saved`, efforts: ['low', 'high'] }],
        preference: { cli, model: `${cli}-saved`, effort: 'high' },
      }),
    ),
  })
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  expect(t.button('保存默认值')).toBeUndefined()
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('刷新模型')
  await t.click('Codex 设置')
  await t.click('Antigravity 设置')
  expect(t.configure).not.toHaveBeenCalled()
  expect(t.button('保存默认值')).toBeUndefined()
})

it('coalesces explicit reselection and never submits unchanged defaults from the form', async () => {
  const t = await setup({
    catalogForCli: vi.fn(async (_parent, cli: CliId) => remote({ cli,
      models: [{ id: `${cli}-saved`, label: 'Saved model', efforts: ['low', 'high'] }],
      preference: { cli, model: `${cli}-saved`, effort: 'high' },
    })),
  })
  const preventDefault = vi.fn()
  await act(async () => t.r.root.findByProps({ className: 'cwn-settings-form' }).props.onSubmit({ preventDefault }))
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(t.configure).not.toHaveBeenCalled()
  await t.chooseModel('Saved model'); await t.chooseEffort('High')
  expect(t.configure).not.toHaveBeenCalled()
  await t.click('智能体设置')
  expect(t.configure).toHaveBeenCalledOnce()
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({ cli: 'antigravity', model: 'antigravity-saved', effort: 'high' })
})

it('shows selections immediately and saves only the final supported model-effort pair on departure', async () => {
  const t = await setup({ catalogForCli: vi.fn(async (_parent, cli: CliId) => remote({ cli, models: [
    { id: 'source/alpha', label: 'Alpha', efforts: ['low', 'high'] },
    { id: 'source/beta', label: 'Beta', efforts: ['medium'] },
  ] })) })
  await t.chooseEffort('High'); await t.chooseModel('Beta')
  expect(t.configure).not.toHaveBeenCalled()
  expect(visibleText(t.button('默认模型')).trim()).toBe('Beta')
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Medium')
  expect(t.text()).not.toContain('正在保存默认设置')
  await t.click('Codex 设置')
  expect(t.configure).toHaveBeenCalledOnce()
  expect(JSON.parse(t.configure.mock.calls[0]![1])).toEqual({ cli: 'antigravity', model: 'source/beta', effort: 'medium' })
})

it('does not flush a new on-page draft when an earlier background write completes', async () => {
  const first = deferred(), latest = deferred()
  const configure = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
  const t = await setup({ configure, catalogForCli: vi.fn(async (_parent, cli: CliId) => remote({ cli, models: [
    { id: 'source/alpha', label: 'Alpha', efforts: ['low', 'high'] },
    { id: 'source/beta', label: 'Beta', efforts: ['high', 'medium'] },
  ] })) })
  await t.chooseEffort('High'); await t.click('Kimi 设置')
  expect(configure).toHaveBeenCalledOnce()
  await t.click('Antigravity 设置')
  expect(t.button('默认模型').props.disabled).toBe(false)
  await t.chooseModel('Beta'); await t.chooseEffort('Medium')
  expect(configure).toHaveBeenCalledOnce()
  expect(configure.mock.calls[0]![2].aborted).toBe(false)
  await act(async () => first.resolve(remote({})))
  expect(configure).toHaveBeenCalledOnce()
  expect(visibleText(t.button('默认模型')).trim()).toBe('Beta')
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Medium')
  expect(t.text()).not.toContain('默认设置已保存')
  await t.click('Kimi 设置')
  expect(configure).toHaveBeenCalledTimes(2)
  expect(JSON.parse(configure.mock.calls[1]![1])).toEqual({ cli: 'antigravity', model: 'source/beta', effort: 'medium' })
  await act(async () => latest.resolve(remote({})))
  await t.click('Antigravity 设置')
  expect(t.text()).not.toContain('默认设置已保存')
  expect(t.text()).not.toContain('正在保存默认设置')
  expect(visibleText(t.button('默认模型')).trim()).toBe('Beta')
})

it.each(['legacy', 'warm'] as const)('retains a failed %s background selection and retries only on a later departure', async mode => {
  const configure = vi.fn().mockRejectedValueOnce(new Error('模拟：后台保存失败')).mockResolvedValue(remote({}))
  const t = mode === 'warm' ? await setupWarm({ configure }, ['antigravity'], 'antigravity') : await setup({ configure })
  await t.chooseEffort('High')
  expect(configure).not.toHaveBeenCalled()
  await t.click('关闭设置')
  expect(configure).toHaveBeenCalledOnce()
  await t.open()
  expect(configure).toHaveBeenCalledOnce()
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  expect(t.text()).toContain('模拟：后台保存失败')
  expect(t.text()).not.toContain('默认设置已保存')
  await t.click('智能体设置')
  expect(configure).toHaveBeenCalledTimes(2)
  expect(JSON.parse(configure.mock.calls[1]![1])).toEqual({ cli: 'antigravity', model: 'antigravity-fixture', effort: 'high' })
})

it.each(['Kimi 设置', '智能体设置', '关闭设置'])(
  'flushes on %s without waiting for the background write or aborting it', async leave => {
    const pending = deferred(), configure = vi.fn().mockReturnValue(pending.promise)
    const t = await setup({ configure })
    await t.chooseEffort('High'); await t.chooseEffort('Low')
    expect(configure).not.toHaveBeenCalled()
    await t.click(leave)
    expect(configure).toHaveBeenCalledOnce()
    expect(JSON.parse(configure.mock.calls[0]![1]).effort).toBe('low')
    expect(configure.mock.calls[0]![2].aborted).toBe(false)
    if (leave === '关闭设置') expect(t.r.toJSON()).toBe(null)
    else if (leave === 'Kimi 设置') expect(t.text()).toContain('kimi-fixture')
    else expect(t.button('智能体设置').props['aria-pressed']).toBe(true)
    await act(async () => pending.resolve(remote({})))
    expect(configure).toHaveBeenCalledOnce()
  },
)

it.each(['legacy', 'warm'] as const)('serializes %s writes across rapid close/reopen and preserves the newest draft', async mode => {
  const first = deferred(), latest = deferred()
  const configure = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
  const t = mode === 'warm' ? await setupWarm({ configure }, ['antigravity'], 'antigravity') : await setup({ configure })
  await t.chooseEffort('High'); await t.click('关闭设置')
  await t.open()
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  expect(configure.mock.calls[0]![2].aborted).toBe(false)
  await t.chooseEffort('Low'); await t.click('关闭设置')
  expect(configure).toHaveBeenCalledOnce()
  await act(async () => first.resolve(remote({})))
  expect(configure).toHaveBeenCalledTimes(2)
  expect(JSON.parse(configure.mock.calls[1]![1]).effort).toBe('low')
  await t.open()
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Low')
  await act(async () => latest.resolve(remote({})))
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Low')
  expect(t.text()).not.toContain('默认设置已保存')
  expect(t.text()).not.toContain('正在保存默认设置')
})

it('does not save on same-page navigation and flushes explicit changes on external unmount', async () => {
  const t = await setupWarm({}, ['codex'])
  await t.chooseEffort('High'); await t.click('Codex 设置')
  expect(t.savedPreference).not.toHaveBeenCalled()
  await act(async () => t.r.unmount())
  expect(t.savedPreference).toHaveBeenCalledOnce()
  expect(JSON.parse(t.savedPreference.mock.calls[0]![1]).effort).toBe('high')
})

it('rechecks missing catalog binding proof without cancelling an already submitted preference', async () => {
  const first = deferred(), configure = vi.fn().mockReturnValue(first.promise)
  const t = await setupWarm({ configure }, ['codex'])
  await t.chooseEffort('High'); await t.click('关闭设置')
  t.metadata.catalogReady.codex = false
  await t.open()
  expect(configure.mock.calls[0]![2].aborted).toBe(false)
  expect(t.catalogForCli).toHaveBeenCalledTimes(2)
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  await act(async () => first.resolve(remote({ cli: 'codex', model: 'codex-fixture', effort: 'high' })))
  expect(t.text()).not.toContain('默认设置已保存')
  expect(t.text()).not.toContain('正在保存默认设置')
})

it('keeps a new save receipt when an older settings read arrives late, then accepts a later fresh snapshot', async () => {
  const write = deferred(), read = deferred(), configure = vi.fn().mockReturnValue(write.promise)
  const t = await setupWarm({ configure }, ['codex'])
  await t.chooseEffort('High'); await t.click('关闭设置')
  const stale = remote({ enabled: t.enabled, settingsCache: structuredClone(t.metadata) })
  t.settingsRead.mockReturnValueOnce(read.promise)
  await t.open()
  t.metadata.preferences.codex = { cli: 'codex', model: 'codex-fixture', effort: 'high' }
  await act(async () => write.resolve(remote(t.metadata.preferences.codex)))
  await act(async () => read.resolve(stale))
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('High')
  expect(configure).toHaveBeenCalledOnce()
  await t.click('关闭设置')
  t.metadata.preferences.codex.effort = 'low'
  await t.open()
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Low')
  expect(configure).toHaveBeenCalledOnce()
})

it.each(['刷新状态', '刷新模型'])('discards an unsubmitted choice on explicit %s instead of saving the old model scope', async refresh => {
  const t = await setupWarm({}, ['codex'])
  await t.chooseEffort('High'); await t.click(refresh); await t.click('关闭设置')
  expect(t.savedPreference).not.toHaveBeenCalled()
})

it('cancels old-source background writes and ignores their late result after a source revision changes', async () => {
  const first = deferred(), configure = vi.fn().mockReturnValue(first.promise)
  const t = await setupWarm({ configure }, ['codex'])
  await t.chooseEffort('High'); await t.click('关闭设置')
  t.metadata.revisions.codex = 'SIMULATED-new-source'
  await t.open()
  expect(configure.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => first.resolve(remote({ cli: 'codex', model: 'codex-fixture', effort: 'high' })))
  expect(visibleText(t.button('默认思考强度')).trim()).toBe('Low')
  expect(t.text()).not.toContain('默认设置已保存')
})

it('toggles advanced content only through its separate arrow and preserves hidden content for collapse animation', async () => {
  const t = await setup()
  const advanced = t.r.root.findByProps({ 'aria-label': '高级设置', className: 'cwn-settings-section' })
  const heading = advanced.findByType('h3')
  expect(visibleText(heading)).toBe('高级设置')
  expect(heading.props.onClick).toBeUndefined()
  expect(heading.findAllByType('button')).toHaveLength(0)
  expect(visibleText(t.button('高级设置'))).toBe('')
  await t.click('高级设置')
  const content = t.r.root.findByProps({ className: 'cwn-cli-path-settings' })
  expect(content.findAllByType('label')).toHaveLength(1)
  expect(visibleText(content.findByType('label').findAllByType('span')[0]!).trim()).toBe('CLI 路径管理')
  expect(content.findByType('label').props.htmlFor).toBe(pathInput(t).props.id)
  expect(content.findAllByType('h4')).toHaveLength(0)
  expect(content.findAllByProps({ className: 'cwn-cli-path-source' })).toHaveLength(0)
  await t.click('高级设置')
  expect(t.button('高级设置').props['aria-expanded']).toBe(false)
  expect(t.r.root.findByProps({ className: 'cwn-cli-path-settings' })).toBe(content)
  const hidden = advanced.findAll(
    (node) => typeof node.type === 'string' && node.props['aria-hidden'] === true,
  )
  expect(hidden.some((node) => node.props.inert !== undefined)).toBe(true)
  await t.click('高级设置')
  expect(t.button('高级设置').props['aria-expanded']).toBe(true)
  expect(t.configure).not.toHaveBeenCalled()
})

it.each(['pi', 'omp', 'codex'] as const)(
  'reads %s running message defaults only after expanding, without saving',
  async (cli) => {
    const t = await setup({}, undefined, cli)
    expect(t.runningMessageSettings).not.toHaveBeenCalled()
    await t.click('高级设置')
    expect(t.runningMessageSettings).toHaveBeenCalledExactlyOnceWith(
      'simulation-parent',
      cli,
      expect.any(AbortSignal),
    )
    expect(visibleText(t.button('运行中发送'))).toContain(cli === 'codex' ? '排队' : '引导')
    await t.click('运行中发送')
    expect(t.button('引导').props.disabled).toBe(cli === 'codex')
    expect(t.button('插队').props.disabled).not.toBe(true)
    expect(t.button('排队').props.disabled).not.toBe(true)
    if (cli === 'codex') await t.click('引导')
    expect(t.saveRunningMessageMode).not.toHaveBeenCalled()
    expect(t.configure).not.toHaveBeenCalled()
  },
)

it('saves running message choice automatically and does not refresh account or model directories', async () => {
  const t = await setup({}, undefined, 'pi')
  await t.click('高级设置')
  const reads = t.accountStatus.mock.calls.length
  const models = t.catalogForCli.mock.calls.length
  const paths = t.cliExecutablePath.mock.calls.length
  await t.click('运行中发送')
  await t.click('插队')
  expect(t.saveRunningMessageMode).toHaveBeenCalledExactlyOnceWith(
    'simulation-parent',
    'pi',
    'interrupt',
    expect.any(AbortSignal),
  )
  expect(visibleText(t.button('运行中发送'))).toContain('插队')
  expect(t.text()).not.toContain('发送方式已保存')
  expect(t.text()).not.toContain('正在保存发送方式')
  expect(t.text()).toContain('先停止当前轮')
  expect(t.accountStatus).toHaveBeenCalledTimes(reads)
  expect(t.catalogForCli).toHaveBeenCalledTimes(models)
  expect(t.cliExecutablePath).toHaveBeenCalledTimes(paths)
  expect(t.configure).not.toHaveBeenCalled()
})

it('retains a failed mode selection with its error and retries the same choice', async () => {
  const saveRunningMessageMode = vi
    .fn()
    .mockRejectedValueOnce(new Error('模拟发送方式保存失败'))
    .mockResolvedValue(remote({ cli: 'pi', mode: 'interrupt', canSteer: true }))
  const t = await setup({ saveRunningMessageMode }, undefined, 'pi')
  await t.click('高级设置')
  await t.click('运行中发送')
  await t.click('插队')
  expect(visibleText(t.button('运行中发送'))).toContain('插队')
  expect(t.text()).toContain('模拟发送方式保存失败')
  expect(t.text()).not.toContain('发送方式已保存')
  await t.click('高级设置')
  await t.click('高级设置')
  expect(visibleText(t.button('运行中发送'))).toContain('插队')
  expect(t.text()).toContain('模拟发送方式保存失败')
  await t.click('运行中发送')
  await t.click('插队')
  expect(saveRunningMessageMode).toHaveBeenCalledTimes(2)
  expect(t.text()).not.toContain('发送方式已保存')
  expect(t.text()).not.toContain('正在保存发送方式')
})

it('does not invent a default after a failed mode read and allows retry', async () => {
  const runningMessageSettings = vi
    .fn()
    .mockRejectedValueOnce(new Error('模拟发送方式读取失败'))
    .mockResolvedValue(remote({ cli: 'pi', mode: 'queue', canSteer: true }))
  const t = await setup({ runningMessageSettings }, undefined, 'pi')
  await t.click('高级设置')
  expect(t.button('运行中发送').props.disabled).toBe(true)
  expect(visibleText(t.button('运行中发送'))).toContain('选择发送方式')
  expect(t.text()).toContain('模拟发送方式读取失败')
  await t.click('重试读取发送方式')
  expect(visibleText(t.button('运行中发送'))).toContain('排队')
  expect(t.button('运行中发送').props.disabled).toBe(false)
  expect(t.saveRunningMessageMode).not.toHaveBeenCalled()
})

it.each(['read', 'save'] as const)(
  'discards a late running-message %s after switching CLI',
  async (operation) => {
    const pending = deferred()
    const runningMessageSettings = vi.fn((_session, cli: CliId) =>
      operation === 'read' && cli === 'pi'
        ? pending.promise
        : Promise.resolve(remote({ cli, mode: cli === 'pi' ? 'steer' : 'queue', canSteer: cli === 'pi' })),
    )
    const saveRunningMessageMode = vi.fn(() => pending.promise)
    const t = await setup({ runningMessageSettings, saveRunningMessageMode }, undefined, 'pi')
    await t.click('高级设置')
    if (operation === 'save') {
      await t.click('运行中发送')
      await t.click('插队')
    }
    const signal =
      operation === 'read'
        ? runningMessageSettings.mock.calls[0]![2]
        : saveRunningMessageMode.mock.calls[0]![3]
    await t.click('Codex 设置')
    expect(signal.aborted).toBe(true)
    await t.click('高级设置')
    await act(async () => pending.resolve(remote({ cli: 'pi', mode: 'interrupt', canSteer: true })))
    expect(visibleText(t.button('运行中发送'))).toContain('排队')
    expect(t.text()).not.toContain('发送方式已保存')
  },
)

it('opens CLI Worker settings above agents and saves the shared concurrency limit', async () => {
  let current = { maxConcurrent: 2, defaultMaxConcurrent: 2, isolatedParallelWrites: false }
  const generalSettings = vi.fn(async () => remote(current))
  const saveGeneralSettings = vi.fn(async (_session, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const t = await setup({ generalSettings, saveGeneralSettings })
  const labels = t.r.root.findAllByType('nav')[0]!.findAllByType('button').map((b) => b.props['aria-label'])
  expect(labels.indexOf('CLI Worker 设置')).toBeLessThan(labels.indexOf('智能体设置'))
  expect(generalSettings).not.toHaveBeenCalled()
  await t.click('CLI Worker 设置')
  expect(t.button('CLI Worker 设置').props['aria-pressed']).toBe(true)
  expect(t.text()).toContain('最高同时对话数')
  await t.click('最高同时对话数')
  await t.click('4')
  expect(saveGeneralSettings).toHaveBeenCalledWith('simulation-parent', '{"maxConcurrent":4}', expect.any(AbortSignal))
  expect(t.text()).not.toContain('同时对话数已保存')
  expect(t.text()).not.toContain('正在保存同时对话数')
})
// Simulated Gateway settings only: no task, CLI or model is started.
it('shows deployment and current time limits as sorted, deduplicated choices and saves both fields', async () => {
  let current = {
    maxConcurrent: 2, defaultMaxConcurrent: 2,
    taskTimeLimitMs: 2_700_000, defaultTaskTimeLimitMs: 2_700_000, idleTimeLimitMs: 420_000,
  }
  const saveGeneralSettings = vi.fn(async (_session, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const t = await setup({ generalSettings: vi.fn(async () => remote(current)), saveGeneralSettings })
  await t.click('CLI Worker 设置')
  expect(t.r.root.findAllByType('h3').map(visibleText)).toEqual(['语言', '任务调度', '任务时限'])
  expect(visibleText(t.button('总时限')).trim()).toBe('45 分钟（默认）')
  expect(visibleText(t.button('空闲时限')).trim()).toBe('7 分钟')
  await t.click('总时限')
  const menu = t.r.root.findByProps({ role: 'menu' })
  expect(menu.findAllByType('button').map(visibleText)).toEqual([
    '30 分钟', '45 分钟（默认）', '1 小时', '2 小时', '4 小时', '8 小时', '不限制（最长 24 小时）',
  ])
  await t.click('2 小时')
  expect(saveGeneralSettings).toHaveBeenLastCalledWith('simulation-parent', '{"taskTimeLimitMs":7200000}', expect.any(AbortSignal))
  expect(visibleText(t.button('总时限')).trim()).toBe('2 小时')
  await t.click('空闲时限')
  expect(t.r.root.findByProps({ role: 'menu' }).findAllByType('button').map(visibleText)).toEqual([
    '不启用', '5 分钟', '7 分钟', '10 分钟', '30 分钟',
  ])
  await t.click('10 分钟')
  expect(saveGeneralSettings).toHaveBeenLastCalledWith('simulation-parent', '{"idleTimeLimitMs":600000}', expect.any(AbortSignal))
  expect(visibleText(t.button('空闲时限')).trim()).toBe('10 分钟')
  expect(t.text()).not.toContain('正在保存')
  expect(t.text()).not.toContain('已保存')
  expect(t.configure).not.toHaveBeenCalled()
})

it('keeps a custom current total limit and labels a seconds-based deployment default', async () => {
  const t = await setup({ generalSettings: vi.fn(async () => remote({
    maxConcurrent: 2, defaultMaxConcurrent: 2,
    taskTimeLimitMs: 1250, defaultTaskTimeLimitMs: 90_000, idleTimeLimitMs: 0,
  })) })
  await t.click('CLI Worker 设置')
  expect(visibleText(t.button('总时限')).trim()).toBe('2 秒')
  await t.click('总时限')
  expect(t.r.root.findByProps({ role: 'menu' }).findAllByType('button').map(visibleText).slice(0, 3)).toEqual([
    '2 秒', '90 秒（默认）', '30 分钟',
  ])
})

it('shows the older Host time limit defaults without writing settings', async () => {
  const saveGeneralSettings = vi.fn()
  const t = await setup({
    generalSettings: vi.fn(async () => remote({ maxConcurrent: 2, defaultMaxConcurrent: 2 })),
    saveGeneralSettings,
  })
  await t.click('CLI Worker 设置')
  expect(visibleText(t.button('总时限')).trim()).toBe('30 分钟（默认）')
  expect(visibleText(t.button('空闲时限')).trim()).toBe('不启用')
  expect(saveGeneralSettings).not.toHaveBeenCalled()
})

it.each([
  ['总时限', '2 小时', '30 分钟（默认）', '正在保存总时限…', '总时限未保存，请重新选择重试'],
  ['空闲时限', '10 分钟', '不启用', '正在保存空闲时限…', '空闲时限未保存，请重新选择重试'],
])('keeps the previous %s on save failure and allows retrying the same choice', async (label, choice, previous, saving, unsaved) => {
  const pending = deferred()
  const original = { maxConcurrent: 2, defaultMaxConcurrent: 2, taskTimeLimitMs: 1_800_000, defaultTaskTimeLimitMs: 1_800_000, idleTimeLimitMs: 0 }
  const saveGeneralSettings = vi.fn((_session, _raw: string) => pending.promise)
  const t = await setup({ generalSettings: vi.fn(async () => remote(original)), saveGeneralSettings })
  await t.click('CLI Worker 设置')
  await t.click(label)
  await t.click(choice)
  expect(t.text()).toContain(saving)
  expect(t.button(label).props.disabled).toBe(true)
  // The Host answered without applying the choice.
  await act(async () => pending.resolve(remote(original)))
  expect(t.text()).toContain(unsaved)
  expect(visibleText(t.button(label)).trim()).toBe(previous)
  expect(t.button(label).props.disabled).toBe(false)
  saveGeneralSettings.mockImplementation(async (_session, raw: string) => remote({ ...original, ...JSON.parse(raw) }))
  await t.click(label)
  await t.click(choice)
  expect(saveGeneralSettings).toHaveBeenCalledTimes(2)
  expect(visibleText(t.button(label)).trim()).toBe(choice)
  expect(t.text()).not.toContain(unsaved)
})

it.each([
  { taskTimeLimitMs: 999 }, { taskTimeLimitMs: 86_400_001 }, { taskTimeLimitMs: 1000.5 },
  { taskTimeLimitMs: null }, { taskTimeLimitMs: '1800000' },
  { defaultTaskTimeLimitMs: 0 }, { defaultTaskTimeLimitMs: 86_400_001 }, { defaultTaskTimeLimitMs: 1000.5 },
  { defaultTaskTimeLimitMs: null }, { defaultTaskTimeLimitMs: '1800000' },
  { idleTimeLimitMs: -1 }, { idleTimeLimitMs: 59_999 }, { idleTimeLimitMs: 60_000.5 },
  { idleTimeLimitMs: 86_400_001 }, { idleTimeLimitMs: null }, { idleTimeLimitMs: '0' },
])('rejects invalid Host time limits %j and keeps retry in task scheduling', async (invalid) => {
  const t = await setup({ generalSettings: vi.fn(async () => remote({ maxConcurrent: 2, defaultMaxConcurrent: 2, ...invalid })) })
  await t.click('CLI Worker 设置')
  expect(t.text()).toContain('收到无效的通用设置，请重试')
  const scheduling = t.r.root.findByProps({ className: 'cwn-settings-section', 'aria-label': '任务调度' })
  expect(scheduling.findAllByType('button').some(button => button.children.includes('重试读取通用设置'))).toBe(true)
  expect(t.button('总时限').props.disabled).toBe(true)
  expect(t.button('空闲时限').props.disabled).toBe(true)
})

it('switches the whole dialog to English as soon as the language is saved', async () => {
  let current: Record<string, unknown> = { maxConcurrent: 2, defaultMaxConcurrent: 2 }
  const generalSettings = vi.fn(async () => remote(current))
  const saveGeneralSettings = vi.fn(async (_session, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const t = await setup({ generalSettings, saveGeneralSettings })
  await t.click('CLI Worker 设置')
  // An older Host without the field reads as follow; Chinese without a DSH locale.
  expect(visibleText(t.button('界面语言'))).toContain('跟随 DSH')
  await t.click('界面语言')
  await t.click('English')
  expect(saveGeneralSettings).toHaveBeenCalledWith('simulation-parent', '{"language":"en"}', expect.any(AbortSignal))
  expect(t.text()).not.toContain('Interface language saved')
  expect(t.text()).toContain('Maximum concurrent conversations')
  expect(t.text()).toContain('Parallel writes in the same directory')
  expect(t.text()).toContain('Time limits')
  expect(visibleText(t.button('Total time limit')).trim()).toBe('30 min (default)')
  expect(visibleText(t.button('Idle time limit')).trim()).toBe('Off')
  expect(t.button('Agent settings')).toBeDefined()
  expect(t.text()).not.toContain('最高同时对话数')
  expect(t.text()).not.toContain('同目录写任务并行')
  await t.click('Interface language')
  await t.click('中文')
  expect(saveGeneralSettings).toHaveBeenLastCalledWith('simulation-parent', '{"language":"zh"}', expect.any(AbortSignal))
  expect(t.text()).not.toContain('界面语言已保存')
  expect(t.text()).not.toContain('正在保存界面语言')
})
it('rejects an unknown language from the Host and keeps the current interface', async () => {
  const generalSettings = vi.fn(async () => remote({ maxConcurrent: 2, defaultMaxConcurrent: 2, language: 'fr' }))
  const t = await setup({ generalSettings })
  await t.click('CLI Worker 设置')
  expect(t.text()).toContain('收到无效的通用设置，请重试')
  expect(t.button('重试读取通用设置')).toBeDefined()
})
it('explains and saves the same-directory isolated-copy switch, off by default', async () => {
  let current = { maxConcurrent: 2, defaultMaxConcurrent: 2, isolatedParallelWrites: false }
  const saveGeneralSettings = vi.fn(async (_session, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const t = await setup({ generalSettings: vi.fn(async () => remote(current)), saveGeneralSettings })
  await t.click('CLI Worker 设置')
  expect(t.button('同目录写任务并行').props['aria-checked']).toBe(false)
  expect(t.text()).toContain('在项目副本中同时运行，完成后由主 Agent 合并回项目')
  await t.click('同目录写任务并行')
  expect(saveGeneralSettings).toHaveBeenCalledWith(
    'simulation-parent',
    '{"isolatedParallelWrites":true}',
    expect.any(AbortSignal),
  )
  expect(t.button('同目录写任务并行').props['aria-checked']).toBe(true)
  // The switch itself shows the saved state; no extra confirmation line.
  expect(t.text()).not.toContain('已开启')
  expect(t.text()).not.toContain('正在保存同目录写任务并行')
})

// Simulated Gateway only: the switch saves a profile setting and never starts a CLI.
it('shows ask-before-dispatch on for an older Host and saves turning it off without success text', async () => {
  let current: Record<string, unknown> = { maxConcurrent: 2, defaultMaxConcurrent: 2 }
  const saveGeneralSettings = vi.fn(async (_session, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const t = await setup({ generalSettings: vi.fn(async () => remote(current)), saveGeneralSettings })
  await t.click('CLI Worker 设置')
  expect(t.button('调用前询问模型').props['aria-checked']).toBe(true)
  expect(t.text()).toContain('无有效设定时仍会询问')
  await t.click('调用前询问模型')
  expect(saveGeneralSettings).toHaveBeenCalledWith('simulation-parent', '{"askBeforeDispatch":false}', expect.any(AbortSignal))
  expect(t.button('调用前询问模型').props['aria-checked']).toBe(false)
  expect(t.text()).not.toContain('已保存')
  expect(t.text()).not.toContain('正在保存调用前询问模型')
  expect(t.configure).not.toHaveBeenCalled()
})

it('keeps ask-before-dispatch on and shows a short error when saving fails', async () => {
  const saveGeneralSettings = vi.fn().mockResolvedValue({ ok: false, error: { message: '模拟保存失败' } })
  const t = await setup({
    generalSettings: vi.fn(async () => remote({ maxConcurrent: 2, defaultMaxConcurrent: 2, askBeforeDispatch: true })),
    saveGeneralSettings,
  })
  await t.click('CLI Worker 设置')
  await t.click('调用前询问模型')
  expect(t.button('调用前询问模型').props['aria-checked']).toBe(true)
  expect(t.text()).toContain('模拟保存失败')
})

// Account window (simulated statuses): ids are Host handles, never credentials.
const windowActions = (providers: AccountStatus['actions'][number]['providers']): AccountStatus['actions'] => [
  { id: 'login', label: '登录设置', description: '模拟登录', providers },
  { id: 'logout', label: '退出登录', description: '模拟退出' },
  { id: 'manage', label: '账号终端', description: '模拟账号终端' },
]
const pickedStatus = (cli: CliId, logins: AccountStatus['logins'], providers: AccountStatus['actions'][number]['providers']) =>
  vi.fn(async (_parent, id: CliId) =>
    status(id, id === cli ? { state: 'authenticated', authMethod: 'api', logins, actions: windowActions(providers) } : {}),
  )
it('signs out one OpenCode provider only after its own inline confirmation', async () => {
  const t = await setup({
    accountStatus: pickedStatus(
      'opencode',
      [
        { providerLabel: 'DeepSeek', authMethod: 'api', id: 'opencode:deepseek' },
        { providerLabel: 'OpenRouter', authMethod: 'api', id: 'opencode:openrouter' },
      ],
      [{ id: 'deepseek', label: 'DeepSeek', signedIn: true }],
    ),
  })
  await t.click('OpenCode 设置')
  await t.click('账号')
  expect(t.text()).toContain('DeepSeek API 登录')
  expect(t.text()).toContain('OpenRouter API 登录')
  const first = t.r.root.findAllByProps({ className: 'cwn-accounts-card' })[0]!
  await act(async () => first.findAllByType('button').find((item) => item.children.includes('退出'))!.props.onClick())
  expect(terminal.started).not.toHaveBeenCalled()
  await t.click('取消')
  expect(t.button('确认退出')).toBeUndefined()
  await act(async () =>
    t.r.root.findAllByProps({ className: 'cwn-accounts-card' })[0]!.findAllByType('button').find((item) => item.children.includes('退出'))!.props.onClick(),
  )
  await t.click('确认退出')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('opencode', 'logout', { login: 'opencode:deepseek' })
})
it('warns before replacing a signed-in OpenCode provider and keeps the native picker as an option', async () => {
  const t = await setup({
    accountStatus: pickedStatus(
      'opencode',
      [{ providerLabel: 'DeepSeek', authMethod: 'api', id: 'opencode:deepseek' }],
      [
        { id: 'deepseek', label: 'DeepSeek', signedIn: true },
        { id: 'openrouter', label: 'OpenRouter' },
      ],
    ),
  })
  await t.click('OpenCode 设置')
  await t.click('账号')
  await t.click('添加账号')
  expect(t.text()).toContain('DeepSeek 已登录，继续会替换它现有的凭据。')
  await t.click('其他服务商（在原生终端中选择）')
  await t.click('继续')
  expect(terminal.started).toHaveBeenCalledExactlyOnceWith('opencode', 'login')
})
it('lets the user add another Hermes key or replace a chosen one', async () => {
  const providers = [{ id: 'deepseek', label: 'DeepSeek', signedIn: true, multi: true }]
  const logins = [
    { providerLabel: 'DeepSeek', authMethod: 'api' as const, id: 'hermes:deepseek:a1b2c3' },
    { providerLabel: 'DeepSeek', authMethod: 'api' as const, id: 'hermes:deepseek:d4e5f6' },
  ]
  const t = await setup({ accountStatus: pickedStatus('hermes', logins, providers) })
  await t.click('Hermes Agent 设置')
  await t.click('账号')
  await t.click('添加账号')
  expect(t.text()).toContain('添加另一个凭据')
  await t.click('继续')
  expect(terminal.started).toHaveBeenLastCalledWith('hermes', 'login', { provider: 'deepseek' })
  await t.click('关闭模拟账号操作')
  await t.click('添加账号')
  const second = t.r.root.findAllByType('input').filter((input) => input.props.type === 'radio')[2]!
  await act(async () => second.props.onChange())
  expect(t.text()).toContain('新凭据确认可用后，才会移除原凭据。')
  await t.click('继续')
  expect(terminal.started).toHaveBeenLastCalledWith('hermes', 'login', {
    provider: 'deepseek',
    replaces: 'hermes:deepseek:d4e5f6',
  })
})
it('names each OMP account of one provider by its email when replacing one', async () => {
  const providers = [{ id: 'openai-codex', label: 'OpenAI', signedIn: true, multi: true }]
  const logins = [
    { providerLabel: 'OpenAI', authMethod: 'oauth' as const, accountLabel: 'first@example.invalid', id: 'omp:openai-codex:plugin.2', source: 'plugin' as const },
    { providerLabel: 'OpenAI', authMethod: 'oauth' as const, accountLabel: 'second@example.invalid', id: 'omp:openai-codex:plugin.3', source: 'plugin' as const },
  ]
  const t = await setup({ accountStatus: pickedStatus('omp', logins, providers) })
  await t.click('OMP 设置')
  await t.click('账号')
  // Each card shows its own account under the provider.
  expect(t.text()).toContain('账号登录 · first@example.invalid')
  await t.click('添加账号')
  expect(t.text()).toContain('替换 first@example.invalid')
  expect(t.text()).toContain('替换 second@example.invalid')
})

it('explains a Codex relay route catalog the way it does a Claude route', async () => {
  // Simulated relay catalog notice from the Host; no real relay.
  const notice = 'Codex 自定义路由模型；来自 Codex 自带列表，中转是否支持以实际调用为准'
  const relay = vi.fn(async (_session, cli: CliId) =>
    cli === 'codex' ? remote({ cli, models: [{ id: 'codex-fixture', efforts: ['low'] }], notice }) : catalog(cli),
  )
  const t = await setup({ catalogForCli: relay, refreshCatalogForCli: relay }, undefined, 'codex')
  await vi.waitFor(() => expect(t.text()).toContain(notice))
})

it('releases a CLI paused after an unconfirmed cleanup only after the inline confirmation', async () => {
  // Simulated Host pause and release; no native process is inspected or stopped.
  let paused = true
  const summary = 'Antigravity 元数据进程清理尚未确认，已暂停此 CLI：isJobEmpty failed for <path>'
  const accountStatus = vi.fn(async (_session, cli: CliId) =>
    cli === 'antigravity' && paused
      ? status(cli, { state: 'unavailable', summary, cleanupBlocked: true })
      : status(cli, { state: 'authenticated', summary: '已登录', actions: accountActions }),
  )
  const recoverCliCleanup = vi.fn(async (_session, cli: CliId) => {
    paused = false
    return remote({ cli, recovered: true })
  })
  const t = await setup({ accountStatus, recoverCliCleanup })
  await vi.waitFor(() => expect(t.text()).toContain('isJobEmpty failed for <path>'))
  expect(t.button('账号终端')).toBeUndefined()
  await t.click('解除暂停')
  expect(t.text()).toContain('活动监视器')
  expect(recoverCliCleanup).not.toHaveBeenCalled()
  await t.click('取消')
  expect(t.text()).not.toContain('活动监视器')
  const reads = accountStatus.mock.calls.filter((call) => call[1] === 'antigravity').length
  await t.click('解除暂停')
  await t.click('确认解除')
  expect(recoverCliCleanup).toHaveBeenCalledExactlyOnceWith('simulation-parent', 'antigravity', expect.any(AbortSignal))
  await vi.waitFor(() =>
    expect(accountStatus.mock.calls.filter((call) => call[1] === 'antigravity').length).toBeGreaterThan(reads),
  )
  await vi.waitFor(() => expect(t.text()).not.toContain('解除暂停'))
})

it('keeps the pause and shows why when the Host refuses to release it', async () => {
  const accountStatus = vi.fn(async (_session, cli: CliId) =>
    status(cli, { state: 'unavailable', summary: '账号查询未能确认进程已退出，已暂停此 CLI', cleanupBlocked: true }),
  )
  const recoverCliCleanup = vi.fn(async () => ({
    ok: false,
    error: { message: '此 CLI 还有运行或排队中的任务，请等待结束后再解除暂停' },
  }))
  const t = await setup({ accountStatus, recoverCliCleanup })
  await vi.waitFor(() => expect(t.button('解除暂停')).toBeDefined())
  await t.click('解除暂停')
  await t.click('确认解除')
  await vi.waitFor(() => expect(t.text()).toContain('此 CLI 还有运行或排队中的任务'))
  expect(t.text()).toContain('确认解除')
})
