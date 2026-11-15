import { homedir } from 'node:os'
import { posix } from 'node:path'
import { valid } from 'semver'

// Official 2.184.0 InstallEnv / InstallService: exact binary entries only.
// A version directory is storage, not evidence of the currently running version.
const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const slash = (path: string) => path.replace(/\\/g, '/')
const windowsPath = (path: string) => /^[A-Za-z]:\//.test(path)
const clean = (path: string) => !/[\0\r\n]/.test(path) && !path.split('/').some(p => p === '.' || p === '..')

/** Identities already establish root ownership; compare only the official entries within it. */
export function codebuddyEntryAtRoot(path: string, root: string): { root: string; stableEntry: string; versioned: boolean } | undefined {
  const p = slash(path), r = slash(root), win = windowsPath(r)
  if (!clean(p) || !clean(r) || !(win || r.startsWith('/')) || (!win && path.includes('\\'))) return
  if (!(win ? r.toLowerCase() : r).endsWith('/codebuddy')) return
  const stableEntry = win ? `${r}/bin/codebuddy.exe` : posix.join(r, '../../bin/codebuddy')
  const fold = (value: string) => win ? value.toLowerCase() : value
  if (fold(p) === fold(stableEntry)) return { root: r, stableEntry, versioned: false }
  const prefix = `${r}/${win ? 'Data/' : ''}versions/`
  if (!fold(p).startsWith(fold(prefix))) return
  const parts = p.slice(prefix.length).split('/')
  if (parts.length === 2 && version.test(parts[0]!) && valid(parts[0]!) && fold(parts[1]!) === (win ? 'codebuddy.exe' : 'codebuddy'))
    return { root: r, stableEntry, versioned: true }
}

/** No substring ownership, legacy .codebuddy/bin guess, or WorkBuddy embedded CLI. */
export function codebuddyNativeLayout(path: string, home = homedir(), env: NodeJS.ProcessEnv = process.env) {
  const h = slash(home), win = windowsPath(h)
  const override = win ? env.LOCALAPPDATA : env.XDG_DATA_HOME
  const base = override ? slash(override) : `${h}/${win ? 'AppData/Local' : '.local/share'}`
  if (!clean(base) || (win ? !windowsPath(base) : !base.startsWith('/'))) return
  return codebuddyEntryAtRoot(path, `${base.replace(/\/$/, '')}/codebuddy`)
}
