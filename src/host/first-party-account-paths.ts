import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Shared by account readers and installation directory protection. No account reads. */
export const codexConfigDirectory = (env = process.env, home = homedir()) => resolve(env.CODEX_HOME?.trim() || join(home, '.codex'))
export const claudeConfigDirectory = (env = process.env, home = homedir()) => env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude')
