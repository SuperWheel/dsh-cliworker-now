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
  compatibility: 'any' | 'pi' | 'opencode-v1'
  version: 'manifest' | 'kimi' | 'traecn' | 'workbuddy' | 'unknown'
  /** Only verified file reads and Kimi's explicitly suppressed version query. */
  backgroundSafe: boolean
  install: CliInstallOffer['method']
  scriptUrl?: string
  experimental?: boolean
}
const base = { prerequisites: [], compatibility: 'any', version: 'manifest', backgroundSafe: true, install: 'manual' } as const
/** PRD 5.3: URLs are documentation, never arbitrary installation commands.
 * Unverified installers/feeds remain manual. No command in this table runs in phase A. */
export const CLI_SOURCES: Record<ActiveCliId, CliSource> = {
  antigravity: { ...base, version: 'unknown', backgroundSafe: false, defaultLocation: '~/.local/bin/agy · Windows: %LOCALAPPDATA%\\agy\\bin', guideUrl: 'https://antigravity.google/cli', scriptUrl: 'https://antigravity.google/cli/install.sh' },
  codex: { ...base, npm: '@openai/codex', brew: { name: 'codex', kind: 'cask' }, defaultLocation: 'npm 全局前缀（脚本落点待核实）', prerequisites: [{ name: 'Node.js', required: '随目标包核实' }], guideUrl: 'https://developers.openai.com/codex/cli/', install: 'npm' },
  claude: { ...base, npm: '@anthropic-ai/claude-code', brew: { name: 'claude-code', kind: 'cask' }, update: ['update'], defaultLocation: '~/.local/bin/claude', prerequisites: [{ name: 'Node.js（npm）', required: '≥ 22' }], guideUrl: 'https://code.claude.com/docs/en/setup', scriptUrl: 'https://claude.ai/install.sh' },
  kimi: { ...base, npm: '@moonshot-ai/kimi-code', version: 'kimi', defaultLocation: '~/.kimi-code/bin/kimi（待复核）', prerequisites: [{ name: 'Node.js（npm）', required: '≥ 22.19' }, { name: 'Git Bash（Windows）', required: '已安装' }], guideUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html', scriptUrl: 'https://code.kimi.com/kimi-code/install.sh' },
  mimo: { ...base, npm: '@mimo-ai/cli', defaultLocation: '~/.mimocode/bin/mimo · Windows: npm 全局前缀', prerequisites: [{ name: 'Node.js（Windows npm）', required: '≥ 18' }], guideUrl: 'https://mimo.mi.com/docs/en-US/tokenplan/integration/mimo-code', scriptUrl: 'https://mimo.xiaomi.com/install' },
  zcode: { ...base, defaultLocation: '/Applications/ZCode.app · Windows: 待核实', guideUrl: 'https://zcode.z.ai/en/docs/install' },
  grok: { ...base, version: 'unknown', backgroundSafe: false, update: ['update'], defaultLocation: '~/.grok/bin/grok', guideUrl: 'https://x.ai/cli', scriptUrl: 'https://x.ai/cli/install.sh' },
  omp: { ...base, npm: '@oh-my-pi/pi-coding-agent', defaultLocation: 'Bun 全局 bin（官方脚本落点待核实）', prerequisites: [{ name: 'Bun（Bun 安装）', required: '≥ 1.4.4' }], guideUrl: 'https://github.com/can1357/oh-my-pi', scriptUrl: 'https://omp.sh/install' },
  pi: { ...base, npm: '@earendil-works/pi-coding-agent', compatibility: 'pi', update: ['update'], defaultLocation: '~/.local/bin/pi · ~/.pi/agent/bin', prerequisites: [{ name: 'Node.js', required: '≥ 22.19' }], guideUrl: 'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md', install: 'npm' },
  hermes: { ...base, version: 'unknown', backgroundSafe: false, defaultLocation: '~/.hermes/hermes-agent · Windows: %LOCALAPPDATA%\\hermes', prerequisites: [{ name: 'Git / curl / tar', required: '已安装' }], guideUrl: 'https://nousresearch.github.io/hermes-agent/docs/getting-started/updating/', scriptUrl: 'https://hermes-agent.nousresearch.com/install.sh' },
  opencode: { ...base, npm: 'opencode-ai', brew: { name: 'opencode', kind: 'formula', tap: 'anomalyco/tap' }, compatibility: 'opencode-v1', update: ['upgrade'], defaultLocation: '随原安装方式（脚本落点待核实）', guideUrl: 'https://dev.opencode.ai/v1/docs/cli/', scriptUrl: 'https://opencode.ai/install' },
  qoder: { ...base, npm: '@qoder-ai/qodercli', update: ['update'], defaultLocation: 'Windows: ~/.qoder/bin/qodercli · macOS: 待核实', prerequisites: [{ name: 'Node.js（旧 npm）', required: '≥ 20.0.0' }, { name: 'Windows 架构', required: '非 ARM64' }], guideUrl: 'https://docs.qoder.com/cli/installation', scriptUrl: 'https://qoder.com/install' },
  qodercn: { ...base, npm: '@qodercn-ai/qoderclicn', update: ['update'], defaultLocation: 'Windows: ~/.qoder-cn/bin/qoderclicn · macOS: 待核实', prerequisites: [{ name: 'Node.js（旧 npm）', required: '≥ 20.18.1' }, { name: 'Windows 架构', required: '非 ARM64' }], guideUrl: 'https://docs.qoder.cn/cli/installation', scriptUrl: 'https://static.qoder.com.cn/qoder-cli-cn/install.sh' },
  codebuddy: { ...base, npm: '@tencent-ai/codebuddy-code', brew: { name: 'codebuddy-code', kind: 'formula', tap: 'Tencent-CodeBuddy/tap' }, update: ['update'], defaultLocation: 'npm 全局前缀', prerequisites: [{ name: 'Node.js', required: '≥ 18.20' }], guideUrl: 'https://www.codebuddy.cn/docs/cli/installation', install: 'npm' },
  traecn: { ...base, version: 'traecn', backgroundSafe: false, update: ['update'], defaultLocation: '~/.local/bin/traecli → ~/.local/share/traecli/current · Windows: 待验收', prerequisites: [{ name: '网络', required: 'trae.cn 可直连' }], guideUrl: 'https://docs.trae.cn/cli_command-line-parameters', scriptUrl: 'https://trae.cn/trae-cli/install_v2.sh' },
  workbuddycn: { ...base, version: 'workbuddy', defaultLocation: '/Applications/WorkBuddy.app · Windows: 待核实', prerequisites: [{ name: '系统', required: 'macOS ≥ 12 / Windows ≥ 10' }], guideUrl: 'https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide', experimental: true },
  workbuddy: { ...base, version: 'workbuddy', defaultLocation: '/Applications/WorkBuddy AI.app · Windows: 待核实', prerequisites: [{ name: '系统', required: 'macOS ≥ 12 / Windows ≥ 10' }], guideUrl: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide', experimental: true },
}
export function installOffer(cli: ActiveCliId): CliInstallOffer {
  const s = CLI_SOURCES[cli]
  return { method: s.install, defaultLocation: s.defaultLocation, selectableLocation: ['zcode', 'workbuddycn', 'workbuddy'].includes(cli), guideUrl: s.guideUrl, scriptUrl: s.scriptUrl, experimental: s.experimental,
    prerequisites: s.prerequisites.map(p => ({ ...p, satisfied: false })) }
}

/** Audited account projections read local files only; no native discovery or renewal. */
export const BACKGROUND_ACCOUNT_CLIS: readonly ActiveCliId[] = ['mimo', 'codebuddy']

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
  if (cli === 'antigravity') return manual('脚本的运行时前置条件和安装后版本读法尚未核实')
  if (cli === 'omp' || cli === 'hermes') return manual('安装脚本可能代装运行时，尚无已核实的禁止代装参数；请按官方说明安装')
  if (cli === 'grok') return manual('安装后无副作用的版本读法尚未核实')
  if (cli === 'claude' || cli === 'mimo' && platform !== 'win32') return manual('官方原生安装的清单/版本目录语义及无副作用版本读法尚未核实，请按官方说明安装')
  if (cli === 'codex' || cli === 'pi' || cli === 'codebuddy' || platform === 'win32' && (cli === 'mimo' || cli === 'opencode'))
    return { method: 'npm', command, nodeMinimum: cli === 'pi' ? '22.19.0' : cli === 'codebuddy' ? '18.20.0' : cli === 'mimo' ? '18.0.0' : undefined }
  if (cli === 'opencode') return manual('官方脚本没有已核实的精确 V1 选择参数，不能保证只安装已适配代际')
  const scripts: Partial<Record<ActiveCliId, [string, string, string]>> = {
    claude: ['https://claude.ai/install.sh', 'https://claude.ai/install.ps1', '.local/bin/claude'],
    kimi: ['https://code.kimi.com/kimi-code/install.sh', 'https://code.kimi.com/kimi-code/install.ps1', '.kimi-code/bin/kimi'],
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
