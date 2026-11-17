import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { workbuddyVariant } from '../workbuddy-variant.ts'
import type { ActiveCliId } from '../../shared/types.ts'

/** Installation artifacts only: config/account directories alone do not establish presence.
 * Keep independent of first-install offers. Layout evidence: identity.ts, artifacts/native.ts,
 * windows-cli-installation.ts, codebuddy-native-layout.ts and desktop sources. */
export function knownInstallationPaths(cli: ActiveCliId, platform = process.platform, home = homedir(), env = process.env): string[] {
  const h = (p: string) => join(home, p)
  const local = env.LOCALAPPDATA || h('AppData/Local'), data = env.XDG_DATA_HOME || h('.local/share')
  const unix: Record<ActiveCliId, string[]> = {
    antigravity: [h('.local/bin/agy')],
    codex: [h('.codex/packages/standalone'), ...(env.CODEX_HOME ? [join(env.CODEX_HOME, 'packages/standalone')] : []), h('.local/bin/codex'), ...(env.CODEX_INSTALL_DIR ? [join(env.CODEX_INSTALL_DIR, 'codex')] : [])],
    claude: [h('.local/share/claude/versions'), join(data, 'claude/versions'), h('.local/bin/claude'), h('.local/bin/claude.exe')],
    kimi: [h('.kimi-code/bin'), ...(env.KIMI_INSTALL_DIR ? [join(env.KIMI_INSTALL_DIR, 'bin/kimi'), join(env.KIMI_INSTALL_DIR, 'bin/kimi.exe')] : [])], mimo: [h('.mimocode/bin'), h('.mimocode/package.json'), h('.local/bin/mimo'), ...(env.MIMOCODE_INSTALL_DIR ? [join(env.MIMOCODE_INSTALL_DIR, 'mimo.exe')] : [])],
    zcode: [h('Applications/ZCode.app'), '/Applications/ZCode.app'],
    grok: [h('.grok/bin'), h('.grok/downloads'), ...(env.GROK_BIN_DIR ? [join(env.GROK_BIN_DIR, 'grok'), join(env.GROK_BIN_DIR, 'grok.exe')] : [])],
    omp: [h('.local/bin/omp'), ...(env.PI_INSTALL_DIR ? [join(env.PI_INSTALL_DIR, 'omp')] : []), join(env.BUN_INSTALL || h('.bun'), 'bin/omp'), join(env.BUN_INSTALL || h('.bun'), 'install/global/node_modules/@oh-my-pi/pi-coding-agent')],
    pi: [h('.pi/agent/install'), h('.pi/agent/bin'), ...(env.PI_MANAGED_INSTALL_ROOT ? [env.PI_MANAGED_INSTALL_ROOT] : []), ...(env.PI_CODING_AGENT_DIR ? [join(env.PI_CODING_AGENT_DIR, 'install'), join(env.PI_CODING_AGENT_DIR, 'bin')] : [])],
    hermes: [h('.hermes/hermes-agent'), ...(env.HERMES_INSTALL_DIR ? [join(env.HERMES_INSTALL_DIR, 'install-stamp.json'), join(env.HERMES_INSTALL_DIR, 'pyproject.toml')] : []), ...(env.HERMES_HOME ? [join(env.HERMES_HOME, 'hermes-agent'), join(env.HERMES_HOME, 'install-stamp.json')] : [])],
    opencode: [h('.opencode/bin')],
    qoder: [h('.qoder/bin'), h('.qoder/entry')], qodercn: [h('.qoder-cn/bin'), h('.qoder-cn/entry')],
    codebuddy: [h('.local/share/codebuddy'), join(data, 'codebuddy'), h('.local/bin/codebuddy')],
    traecn: [h('.local/share/traecli'), h('.local/bin/traecli')],
    workbuddycn: [h('Applications'), '/Applications'].flatMap(root => workbuddyVariant('workbuddycn').macAppNames.map(name => join(root, name))),
    workbuddy: [h('Applications'), '/Applications'].flatMap(root => workbuddyVariant('workbuddy').macAppNames.map(name => join(root, name))),
  }
  const programs = [join(local, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter((p): p is string => !!p)
  const windows: Partial<Record<ActiveCliId, string[]>> = {
    antigravity: [join(local, 'agy')], omp: [join(local, 'omp')],
    hermes: [join(local, 'hermes')], codebuddy: [join(local, 'codebuddy')],
    traecn: [join(local, 'TraeCLI'), join(local, 'Programs/TraeCLI')],
    zcode: programs.map(root => join(root, 'ZCode')),
    workbuddycn: programs.flatMap(root => workbuddyVariant('workbuddycn').windowsDirectoryNames.map(name => join(root, name))),
    workbuddy: programs.flatMap(root => workbuddyVariant('workbuddy').windowsDirectoryNames.map(name => join(root, name))),
  }
  return [...new Set([...unix[cli].filter(p => platform === 'darwin' || !p.endsWith('.app')), ...(platform === 'win32' ? windows[cli] ?? [] : [])])].filter(isAbsolute)
}
