import { homedir } from 'node:os'
import type { CliId } from '../shared/types.ts'
import { codebuddyNativeLayout } from './codebuddy-native-layout.ts'

/** Only evidenced managed version layouts qualify. Never apply to manual paths. */
export function isVersionedAutoEntry(cli: CliId, path: string, home = homedir()): boolean {
  if (cli === 'codebuddy' && codebuddyNativeLayout(path, home)?.versioned) return true
  const p = path.replace(/\\/g, '/'), h = home.replace(/\\/g, '/')
  const relative = p.startsWith(h + '/') ? p.slice(h.length + 1) : ''
  const layouts: Partial<Record<CliId, RegExp>> = {
    pi: /^\.pi\/agent\/install\/releases\/[^/]+\//,
    codex: /^\.codex\/packages\/standalone\/releases\/[^/]+\//,
    claude: /^\.local\/share\/claude\/versions\/[^/]+(?:\/|$)/,
    grok: /^\.grok\/downloads\/grok-[^/]+(?:\/|$)/,
    traecn: /^(?:\.local\/share\/traecli|AppData\/Local\/TraeCLI)\/releases\/[^/]+\//,
    qoder: /^\.qoder\/bin\/qodercli\/qodercli-[^/]+(?:\/|$)/,
    qodercn: /^\.qoder-cn\/bin\/qoderclicn\/qoderclicn-[^/]+(?:\/|$)/,
  }
  if (layouts[cli]?.test(relative)) return true
  const brew: Partial<Record<CliId, string>> = { codex: 'codex', claude: 'claude-code', opencode: 'opencode', codebuddy: 'codebuddy-code' }
  const match = /\/(?:Cellar|Caskroom)\/([^/]+)\/[^/]+\//.exec(p)
  return !!match && brew[cli] === match[1]
}
