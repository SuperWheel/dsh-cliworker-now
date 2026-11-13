import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Button,
  Input,
  StateDot,
  Tooltip,
  IconChevronDownOutlineRegular,
  IconFolderCloseRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CLI_IDS, CLI_LABELS, type ActiveCliId } from '../shared/types.ts'
import {
  CLI_OPERATION_TERMINAL,
  CLI_UPDATE_GROUPS,
  NPMMIRROR_REGISTRY,
  OFFICIAL_NPM_REGISTRY,
  cliUpdateGroupLabel,
  type CliInstallDirectoryCheck,
  type CliUpdateEntry,
  type CliUpdateGroup,
  type CliUpdateOperation,
  type CliUpdateSnapshot,
} from '../shared/cli-management.ts'
import {
  advanceLayout,
  captureScrollAnchor,
  initialLayout,
  regroupAnnouncement,
  restoreScrollAnchor,
  type CliUpdateLayout,
  type ScrollAnchor,
} from './cli-update-layout.ts'
import type { CliUpdateData } from './cli-update-data.ts'
import { CliDownloadSourceSection } from './cli-download-source.tsx'
import { CopyText } from './copy-text.tsx'
import { BrandIcon } from './icons.tsx'
import { formatLocale, t, uiLanguage, useT, type MessageKey } from './i18n.ts'
import { hostText, operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'

type Service = API['cliworker']
type SectionId = CliUpdateGroup | 'download'
/** Mirror wording for `entry.mirrored`; the entry only says "not official", the saved download source says which. */
type MirrorKind = 'mirror' | 'custom' | 'unknown'
interface InstallDraft {
  /** '' = the default location. */
  path: string
  check?: CliInstallDirectoryCheck
  checking: boolean
  error?: string
}

const COLLAPSE_KEY = 'cwn-cli-update-collapsed'
const ROW_ICON = 32

function readCollapsed(): Partial<Record<SectionId, boolean>> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSE_KEY)
    const parsed = raw ? JSON.parse(raw) : undefined
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<SectionId, boolean>> = {}
    for (const id of [...CLI_UPDATE_GROUPS, 'download'] as SectionId[])
      if (typeof parsed[id] === 'boolean') out[id] = parsed[id]
    return out
  } catch {
    return {}
  }
}
function writeCollapsed(next: Partial<Record<SectionId, boolean>>) {
  try {
    globalThis.localStorage?.setItem(COLLAPSE_KEY, JSON.stringify(next))
  } catch {
    /* Private windows or blocked storage only lose the remembered state. */
  }
}

function readDirectoryCheck(raw: string): CliInstallDirectoryCheck {
  const next = JSON.parse(raw)
  if (!next || typeof next !== 'object' || typeof next.path !== 'string') throw new Error(t('收到无效的安装位置结果，请重试'))
  const bytes = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined)
  const problem = ['ADMIN_REQUIRED', 'NO_SPACE', 'NOT_EMPTY', 'INVALID'].includes(next.problem) ? next.problem : undefined
  return {
    path: next.path,
    freeBytes: bytes(next.freeBytes),
    requiredBytes: bytes(next.requiredBytes),
    problem,
    message: typeof next.message === 'string' ? next.message : undefined,
  }
}

/** 1 decimal under 100 units; whole numbers above. Sizes come only from snapshot fields. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, bytes)
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  const text = unit === 0 || size >= 100 ? String(Math.round(size)) : size.toFixed(1)
  return `${text} ${units[unit]}`
}

/** Download speed: MB/s with one decimal from 0.1 MB/s up (「0.9 MB/s」), KB/s below. */
export function formatRate(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024)
  if (mb >= 0.1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}

/** Free disk space for the location hint: whole numbers from 10 units up, with the Windows drive letter. */
function spaceText(path: string, free: number, required: number | undefined): string {
  const drive = /^([A-Za-z]):[\\/]/.exec(path)?.[1]?.toUpperCase()
  const freeText = compactBytes(free)
  if (required === undefined)
    return drive ? t('{drive} 盘可用 {free}', { drive, free: freeText }) : t('可用 {free}', { free: freeText })
  return drive
    ? t('{drive} 盘可用 {free}，安装需要约 {required}', { drive, free: freeText, required: compactBytes(required) })
    : t('可用 {free}，安装需要约 {required}', { free: freeText, required: compactBytes(required) })
}
function compactBytes(bytes: number): string {
  const text = formatBytes(bytes)
  const [number, unit] = text.split(' ')
  return Number(number) >= 10 ? `${Math.round(Number(number))} ${unit}` : text
}

const safeGuide = (url: string | undefined) => (url && /^https:\/\/[^\s]+$/i.test(url) ? url : undefined)
const openGuide = (url: string | undefined) => {
  const safe = safeGuide(url)
  // Harness routes HTTP(S) new-window requests to the native browser.
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
}
const randomId = () => globalThis.crypto.randomUUID()

function sourceLabel(entry: CliUpdateEntry, mirror: MirrorKind): string {
  const cli = CLI_LABELS[entry.cli]
  const base = (() => {
    switch (entry.source) {
      case 'npm':
        return t('npm 全局安装')
      case 'brew':
        return t('Homebrew 安装')
      case 'self-update':
        return t('{cli} 自带更新', { cli })
      case 'official-installer':
        return t('官方安装器')
      case 'desktop-app':
        return t('{cli} 桌面应用，下载官方安装包更新', { cli })
      case 'winget':
        return t('通过 WinGet 安装')
      case 'scoop':
        return t('通过 Scoop 安装')
      case 'nix':
        return t('通过 Nix 安装')
      case 'bun':
        return t('通过 Bun 全局安装')
      case 'pnpm':
        return t('通过 pnpm 全局安装')
      default:
        return t('没有识别出安装方式')
    }
  })()
  if (!entry.mirrored) return base
  const suffix = mirror === 'mirror' ? t('国内镜像') : mirror === 'custom' ? t('自定义源') : t('非官方源')
  return `${base} · ${suffix}`
}

const targetOf = (entry: CliUpdateEntry) =>
  entry.group === 'updatable' ? entry.latestCompatibleVersion ?? entry.latestVersion : entry.latestVersion

const DESKTOP_CLIS: ReadonlySet<ActiveCliId> = new Set<ActiveCliId>(['zcode', 'workbuddycn', 'workbuddy'])
/**
 * Desktop apps are updated as a whole: the Host plans against the app version, so `latestVersion`
 * is an app version there. Other CLIs that merely live inside an `.app` keep CLI-version semantics.
 */
const desktopApp = (entry: CliUpdateEntry) => !!entry.appVersion && entry.source === 'desktop-app' && DESKTOP_CLIS.has(entry.cli)
/** WorkBuddy releases carry three parts while the installed build has four (Host `desktopVersion`). */
const appRelease = (entry: CliUpdateEntry) =>
  entry.cli === 'workbuddy' || entry.cli === 'workbuddycn' ? entry.appVersion!.split('.').slice(0, 3).join('.') : entry.appVersion!
/** Channels worth naming; `stable`/`public` are the default and `unknown` is not evidence of anything. */
const channelPart = (entry: CliUpdateEntry) =>
  entry.channel && !['unknown', 'stable', 'public'].includes(entry.channel) ? ` · ${t('{channel} 通道', { channel: entry.channel })}` : ''

/** Version text with the arrow only for a newer target; desktop rows show 「应用 x → y · CLI z」. */
function versionText(entry: CliUpdateEntry, arrow: boolean): string {
  const target = targetOf(entry)
  if (desktopApp(entry)) {
    const newer = arrow && !!target && (entry.group === 'updatable' || (entry.group === 'manual' && target !== appRelease(entry)))
    const app = t('应用 {version}', { version: newer ? `${entry.appVersion} → ${target}` : entry.appVersion! })
    // ZCode reports the app version as its current version; only show a CLI version that differs.
    const cliVersion = entry.currentVersion && entry.currentVersion !== entry.appVersion ? ` · CLI ${entry.currentVersion}` : ''
    return `${app}${cliVersion}${channelPart(entry)}`
  }
  const current = entry.currentVersion ?? t('版本未知')
  const newer =
    arrow &&
    (entry.group === 'updatable' ||
      (entry.group === 'manual' && !!entry.currentVersion && !!target && target !== entry.currentVersion))
  return `${newer && target ? `${current} → ${target}` : current}${channelPart(entry)}`
}
const versionPart = (entry: CliUpdateEntry) => versionText(entry, true)
const versionKnown = (entry: CliUpdateEntry) => !!entry.currentVersion || desktopApp(entry)
/** Host notice that must be read before this row updates; plain text, translated only when known. */
const noticeOf = (entry: CliUpdateEntry | undefined) =>
  entry?.group === 'updatable' && entry.notice?.trim() ? hostText(entry.notice.trim()) : undefined

type Tone = 'error' | 'warn' | 'ok' | undefined
interface Description {
  text: string
  tone?: Tone
  spinner?: boolean
}

function prerequisiteProblem(entry: CliUpdateEntry): string | undefined {
  const missing = entry.install?.prerequisites.filter((item) => !item.satisfied) ?? []
  if (!missing.length) return undefined
  return missing
    .map((item) => {
      const need = item.required.trim() ? `${item.name} ${item.required.trim()}` : item.name
      return item.found
        ? t('需要 {need}，这台电脑上是 {found}', { need, found: item.found })
        : t('需要 {need}，这台电脑上没有找到', { need })
    })
    .join(uiLanguage() === 'en' ? '; ' : '；')
}

function installText(entry: CliUpdateEntry): string {
  const offer = entry.install
  const cli = CLI_LABELS[entry.cli]
  let text: string
  if (!offer) text = t('未安装')
  else if (offer.method === 'npm') text = t('官方 npm 包 · 装到 npm 全局目录')
  else if (offer.method === 'script')
    text = offer.defaultLocation ? t('官方安装脚本 · 装到 {path}', { path: offer.defaultLocation }) : t('官方安装脚本')
  else if (offer.method === 'desktop') {
    text = offer.experimental ? t('桌面应用（试验性）') : t('桌面应用，自带 {cli} CLI', { cli })
    if (offer.selectableLocation) text += ` · ${t('可选安装位置')}`
  } else text = t('需要按官方说明安装')
  if (offer?.experimental && offer.method !== 'desktop') text += ` · ${t('试验性')}`
  if (entry.reasonDetail) text += ` · ${hostText(entry.reasonDetail)}`
  return text
}

function describeEntry(entry: CliUpdateEntry, mirror: MirrorKind): Description {
  const detail = entry.reasonDetail ? ` ${hostText(entry.reasonDetail)}` : ''
  const current = versionText(entry, false)
  if (entry.group === 'checking' || (entry.stage && entry.group === 'notInstalled' && !entry.installed)) {
    if (entry.stage === 'remote' && versionKnown(entry))
      return { spinner: true, text: `${current} · ${t('正在查询最新版本…')}` }
    return { spinner: true, text: t('正在读取当前版本…') }
  }
  if (entry.stage) return { spinner: true, text: `${versionPart(entry)} · ${t('正在重新检查')}` }
  switch (entry.group) {
    case 'updatable': {
      const busy = entry.busyWorkers ?? 0
      return {
        text: `${versionPart(entry)} · ${busy > 0 ? t('有 {count} 个任务正在使用', { count: busy }) : sourceLabel(entry, mirror)}`,
      }
    }
    case 'manual':
      return { text: `${versionPart(entry)} · ${sourceLabel(entry, mirror)}` }
    case 'latest': {
      const newer = entry.latestVersion && entry.latestVersion !== (entry.latestCompatibleVersion ?? entry.currentVersion)
      if (entry.reason === 'INCOMPATIBLE_TARGET' || (newer && entry.latestCompatibleVersion))
        return { text: `${current} · ${t('有新版本 {version}，插件尚未适配', { version: entry.latestVersion ?? '' })}` }
      return { text: `${current} · ${sourceLabel(entry, mirror)}` }
    }
    case 'failed':
      switch (entry.reason) {
        case 'UNKNOWN_VERSION':
          return { tone: 'error', text: t('读不出当前版本。可以改路径，或重新安装到默认位置') + detail }
        case 'RELEASE_UNREACHABLE':
          return { tone: 'error', text: `${current} · ${t('连不上发布源')}${detail}` }
        case 'RELEASE_TIMEOUT':
          return { tone: 'error', text: `${current} · ${t('查询超时')}${detail}` }
        case 'NO_RELEASE_SOURCE':
          return { tone: 'error', text: `${current} · ${t('没有可用的发布源')}${detail}` }
        default:
          return { tone: 'error', text: `${current} · ${t('检查失败')}${detail}` }
      }
    case 'notInstalled': {
      const problem = prerequisiteProblem(entry)
      if (!problem) return { text: installText(entry) }
      const method = entry.install?.method === 'script' ? t('官方安装脚本') : entry.install?.method === 'npm' ? t('官方 npm 包') : ''
      return { tone: 'warn', text: method ? `${method}${uiLanguage() === 'en' ? ' · ' : ''}${problem}` : problem }
    }
  }
  return { text: current }
}

function operationText(operation: CliUpdateOperation, desktop = false): string {
  const version = operation.targetVersion
  switch (operation.phase) {
    case 'preparing':
      return operation.intent === 'install' ? t('正在准备安装…') : t('正在准备更新…')
    case 'downloading':
      if (operation.intent === 'install' && desktop)
        return version ? t('正在下载安装包 {version}…', { version }) : t('正在下载安装包…')
      return version ? t('正在下载 {version}…', { version }) : t('正在下载…')
    case 'verifying-download':
      return t('正在校验下载的文件…')
    case 'installing':
      return version ? t('正在安装 {version}…', { version }) : t('正在安装…')
    case 'awaiting-user':
      return t('请在打开的安装程序中完成安装…')
    case 'verifying-installation':
      return t('正在核对结果…')
    case 'cancelling':
      return t('正在取消…')
    default:
      return ''
  }
}

function resultDescription(result: CliUpdateOperation): Description & { stall?: boolean } {
  const version = result.afterVersion ?? result.targetVersion ?? ''
  switch (result.phase) {
    case 'succeeded':
      return result.intent === 'install'
        ? { tone: 'ok', text: t('已安装 {version}，登录后即可派遣', { version }) }
        : { tone: 'ok', text: t('已更新到 {version}', { version }) }
    case 'cancelled':
      return { tone: 'warn', text: t('已取消。已写入的文件不会回滚，建议重新检查') }
    case 'cleanup-unconfirmed':
      return { tone: 'error', text: hostText(result.error?.message) || t('进程清理尚未确认，请稍后重新检查') }
    default: {
      const fallback = result.intent === 'install' ? t('安装失败') : t('更新失败')
      const text = hostText(result.error?.message) || fallback
      if (result.error?.code === 'VERSION_UNCHANGED') return { tone: 'warn', text }
      return { tone: 'error', text, stall: result.error?.code === 'STALL_LIMIT' }
    }
  }
}

/** Disabled controls explain themselves on hover; an enabled control has no tooltip. */
function Explained({ reason, children }: { reason?: string; children: ReactElement }) {
  return (
    <Tooltip label={reason ?? ''} disabled={!reason} side="top" align="end" portal maxWidth={320}>
      {children}
    </Tooltip>
  )
}

/** Plain-text output that follows new lines unless the user scrolled up. */
function OutputLog({ text, label }: { text: string; label: string }) {
  const t = useT()
  const ref = useRef<HTMLPreElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const node = ref.current
    if (node && follow.current) node.scrollTop = node.scrollHeight
  }, [text])
  return (
    <>
      <div className="cwn-update-log-head">
        <span>{t('命令输出')}</span>
        <CopyText text={text} label={t('复制输出')} />
      </div>
      <pre
        ref={ref}
        className="cwn-update-log"
        tabIndex={0}
        aria-label={label}
        onScroll={(event) => {
          const node = event.currentTarget
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
        }}
      >
        {text}
      </pre>
    </>
  )
}

/** 「已用时 m:ss」 from the Host's operation start time; ticks once a second while mounted. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const clock = seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <> {t('已用时 {time}', { time: clock })}</>
}

function Progress({ operation }: { operation: CliUpdateOperation }) {
  const t = useT()
  const progress = operation.progress
  if (!progress) return null
  // External-command reruns are counted apart from HTTP Range resumes (PRD 5.6).
  const retries = progress.retryCount && progress.retryCount > 0 ? (
    <Tooltip label={t('下载中断时重新执行同一条命令，最多 200 次')} side="top" align="end" portal>
      <span tabIndex={0}>{t('已自动重试 {count} 次', { count: progress.retryCount })}</span>
    </Tooltip>
  ) : null
  if (!progress.readable)
    return (
      <div className="cwn-update-progress">
        <div className="cwn-update-progress-meta">
          <span>{t('正在执行，下载进度无法读取')}</span>
          {retries}
        </div>
      </div>
    )
  const downloaded = progress.downloadedBytes
  const total = progress.totalBytes && progress.totalBytes > 0 ? progress.totalBytes : undefined
  const percent = total !== undefined && downloaded !== undefined ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined
  const parts: string[] = []
  if (downloaded !== undefined)
    parts.push(
      total !== undefined
        ? t('已下载 {done} / {total}', { done: formatBytes(downloaded), total: formatBytes(total) })
        : t('已下载 {done}', { done: formatBytes(downloaded) }),
    )
  if (progress.bytesPerSecond !== undefined && progress.bytesPerSecond > 0) parts.push(formatRate(progress.bytesPerSecond))
  // Automatic source switching (PRD 5.6 3c): name the host this download currently comes from.
  if (progress.sourceHost) parts.push(t('来自 {host}', { host: progress.sourceHost }))
  const stalled = progress.stalledSeconds !== undefined && progress.stalledSeconds > 0
  if (stalled) parts.push(t('{count} 秒没有新数据', { count: Math.round(progress.stalledSeconds!) }))
  const name = CLI_LABELS[operation.cli]
  return (
    <div className="cwn-update-progress">
      {percent !== undefined && (
        <div
          className="cwn-update-bar"
          role="progressbar"
          aria-label={t('{cli} 下载进度', { cli: name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="cwn-update-progress-meta" data-tone={stalled ? 'warn' : undefined}>
        <span>{parts.join(' · ')}</span>
        {retries ?? (
          <Tooltip label={t('下载中断、10 秒没有增长或明显过慢时，自动从中断处继续，最多 200 次')} side="top" align="end" portal>
            <span tabIndex={0}>{t('已自动续传 {count} 次', { count: progress.resumeCount })}</span>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

function CommandBlock({ operation }: { operation: CliUpdateOperation }) {
  const t = useT()
  if (!operation.command?.length) return null
  return (
    <>
      <pre className="cwn-update-cmd">{operation.command.join(' ')}</pre>
      {operation.integritySource && (
        <span className="cwn-update-place">{t('校验值来自 {source}', { source: operation.integritySource })}</span>
      )}
    </>
  )
}

const CHECKING_PLACEHOLDER: CliUpdateLayout['groups'] = {
  checking: [...CLI_IDS],
  failed: [],
  updatable: [],
  manual: [],
  latest: [],
  notInstalled: [],
}

/** 「更新 CLI」 settings page: sections from the layout, rows from the Host snapshot. */
export function CliUpdatePane({
  api,
  sessionId,
  data,
  onOpenCli,
}: {
  api: API
  sessionId: string
  data: CliUpdateData
  /** 「去设置路径」/「去登录」: open that CLI's connection page. */
  onOpenCli(cli: ActiveCliId): void
}) {
  const t = useT()
  const service: Service = api.cliworker
  const snapshot = data.snapshot
  const pane = useRef<HTMLDivElement>(null)
  const downloadSection = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [expanded, setExpanded] = useState<Partial<Record<ActiveCliId, 'manual' | 'install' | 'confirm'>>>({})
  const [outputs, setOutputs] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Partial<Record<ActiveCliId, InstallDraft>>>({})
  const [pending, setPending] = useState<ReadonlySet<ActiveCliId>>(new Set())
  const [rowErrors, setRowErrors] = useState<Partial<Record<ActiveCliId, string>>>({})
  const [pageError, setPageError] = useState<string>()
  const [requesting, setRequesting] = useState<'' | 'check' | 'all'>('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [mirror, setMirror] = useState<MirrorKind>('unknown')
  const controllers = useRef(new Set<AbortController>())
  const mounted = useRef(true)

  useEffect(() => {
    const live = controllers.current
    mounted.current = true
    return () => {
      mounted.current = false
      for (const controller of live) controller.abort()
      live.clear()
    }
  }, [])
  async function call<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      return await run(controller.signal)
    } finally {
      controllers.current.delete(controller)
    }
  }
  const alive = () => mounted.current

  // Opening the page fills absent or stale rows only; 「检查更新」 asks for everything.
  const checkRef = useRef(data.check)
  checkRef.current = data.check
  useEffect(() => {
    void checkRef.current('missing').catch(() => undefined)
  }, [])

  // The saved download source names what `entry.mirrored` means; read-only and optional on older Hosts.
  const sourceKey = snapshot?.checkedAt
  useEffect(() => {
    const read = service.cliDownloadSource
    if (!read) return
    const controller = new AbortController()
    void (async () => {
      try {
        const settings = JSON.parse(value(await read(sessionId, controller.signal)))
        if (controller.signal.aborted) return
        const registry =
          settings?.source === 'npmmirror'
            ? NPMMIRROR_REGISTRY
            : settings?.source === 'custom'
              ? String(settings.customUrl ?? '')
              : settings?.source === 'official'
                ? OFFICIAL_NPM_REGISTRY
                : String(settings?.followRegistry ?? '')
        const host = (url: string) => {
          try {
            return new URL(url).host
          } catch {
            return ''
          }
        }
        setMirror(host(registry) === host(NPMMIRROR_REGISTRY) ? 'mirror' : registry ? 'custom' : 'unknown')
      } catch {
        if (!controller.signal.aborted) setMirror('unknown')
      }
    })()
    return () => controller.abort()
  }, [service, sessionId, sourceKey])

  const operation =
    snapshot?.operation && !CLI_OPERATION_TERMINAL.includes(snapshot.operation.phase) ? snapshot.operation : undefined
  const queue = snapshot?.queue ?? []
  const writing = !!operation || queue.length > 0
  const checking = snapshot ? snapshot.activity !== 'idle' : !data.error && data.supported
  const entries = new Map<ActiveCliId, CliUpdateEntry>((snapshot?.entries ?? []).map((entry) => [entry.cli, entry]))
  const results = new Map<ActiveCliId, CliUpdateOperation>()
  for (const result of snapshot?.results ?? []) {
    const known = results.get(result.cli)
    if (!known || (result.finishedAt ?? result.startedAt) >= (known.finishedAt ?? known.startedAt)) results.set(result.cli, result)
  }
  const outputOpen = (result: CliUpdateOperation) =>
    outputs[result.id] ?? (result.phase === 'failed' && result.error?.code !== 'VERSION_UNCHANGED')

  // Rows that are expanded or working keep their place until the next regroup point.
  const pinned = new Set<ActiveCliId>()
  for (const cli of Object.keys(expanded) as ActiveCliId[]) if (expanded[cli]) pinned.add(cli)
  for (const [cli, result] of results) if (outputOpen(result)) pinned.add(cli)
  if (operation) pinned.add(operation.cli)
  for (const cli of queue) pinned.add(cli)

  // One layout step per snapshot; the DOM still shows the previous layout here, so the anchor is read now.
  const layoutRef = useRef<{ snapshot?: CliUpdateSnapshot; layout?: CliUpdateLayout }>({})
  const pendingAnchor = useRef<{ anchor?: ScrollAnchor } | undefined>(undefined)
  const announcement = useRef('')
  if (snapshot && layoutRef.current.snapshot !== snapshot) {
    const previous = layoutRef.current.layout
    const next = previous ? advanceLayout(previous, snapshot, pinned) : initialLayout(snapshot)
    if (previous && JSON.stringify(previous.groups) !== JSON.stringify(next.groups)) {
      const container = pane.current
      pendingAnchor.current = { anchor: container ? captureScrollAnchor(container) : undefined }
      announcement.current = regroupAnnouncement(next.groups)
    }
    layoutRef.current = { snapshot, layout: next }
  }
  const groups = layoutRef.current.layout?.groups ?? CHECKING_PLACEHOLDER
  useLayoutEffect(() => {
    const restore = pendingAnchor.current
    if (!restore) return
    pendingAnchor.current = undefined
    if (pane.current) restoreScrollAnchor(pane.current, restore.anchor)
  })

  // `updateAllClis` queues every updatable row with a plan, notice or not (Host `updateAll`), so the
  // notices of those rows are confirmed here before the batch starts.
  const noticedForAll = CLI_IDS.flatMap((cli) => {
    const entry = entries.get(cli)
    const notice = noticeOf(entry)
    return entry?.planToken && notice ? [{ cli, notice }] : []
  })
  const busyCli = operation?.cli ?? queue[0]
  const writeBlocked = writing && busyCli ? t('一次只更新一个 CLI，{cli} 完成后再更新', { cli: CLI_LABELS[busyCli] }) : undefined
  const unsupported = t('当前 Host 版本不支持此操作，请更新 CLI Worker 插件')

  function toggleSection(id: SectionId, isCollapsed: boolean) {
    setCollapsed((old) => {
      const next = { ...old, [id]: !isCollapsed }
      writeCollapsed(next)
      return next
    })
  }
  const setRowError = (cli: ActiveCliId, message?: string) => setRowErrors((old) => ({ ...old, [cli]: message }))
  const markPending = (cli: ActiveCliId, on: boolean) =>
    setPending((old) => {
      const next = new Set(old)
      if (on) next.add(cli)
      else next.delete(cli)
      return next
    })

  async function rowCall(cli: ActiveCliId, run: (signal: AbortSignal) => Promise<unknown>) {
    markPending(cli, true)
    setRowError(cli, undefined)
    try {
      await call(run)
      return true
    } catch (error) {
      if (alive()) setRowError(cli, operationMessage(error))
      return false
    } finally {
      if (alive()) markPending(cli, false)
    }
  }

  /** An update with a Host notice waits for the inline confirmation; everything else starts at once. */
  function requestUpdate(cli: ActiveCliId) {
    if (noticeOf(entries.get(cli))) setExpanded((old) => ({ ...old, [cli]: old[cli] === 'confirm' ? undefined : 'confirm' }))
    else void start(cli, 'update')
  }
  async function start(cli: ActiveCliId, intent: 'update' | 'install', installDirectory = '') {
    const run = service.startCliOperation
    if (!run) return
    const planToken = entries.get(cli)?.planToken ?? ''
    const ok = await rowCall(cli, async (signal) => value(await run(sessionId, cli, intent, planToken, installDirectory, randomId(), signal)))
    if (ok && alive()) setExpanded((old) => ({ ...old, [cli]: undefined }))
  }
  async function cancel(cli: ActiveCliId, target: string) {
    const run = service.cancelCliOperation
    if (!run) return
    await rowCall(cli, async (signal) => value(await run(sessionId, target, signal)))
  }
  async function checkAll() {
    setRequesting('check')
    setPageError(undefined)
    try {
      await data.check('all')
    } catch (error) {
      if (alive()) setPageError(operationMessage(error))
    } finally {
      if (alive()) setRequesting('')
    }
  }
  async function updateAll() {
    const run = service.updateAllClis
    if (!run) return
    setConfirmAll(false)
    setRequesting('all')
    setPageError(undefined)
    try {
      await call(async (signal) => value(await run(sessionId, randomId(), signal)))
    } catch (error) {
      if (alive()) setPageError(operationMessage(error))
    } finally {
      if (alive()) setRequesting('')
    }
  }

  async function inspectDirectory(cli: ActiveCliId, path: string) {
    const run = service.checkInstallDirectory
    if (!run) return
    setDrafts((old) => ({ ...old, [cli]: { ...(old[cli] ?? { path }), path, checking: true, error: undefined } }))
    try {
      const check = await call(async (signal) => readDirectoryCheck(value(await run(sessionId, cli, path, signal))))
      setDrafts((old) => (old[cli]?.path === path ? { ...old, [cli]: { path, check, checking: false } } : old))
    } catch (error) {
      setDrafts((old) =>
        old[cli]?.path === path ? { ...old, [cli]: { path, checking: false, error: operationMessage(error) } } : old,
      )
    }
  }
  async function browse(cli: ActiveCliId) {
    const run = service.chooseInstallDirectory
    if (!run) return
    setDrafts((old) => ({ ...old, [cli]: { ...(old[cli] ?? { path: '' }), checking: true, error: undefined } }))
    try {
      const picked = await call(async (signal) => readDirectoryCheck(value(await run(sessionId, cli, signal))))
      if (!picked) return
      if (!picked.path) {
        // Dismissed: keep the previous choice.
        setDrafts((old) => ({ ...old, [cli]: { ...(old[cli] ?? { path: '' }), checking: false } }))
        return
      }
      if (picked.problem || picked.freeBytes !== undefined) setDrafts((old) => ({ ...old, [cli]: { path: picked.path, check: picked, checking: false } }))
      else await inspectDirectory(cli, picked.path)
    } catch (error) {
      setDrafts((old) => ({ ...old, [cli]: { ...(old[cli] ?? { path: '' }), checking: false, error: operationMessage(error) } }))
    }
  }
  function openInstall(cli: ActiveCliId) {
    setExpanded((old) => ({ ...old, [cli]: 'install' }))
    if (!drafts[cli]) void inspectDirectory(cli, '')
  }

  const header = (
    <div className="cwn-cli-identity">
      <div className="cwn-settings-cli-name">
        <div>
          <h2>{t('更新 CLI')}</h2>
          <p className="cwn-cli-subtitle">{t('检查、更新或安装这台电脑上的 CLI')}</p>
        </div>
      </div>
      {data.supported && !(data.error && !snapshot) && (
        <div className="cwn-update-tools">
          <div className="cwn-update-tools-row">
          <Tooltip
            label={snapshot?.checkedAt ? t('上次检查：{time}', { time: formatTime(snapshot.checkedAt) }) : ''}
            disabled={!snapshot?.checkedAt}
            side="bottom"
            align="end"
            portal
          >
            <Button
              type="button"
              size="md"
              variant="outline"
              className="cwn-update-check"
              aria-label={checking ? t('正在检查') : t('检查更新')}
              icon={checking || requesting === 'check' ? <StateDot state="ongoing" size={12} /> : <IconRefreshOutlineRegular size={16} />}
              disabled={checking || writing || requesting !== ''}
              onClick={() => void checkAll()}
            >
              <span className="cwn-update-check-label">{checking ? t('正在检查') : t('检查更新')}</span>
            </Button>
          </Tooltip>
          {/* Follows the displayed sections: during the first load the button appears only once the
              second regroup has moved rows into 可更新 (PRD 5.2.1). */}
          {snapshot && (groups.updatable ?? []).some((cli) => entries.get(cli)?.group === 'updatable') && (
            <Explained
              reason={
                !service.updateAllClis
                  ? unsupported
                  : writeBlocked ?? (checking ? t('检查完成后才能全部更新') : undefined)
              }
            >
              <Button
                type="button"
                size="md"
                variant="primary"
                aria-expanded={noticedForAll.length ? confirmAll : undefined}
                disabled={!service.updateAllClis || writing || checking || requesting !== ''}
                onClick={() => (noticedForAll.length ? setConfirmAll((open) => !open) : void updateAll())}
              >
                {t('全部更新')}
              </Button>
            </Explained>
          )}
          </div>
          {pageError && <p className="cwn-update-page-error" role="alert">{pageError}</p>}
        </div>
      )}
    </div>
  )

  // A failed stream item after a good snapshot keeps the last results on screen with a retry line;
  // only a page with nothing to show becomes the whole-page error.
  if (!data.supported || (data.error && !snapshot)) {
    return (
      <div className="cwn-settings-pane cwn-update-page" aria-label={t('更新 CLI')}>
        {header}
        <div className="cwn-update-line" data-tone={data.error ? 'error' : undefined} role="status">
          <span>{data.error ? hostText(data.error) : t('当前 Host 版本不支持更新 CLI，请更新 CLI Worker 插件')}</span>
          {data.error && (
            <Button type="button" size="md" variant="outline" onClick={() => data.retry()}>
              {t('重试')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  /** Why an update cannot start now; undefined when it can. */
  const updateReason = (entry: CliUpdateEntry) =>
    !service.startCliOperation
      ? unsupported
      : (entry.busyWorkers ?? 0) > 0
        ? t('这些任务结束或停止后才能更新')
        : writeBlocked

  function rowActions(cli: ActiveCliId, entry: CliUpdateEntry | undefined, result: CliUpdateOperation | undefined): ReactNode {
    const busy = pending.has(cli)
    if (operation?.cli === cli) {
      return (
        <Button
          type="button"
          size="md"
          variant="ghost"
          disabled={busy || operation.phase === 'cancelling' || !service.cancelCliOperation}
          onClick={() => void cancel(cli, operation.id)}
        >
          {operation.intent === 'install' ? t('取消安装') : t('取消更新')}
        </Button>
      )
    }
    if (queue.includes(cli)) {
      return (
        <Button type="button" size="md" variant="ghost" disabled={busy || !service.cancelCliOperation} onClick={() => void cancel(cli, cli)}>
          {t('取消')}
        </Button>
      )
    }
    const writeReason = (extra?: string) =>
      !service.startCliOperation ? unsupported : extra ?? writeBlocked
    const outputToggle = (shown: CliUpdateOperation) => (
      <Button
        key="output"
        type="button"
        size="md"
        variant="ghost"
        aria-expanded={outputOpen(shown)}
        onClick={() => setOutputs((old) => ({ ...old, [shown.id]: !outputOpen(shown) }))}
      >
        {outputOpen(shown) ? t('收起输出') : t('查看输出')}
      </Button>
    )
    if (result && result.phase !== 'cancelled') {
      if (result.phase === 'succeeded') {
        if (result.intent === 'install')
          return (
            <Button type="button" size="md" variant="outline" onClick={() => onOpenCli(cli)}>
              {t('去登录')}
            </Button>
          )
        return outputToggle(result)
      }
      if (result.phase === 'cleanup-unconfirmed') return outputToggle(result)
      if (result.error?.code === 'VERSION_UNCHANGED')
        return [
          outputToggle(result),
          <Button key="recheck" type="button" size="md" variant="outline" disabled={checking || requesting !== ''} onClick={() => void checkAll()}>
            {t('重新检查')}
          </Button>,
        ]
      const guide = safeGuide(entry?.manual?.guideUrl ?? entry?.install?.guideUrl)
      const reason = writeReason()
      return [
        guide && (
          <Button key="guide" type="button" size="md" variant="ghost" onClick={() => openGuide(guide)}>
            {t('官方说明')}
          </Button>
        ),
        outputToggle(result),
        <Explained key="retry" reason={reason}>
          <Button
            type="button"
            size="md"
            variant="outline"
            disabled={!!reason || busy}
            onClick={() =>
              result.intent === 'update' ? requestUpdate(cli) : void start(cli, result.intent, result.installDirectory ?? '')
            }
          >
            {t('重试')}
          </Button>
        </Explained>,
      ]
    }
    if (!entry) return null
    switch (entry.group) {
      case 'updatable': {
        const reason = updateReason(entry)
        return (
          <Explained reason={reason}>
            <Button
              type="button"
              size="md"
              variant="outline"
              aria-expanded={noticeOf(entry) ? expanded[cli] === 'confirm' : undefined}
              disabled={!!reason || busy}
              onClick={() => requestUpdate(cli)}
            >
              {t('更新')}
            </Button>
          </Explained>
        )
      }
      case 'manual': {
        const open = expanded[cli] === 'manual'
        return (
          <Button
            type="button"
            size="md"
            variant="outline"
            aria-expanded={open}
            onClick={() => setExpanded((old) => ({ ...old, [cli]: open ? undefined : 'manual' }))}
          >
            {open ? t('收起') : t('查看方法')}
          </Button>
        )
      }
      case 'failed': {
        if (entry.reason === 'UNKNOWN_VERSION') {
          const reason = writeReason()
          return [
            <Button key="path" type="button" size="md" variant="ghost" onClick={() => onOpenCli(cli)}>
              {t('去设置路径')}
            </Button>,
            <Explained key="reinstall" reason={reason}>
              <Button type="button" size="md" variant="outline" disabled={!!reason || busy} onClick={() => void start(cli, 'install')}>
                {t('重新安装')}
              </Button>
            </Explained>,
          ]
        }
        return (
          <Button type="button" size="md" variant="outline" disabled={checking || requesting !== ''} onClick={() => void checkAll()}>
            {t('重试')}
          </Button>
        )
      }
      case 'notInstalled': {
        const offer = entry.install
        const problem = prerequisiteProblem(entry)
        const guide = safeGuide(offer?.guideUrl)
        const open = expanded[cli] === 'install'
        const reason = writeReason(
          !offer || offer.method === 'manual'
            ? t('这个 CLI 需要按官方说明安装')
            : problem
              ? t('缺少前置条件，准备好后再安装')
              : undefined,
        )
        const selectable = !!offer?.selectableLocation && !!service.checkInstallDirectory
        return [
          (problem || offer?.method === 'manual') && guide && (
            <Button key="guide" type="button" size="md" variant="ghost" onClick={() => openGuide(guide)}>
              {t('官方说明')}
            </Button>
          ),
          open ? (
            <Button key="install" type="button" size="md" variant="outline" aria-expanded onClick={() => setExpanded((old) => ({ ...old, [cli]: undefined }))}>
              {t('收起')}
            </Button>
          ) : (
            <Explained key="install" reason={reason}>
              <Button
                type="button"
                size="md"
                variant="outline"
                aria-expanded={selectable ? false : undefined}
                disabled={!!reason || busy}
                onClick={() => (selectable ? openInstall(cli) : void start(cli, 'install'))}
              >
                {t('安装')}
              </Button>
            </Explained>
          ),
        ]
      }
      default:
        return null
    }
  }

  function rowExpansion(cli: ActiveCliId, entry: CliUpdateEntry | undefined, result: CliUpdateOperation | undefined): ReactNode {
    if (operation?.cli === cli) {
      return (
        <div className="cwn-update-expand">
          <Progress operation={operation} />
          {operation.intent === 'install' && entry?.install?.method !== 'desktop' && (operation.installDirectory || entry?.install?.defaultLocation) ? (
            <span className="cwn-update-place">
              {t('安装到官方默认位置 {path}', { path: operation.installDirectory || entry!.install!.defaultLocation! })}
            </span>
          ) : operation.installDirectory ? (
            <span className="cwn-update-place">{t('安装到 {path}', { path: operation.installDirectory })}</span>
          ) : null}
          <CommandBlock operation={operation} />
          <OutputLog text={operation.outputTail} label={t('{cli} 命令输出', { cli: CLI_LABELS[cli] })} />
        </div>
      )
    }
    if (queue.includes(cli)) return null
    const notice = expanded[cli] === 'confirm' ? noticeOf(entry) : undefined
    const confirm = notice && (
      <div className="cwn-update-bubble" data-column role="group" aria-label={t('确认更新 {cli}', { cli: CLI_LABELS[cli] })}>
        <span className="cwn-update-note">{t('更新 {cli} 前请确认：{notice}', { cli: CLI_LABELS[cli], notice })}</span>
        <div className="cwn-update-actions">
          <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded((old) => ({ ...old, [cli]: undefined }))}>
            {t('取消')}
          </Button>
          <Explained reason={updateReason(entry!)}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!!updateReason(entry!) || pending.has(cli)}
              onClick={() => void start(cli, 'update')}
            >
              {t('继续更新')}
            </Button>
          </Explained>
        </div>
      </div>
    )
    if (result && result.phase !== 'cancelled' && outputOpen(result)) {
      return (
        <>
          <div className="cwn-update-expand">
            <CommandBlock operation={result} />
            <OutputLog text={result.outputTail} label={t('{cli} 命令输出', { cli: CLI_LABELS[cli] })} />
          </div>
          {confirm}
        </>
      )
    }
    if (!entry) return null
    if (confirm) return confirm
    if (expanded[cli] === 'manual' && entry.group === 'manual') {
      const method = entry.manual
      const guide = safeGuide(method?.guideUrl)
      const command = method?.command?.length ? method.command.join(' ') : undefined
      return (
        <div className="cwn-update-bubble" data-column={command ? true : undefined}>
          <span className="cwn-update-note">{method ? hostText(method.note) : t('没有可用的更新方法，请按官方说明更新')}</span>
          {command && <pre className="cwn-update-cmd">{command}</pre>}
          {(command || guide) && (
            <div className="cwn-update-actions">
              {command && <CopyText text={command} label={t('复制命令')} />}
              {guide && (
                <Button type="button" size="sm" variant="outline" onClick={() => openGuide(guide)}>
                  {t('官方说明')}
                </Button>
              )}
            </div>
          )}
        </div>
      )
    }
    if (expanded[cli] === 'install' && entry.group === 'notInstalled') {
      const draft = drafts[cli]
      const check = draft?.check
      const shown = draft?.path || check?.path || entry.install?.defaultLocation || ''
      const problem = check?.problem
      const hintId = `cwn-update-hint-${cli}`
      const fieldId = `cwn-update-dir-${cli}`
      const hint = draft?.error
        ? draft.error
        : problem
          ? hostText(check?.message) || directoryProblem(problem)
          : check?.freeBytes !== undefined
            ? spaceText(shown, check.freeBytes, check.requiredBytes)
            : draft?.checking
              ? t('正在检查安装位置…')
              : ''
      const reason = !service.startCliOperation ? unsupported : writeBlocked
      return (
        <div className="cwn-update-bubble" data-column>
          <label className="cwn-update-field-label" htmlFor={fieldId}>
            {t('安装位置')}
          </label>
          <div className="cwn-update-field-row">
            <Input id={fieldId} value={shown} readOnly aria-describedby={hint ? hintId : undefined} />
            {service.chooseInstallDirectory && (
              <Tooltip label={t('浏览文件夹')} side="top" portal>
                <Button
                  type="button"
                  size="md"
                  variant="outline"
                  className="cwn-update-browse"
                  aria-label={t('浏览文件夹')}
                  disabled={draft?.checking}
                  onClick={() => void browse(cli)}
                >
                  <IconFolderCloseRegular size={16} />
                </Button>
              </Tooltip>
            )}
          </div>
          {hint && (
            <span className="cwn-update-hint" id={hintId} data-tone={problem || draft?.error ? 'error' : undefined}>
              {hint}
            </span>
          )}
          <div className="cwn-update-actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!draft?.path || draft.checking}
              onClick={() => void inspectDirectory(cli, '')}
            >
              {t('恢复默认位置')}
            </Button>
            <Explained reason={reason}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!reason || !!problem || !!draft?.checking || pending.has(cli)}
                onClick={() => void start(cli, 'install', draft?.path ?? '')}
              >
                {t('开始安装')}
              </Button>
            </Explained>
          </div>
        </div>
      )
    }
    return null
  }

  function row(cli: ActiveCliId) {
    const entry = entries.get(cli)
    const active = operation?.cli === cli ? operation : undefined
    const queued = !active && queue.includes(cli)
    const result = !active && !queued ? results.get(cli) : undefined
    let description: Description & { stall?: boolean }
    if (active) description = { spinner: true, text: operationText(active, entry?.install?.method === 'desktop') }
    else if (queued) description = { text: t('排队中') }
    else if (result) description = resultDescription(result)
    else if (entry) description = describeEntry(entry, mirror)
    else description = { spinner: true, text: t('正在读取当前版本…') }
    const error = rowErrors[cli]
    return (
      <div className="cwn-update-item" key={cli} data-cli={cli}>
        <div className="cwn-update-row">
          <div className="cwn-update-row-main">
            <BrandIcon cli={cli} size={ROW_ICON} />
            <div className="cwn-update-text">
              <span className="cwn-update-name">{CLI_LABELS[cli]}</span>
              <span className="cwn-update-desc" data-tone={description.tone}>
                {description.spinner && <StateDot state="ongoing" size={12} />}
                {description.tone === 'ok' && <StateDot state="done" size={6} />}
                <span>
                  {description.text}
                  {active && <Elapsed since={active.startedAt} />}
                  {description.stall && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cwn-update-link"
                        onClick={() => downloadSection.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })}
                      >
                        {t('可以在页面底部切换下载源后重试')}
                      </button>
                    </>
                  )}
                </span>
              </span>
              {error && (
                <p className="cwn-update-row-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="cwn-update-actions">{rowActions(cli, entry, result)}</div>
        </div>
        {rowExpansion(cli, entry, result)}
      </div>
    )
  }

  const installing = operation?.intent === 'install' || queue.some((cli) => entries.get(cli)?.group === 'notInstalled')
  const isCollapsed = (id: SectionId) =>
    id === 'notInstalled' && installing ? false : collapsed[id] ?? id === 'notInstalled'
  function section(id: SectionId, label: string, count: number | undefined, body: ReactNode) {
    const folded = isCollapsed(id)
    return (
      <section
        key={id}
        ref={id === 'download' ? downloadSection : undefined}
        className="cwn-settings-section cwn-update-section"
        aria-label={label}
        aria-busy={id === 'checking' ? true : undefined}
        data-collapsed={folded ? true : undefined}
      >
        {/* The whole head row toggles; the chevron button stays the keyboard and screen-reader control. */}
        <div
          className="cwn-settings-section-head cwn-update-section-toggle"
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button')) toggleSection(id, folded)
          }}
        >
          <h3>
            {label}
            {count !== undefined && <span className="cwn-update-count">{count}</span>}
          </h3>
          <div className="cwn-settings-section-tools">
            <Button
              type="button"
              size="md"
              variant="ghost"
              className="cwn-refresh cwn-update-fold"
              aria-label={folded ? t('展开{section}', { section: label }) : t('收起{section}', { section: label })}
              aria-expanded={!folded}
              onClick={() => toggleSection(id, folded)}
            >
              <IconChevronDownOutlineRegular size={16} />
            </Button>
          </div>
        </div>
        {!folded && body}
      </section>
    )
  }

  return (
    <div ref={pane} className="cwn-settings-pane cwn-update-page" aria-label={t('更新 CLI')}>
      <div className="cwn-sr-only" role="status" aria-live="polite">
        {announcement.current}
      </div>
      {header}
      {confirmAll && noticedForAll.length > 0 && !writing && (
        <div className="cwn-update-bubble cwn-update-confirm-all" data-column role="group" aria-label={t('确认全部更新')}>
          <span className="cwn-update-note">{t('以下 CLI 会一起更新，请先确认各自的说明：')}</span>
          <ul className="cwn-update-notice-list">
            {noticedForAll.map(({ cli, notice }) => (
              <li key={cli}>
                <span className="cwn-update-notice-name">{CLI_LABELS[cli]}</span>
                {uiLanguage() === 'en' ? ': ' : '：'}
                {notice}
              </li>
            ))}
          </ul>
          <div className="cwn-update-actions">
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
              {t('取消')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!service.updateAllClis || checking || requesting !== ''}
              onClick={() => void updateAll()}
            >
              {t('继续更新')}
            </Button>
          </div>
        </div>
      )}
      {data.error && (
        <div className="cwn-update-line" data-tone="error" role="status">
          <span>{hostText(data.error)}</span>
          <Button type="button" size="md" variant="outline" onClick={() => data.retry()}>
            {t('重试')}
          </Button>
        </div>
      )}
      {CLI_UPDATE_GROUPS.map((group) => {
        const clis = groups[group] ?? []
        if (!clis.length) return null
        return section(group, t(cliUpdateGroupLabel(group) as MessageKey), clis.length, <div>{clis.map(row)}</div>)
      })}
      {section('download', t('下载设置'), undefined, <CliDownloadSourceSection api={api} sessionId={sessionId} />)}
    </div>
  )
}

function directoryProblem(problem: NonNullable<CliInstallDirectoryCheck['problem']>): string {
  switch (problem) {
    case 'ADMIN_REQUIRED':
      return t('这个位置需要管理员权限，请换一个目录')
    case 'NO_SPACE':
      return t('可用空间不足，请换一个目录')
    case 'NOT_EMPTY':
      return t('目录里已有其他文件，请换一个空目录')
    default:
      return t('这个位置不能用于安装，请换一个目录')
  }
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(formatLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(ms).toISOString()
  }
}
