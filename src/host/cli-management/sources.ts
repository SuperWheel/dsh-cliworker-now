import type { ActiveCliId } from '../../shared/types.ts'
import type { CliInstallOffer } from '../../shared/cli-management.ts'
import { homedir } from 'node:os'
import { relative } from 'node:path'
import { windowsCliCandidates } from '../windows-cli-installation.ts'

export interface CliSource {
  npm?: string
  brew?: { name: string; kind: 'formula' | 'cask'; tap?: string }
  update?: readonly string[]
  guideUrl: string
  defaultLocation: string
  prerequisites: readonly { name: string; required: string }[]
  compatibility: 'any' | 'opencode-v1'
  version: 'manifest' | 'kimi' | 'command' | 'workbuddy' | 'unknown'
  /** 2026-11-13 supplied macOS audit: no file changes; account preload is separate. */
  backgroundSafe: boolean
  versionNote?: string
  install: CliInstallOffer['method']
  scriptUrl?: string
  experimental?: boolean
}
export const ZCODE_DEFAULT_APP = '/Applications/ZCode.app'
const base = { prerequisites: [], compatibility: 'any', version: 'command', backgroundSafe: true, install: 'manual' } as const
/** Host-owned provenance and capabilities. First-install offers are independent
 * from the audited update methods below; neither accepts Client commands/URLs. */
export const CLI_SOURCES: Record<ActiveCliId, CliSource> = {
  antigravity: { ...base, defaultLocation: '~/.local/bin/agy · Windows: %LOCALAPPDATA%\\agy\\bin', guideUrl: 'https://antigravity.google/cli', scriptUrl: 'https://antigravity.google/cli/install.sh' },
  codex: { ...base, backgroundSafe: false, npm: '@openai/codex', brew: { name: 'codex', kind: 'cask' }, defaultLocation: 'npm 全局前缀（脚本落点待核实）', prerequisites: [{ name: 'Node.js', required: '随目标包核实' }], guideUrl: 'https://developers.openai.com/codex/cli/', install: 'npm' },
  claude: { ...base, npm: '@anthropic-ai/claude-code', brew: { name: 'claude-code', kind: 'cask' }, update: ['update'], defaultLocation: '~/.local/bin/claude', prerequisites: [{ name: 'Node.js（npm）', required: '≥ 22' }], guideUrl: 'https://code.claude.com/docs/en/setup', scriptUrl: 'https://claude.ai/install.sh' },
  kimi: { ...base, npm: '@moonshot-ai/kimi-code', version: 'kimi', defaultLocation: '~/.kimi-code/bin/kimi（待复核）', prerequisites: [{ name: 'Node.js（npm）', required: '≥ 22.19' }, { name: 'Git Bash（Windows）', required: '已安装' }], guideUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html', scriptUrl: 'https://cdn.kimi.com/kimi-code/install.sh' },
  mimo: { ...base, npm: '@mimo-ai/cli', defaultLocation: '~/.mimocode/bin/mimo · Windows: npm 全局前缀', prerequisites: [{ name: 'Node.js（Windows npm）', required: '≥ 18' }], guideUrl: 'https://mimo.mi.com/docs/en-US/tokenplan/integration/mimo-code', scriptUrl: 'https://mimo.xiaomi.com/install' },
  zcode: { ...base, version: 'manifest', defaultLocation: '/Applications/ZCode.app · Windows: 待核实', guideUrl: 'https://zcode.z.ai/en/docs/install' },
  grok: { ...base, update: ['update'], defaultLocation: '~/.grok/bin/grok', guideUrl: 'https://x.ai/cli', scriptUrl: 'https://x.ai/cli/install.sh' },
  omp: { ...base, npm: '@oh-my-pi/pi-coding-agent', defaultLocation: 'Bun 全局 bin（官方脚本落点待核实）', prerequisites: [{ name: 'Bun（Bun 安装）', required: '≥ 1.4.4' }], guideUrl: 'https://github.com/can1357/oh-my-pi', scriptUrl: 'https://omp.sh/install' },
  pi: { ...base, npm: '@earendil-works/pi-coding-agent', update: ['update', '--self'], defaultLocation: '~/.local/bin/pi · ~/.pi/agent/bin', prerequisites: [{ name: 'Node.js', required: '≥ 22.19' }], guideUrl: 'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md', install: 'npm' },
  hermes: { ...base, version: 'manifest', versionNote: 'Hermes 前后台均不执行 --version；只读 install-stamp.json 的 baseVersion，缺少可信安装记录时保留版本未知。', defaultLocation: '~/.hermes/hermes-agent · Windows: %LOCALAPPDATA%\\hermes', prerequisites: [{ name: 'Git / curl / tar', required: '已安装' }], guideUrl: 'https://nousresearch.github.io/hermes-agent/docs/getting-started/updating/', scriptUrl: 'https://hermes-agent.nousresearch.com/install.sh' },
  opencode: { ...base, npm: 'opencode-ai', brew: { name: 'opencode', kind: 'formula', tap: 'anomalyco/tap' }, compatibility: 'opencode-v1', update: ['upgrade'], defaultLocation: '随原安装方式（脚本落点待核实）', guideUrl: 'https://dev.opencode.ai/v1/docs/cli/', scriptUrl: 'https://opencode.ai/install' },
  qoder: { ...base, backgroundSafe: false, npm: '@qoder-ai/qodercli', update: ['update'], defaultLocation: 'Windows: ~/.qoder/bin/qodercli · macOS: 待核实', prerequisites: [{ name: 'Node.js（旧 npm）', required: '≥ 20.0.0' }, { name: 'Windows 架构', required: '非 ARM64' }], guideUrl: 'https://docs.qoder.com/cli/installation', scriptUrl: 'https://qoder.com/install' },
  qodercn: { ...base, backgroundSafe: false, npm: '@qodercn-ai/qoderclicn', update: ['update'], defaultLocation: 'Windows: ~/.qoder-cn/bin/qoderclicn · macOS: 待核实', prerequisites: [{ name: 'Node.js（旧 npm）', required: '≥ 20.18.1' }, { name: 'Windows 架构', required: '非 ARM64' }], guideUrl: 'https://docs.qoder.cn/cli/installation', scriptUrl: 'https://static.qoder.com.cn/qoder-cli-cn/install.sh' },
  codebuddy: { ...base, npm: '@tencent-ai/codebuddy-code', brew: { name: 'codebuddy-code', kind: 'formula', tap: 'Tencent-CodeBuddy/tap' }, update: ['update'], defaultLocation: 'npm 全局前缀', prerequisites: [{ name: 'Node.js', required: '≥ 18.20' }], guideUrl: 'https://www.codebuddy.cn/docs/cli/installation', install: 'npm' },
  traecn: { ...base, update: ['update'], defaultLocation: '~/.local/bin/traecli → ~/.local/share/traecli/current · Windows: 待验收', prerequisites: [{ name: '网络', required: 'trae.cn 可直连' }], guideUrl: 'https://docs.trae.cn/cli_command-line-parameters', scriptUrl: 'https://trae.cn/trae-cli/install_v2.sh' },
  workbuddycn: { ...base, version: 'workbuddy', defaultLocation: '/Applications/WorkBuddy.app · Windows: 待核实', prerequisites: [{ name: '系统', required: 'macOS ≥ 12 / Windows ≥ 10' }], guideUrl: 'https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide', experimental: true },
  workbuddy: { ...base, version: 'workbuddy', defaultLocation: '/Applications/WorkBuddy AI.app · Windows: 待核实', prerequisites: [{ name: '系统', required: 'macOS ≥ 12 / Windows ≥ 10' }], guideUrl: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide', experimental: true },
}
/** Anonymous GET endpoints audited in .cache/cli-update-research/feeds.md §3.
 * Templates substitute only Host platform/CPU enums, never Client input. */
export const MIMO_SOURCE_POLICY = { hosts: ['cnbj1.fds.api.xiaomi.com', 'mimocode.cnbj1.mi-fds.com'], pathPrefix: '/mimocode/mimocode/releases/' } as const
export const MIMO_RELEASE_SOURCES = MIMO_SOURCE_POLICY.hosts.map(host => `https://${host}${MIMO_SOURCE_POLICY.pathPrefix}`)
export const NATIVE_RELEASES: Partial<Record<ActiveCliId, { kind: 'antigravity' | 'codex' | 'kimi' | 'text' | 'pi' | 'hermes' | 'qoder' | 'trae'; url: string; fallbackUrls?: readonly string[] }>> = {
  antigravity: { kind: 'antigravity', url: 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/{platform}_{arch}.json' },
  codex: { kind: 'codex', url: 'https://releases.openai.com/codex/channels/latest' },
  kimi: { kind: 'kimi', url: 'https://cdn.kimi.com/kimi-code/latest.json' },
  mimo: { kind: 'text', url: `${MIMO_RELEASE_SOURCES[0]}latest`, fallbackUrls: [`${MIMO_RELEASE_SOURCES[1]}latest`] },
  grok: { kind: 'text', url: 'https://x.ai/cli/stable' },
  pi: { kind: 'pi', url: 'https://pi.dev/api/latest-version' },
  hermes: { kind: 'hermes', url: 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest' },
  qoder: { kind: 'qoder', url: 'https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/channels/manifest.json' },
  qodercn: { kind: 'qoder', url: 'https://static.qoder.com.cn/qoder-cli-cn/channels/manifest.json' },
  traecn: { kind: 'trae', url: 'https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae-cli/v2/public/stable/latest.json' },
}
export interface NativeUpdate {
  argv: readonly string[]; pinsVersion: boolean; env?: Record<string, string>; notice?: string
  script?: { url: string; interpreter: string; platforms: readonly string[] }
}
export const NATIVE_UPDATES: Partial<Record<ActiveCliId, NativeUpdate>> = {
  antigravity: { argv: ['update'], pinsVersion: false, notice: '官方更新命令的确认行为尚未实机核实；关闭 stdin，超时或版本未前进会报告失败。' },
  codex: { argv: ['--release', '%VERSION%'], pinsVersion: true, env: { CODEX_NON_INTERACTIVE: '1' }, script: { url: 'https://releases.openai.com/codex/install.sh', interpreter: '/bin/sh', platforms: ['darwin', 'linux'] } },
  claude: { argv: ['update'], pinsVersion: false },
  kimi: { argv: ['update', '-y'], pinsVersion: false, env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } },
  mimo: { argv: ['upgrade', '%VERSION%', '--method', 'curl'], pinsVersion: true },
  grok: { argv: ['update', '--version', '%VERSION%'], pinsVersion: true },
  omp: { argv: ['update'], pinsVersion: false },
  pi: { argv: ['update', '--self'], pinsVersion: false },
  hermes: { argv: ['update', '--yes'], pinsVersion: false, notice: 'Hermes 更新会迁移配置、更新依赖并可能重启服务。查询源为 stable，当前安装可能为 canary/自定义通道；不切换原通道，执行后以重新探测版本为准。' },
  opencode: { argv: ['upgrade'], pinsVersion: false },
  qoder: { argv: ['update'], pinsVersion: false },
  qodercn: { argv: ['update'], pinsVersion: false },
  codebuddy: { argv: ['update'], pinsVersion: false },
  traecn: { argv: ['update', '--channel', '%CHANNEL%', '--version', '%VERSION%'], pinsVersion: true },
}
for (const [cli, update] of Object.entries(NATIVE_UPDATES)) {
  if (!update.script) CLI_SOURCES[cli as ActiveCliId].update = update.argv
}
export const isDesktopCli = (cli: ActiveCliId): cli is 'zcode' | 'workbuddycn' | 'workbuddy' => ['zcode', 'workbuddycn', 'workbuddy'].includes(cli)
export function installOffer(cli: ActiveCliId): CliInstallOffer {
  const s = CLI_SOURCES[cli]
  return { method: s.install, defaultLocation: s.defaultLocation, selectableLocation: ['zcode', 'workbuddycn', 'workbuddy'].includes(cli), guideUrl: s.guideUrl, scriptUrl: s.scriptUrl, experimental: s.experimental,
    prerequisites: s.prerequisites.map(p => ({ ...p, satisfied: false })) }
}

/** Audited account projections read local files only; no native discovery or renewal. */
export const BACKGROUND_ACCOUNT_CLIS: readonly ActiveCliId[] = ['mimo', 'codebuddy', 'zcode', 'grok', 'pi', 'omp', 'opencode']

/** Audited official --binary/offline-install interfaces; never client supplied. */
export const OFFICIAL_SIGNED_ARTIFACT_HOSTS = ['release-assets.githubusercontent.com', 'd4c085d38fe197a3f20bbeb20222b8b3.r2.cloudflarestorage.com'] as const
export const LOCAL_INSTALLERS = {
  omp: { script: 'https://omp.sh/install', base: 'https://build.stencil.so', entry: '.local/bin/omp' },
  opencode: { script: 'https://opencode.ai/install', base: 'https://github.com/anomalyco/opencode/releases/download', archive: 'opencode', entry: '.opencode/bin/opencode' },
  mimo: { script: 'https://mimo.xiaomi.com/install', base: MIMO_RELEASE_SOURCES[0]!.slice(0, -1), sources: MIMO_RELEASE_SOURCES, policy: MIMO_SOURCE_POLICY, archive: 'mimocode', entry: '.mimocode/bin/mimo' },
} as const

export interface InstallSource {
  method: 'npm' | 'script' | 'desktop' | 'manual'
  command: string
  nodeMinimum?: string
  script?: { url: string; interpreter: readonly string[]; relativeEntry: string }
  desktop?: { url: string; integrity?: string; bytes?: number; appName: string; relativeEntry: string; teamId: string; version: string; commonDirectories?: readonly string[] }
  reason?: string
}
/** PRD 5.3 evidence only. Missing feeds/flags/runtime guarantees are not inferred. */
export function installationSource(cli: ActiveCliId, platform = process.platform): InstallSource {
  const command = ({ antigravity: 'agy', qoder: 'qodercli', qodercn: 'qoderclicn', traecn: 'traecli' } as Partial<Record<ActiveCliId, string>>)[cli] ?? cli
  const manual = (reason: string): InstallSource => ({ method: 'manual', command, reason })
  if (['zcode', 'workbuddycn', 'workbuddy'].includes(cli)) return manual('官方安装包地址、摘要或长度及开发者身份尚未核实，请按官方说明安装')
  if (cli === 'antigravity') return manual('脚本的运行时前置条件与首次安装流程尚未核实')
  if (cli === 'omp' || cli === 'hermes') return manual('安装脚本可能代装运行时，尚无已核实的禁止代装参数；请按官方说明安装')
  if (cli === 'grok') return manual('官方脚本首次安装流程尚待核实，请按官方说明安装')
  if (cli === 'claude' || cli === 'mimo' && platform !== 'win32') return manual('官方脚本首次安装流程尚待重新核实，本轮只补齐已有安装的版本检查，请按官方说明安装')
  if (cli === 'codex' || cli === 'pi' || cli === 'codebuddy' || platform === 'win32' && (cli === 'mimo' || cli === 'opencode'))
    return { method: 'npm', command, nodeMinimum: cli === 'pi' ? '22.19.0' : cli === 'codebuddy' ? '18.20.0' : cli === 'mimo' ? '18.0.0' : undefined }
  if (cli === 'opencode') return manual('官方脚本没有已核实的精确 V1 选择参数，不能保证只安装已适配代际')
  const scripts: Partial<Record<ActiveCliId, [string, string, string]>> = {
    claude: ['https://claude.ai/install.sh', 'https://claude.ai/install.ps1', '.local/bin/claude'],
    kimi: ['https://cdn.kimi.com/kimi-code/install.sh', 'https://cdn.kimi.com/kimi-code/install.ps1', '.kimi-code/bin/kimi'],
    mimo: ['https://mimo.xiaomi.com/install', '', '.mimocode/bin/mimo'],
    qoder: ['https://qoder.com/install', 'https://qoder.com/install.ps1', '.qoder/bin/qodercli'],
    qodercn: ['https://static.qoder.com.cn/qoder-cli-cn/install.sh', 'https://static.qoder.com.cn/qoder-cli-cn/install.ps1', '.qoder-cn/bin/qoderclicn'],
    traecn: ['https://trae.cn/trae-cli/install_v2.sh', 'https://trae.cn/trae-cli/install_v2.ps1', '.local/bin/traecli'],
  }
  if ((cli === 'qoder' || cli === 'qodercn') && platform !== 'win32') return manual('macOS 官方脚本的默认入口尚未核实')
  if (cli === 'traecn' && platform === 'win32') return manual('Windows 官方脚本默认入口尚未核实')
  const script = scripts[cli]
  if (!script || platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') return manual('此平台的官方安装方法尚未核实')
  const relativeEntry = cli === 'qoder' || cli === 'qodercn'
    ? relative(homedir(), windowsCliCandidates(cli)[0]!) : script[2]
  return { method: 'script', command, script: { url: platform === 'win32' ? script[1] : script[0], interpreter: platform === 'win32' ? ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] : ['/bin/bash'], relativeEntry } }
}

/** ZCode reads its native files and GET model lists; no CLI session or renewal. */
export const BACKGROUND_CATALOG_CLIS: readonly ActiveCliId[] = ['zcode']
