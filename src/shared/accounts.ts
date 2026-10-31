import type { CliId } from './types.ts'

export type AccountAction = 'login' | 'logout' | 'manage'
export type AccountSource = 'native' | 'plugin'
/** Explicit ZCode native login provider; unrelated to logout storage sources. */
export type ZCodeLoginProvider = 'bigmodel' | 'zai'
export interface AccountActionDescriptor {
  id: AccountAction
  label: string
  description: string
  target?: 'models'
  /** Logout applies only to the selected source, never all visible accounts. */
  sources?: { id: AccountSource; label: string }[]
  /** Login targets for the window's provider picker, checked against the installed CLI. */
  providers?: AccountProvider[]
}
/** A provider the login window may sign in to; ids are Host-defined, never URLs. */
export interface AccountProvider {
  id: string
  label: string
  /** The provider already holds a login of this CLI. */
  signedIn?: boolean
  /** The CLI keeps several credentials for this provider (add or replace). */
  multi?: boolean
}
/** Safe display projection of one authenticated provider; never raw credentials or route URLs. */
export interface AccountLogin {
  providerLabel: string
  authMethod: 'oauth' | 'api'
  /** Optional safe account email for OAuth only; API identities must never be displayed. */
  accountLabel?: string
  /** Opaque Host handle for signing out exactly this login; absent when it cannot be removed alone. */
  id?: string
  /** Where the login is stored, for CLIs that keep native and plugin accounts. */
  source?: AccountSource
  /** Logins that the native CLI only removes together share a group. */
  group?: string
}
export interface AccountStatus {
  cli: CliId
  installed: boolean
  /** unconfigured is absence; unauthenticated is known invalid/expired auth; unavailable is a read/config error. */
  state: 'authenticated' | 'unconfigured' | 'unauthenticated' | 'configured' | 'unknown' | 'unavailable'
  summary: string
  /** Display-only identity; never a token, API key, or key prefix. */
  authMethod?: 'oauth' | 'api'
  accountLabel?: string
  /** Each current provider retains its own login method. Absent on older Hosts. */
  logins?: AccountLogin[]
  /** A CLI status report or local session metadata, not a remote credential check. */
  verification?: 'cli' | 'local'
  /** Paused after an unconfirmed process cleanup; the user may release it from settings. Absent on older Hosts. */
  cleanupBlocked?: boolean
  actions: AccountActionDescriptor[]
}
/** How the plugin draws a step of its own sign-in window. */
export type AccountTemplate =
  | 'starting'
  | 'trust'
  /** A CLI's own terms screen: agree, and an optional data-sharing choice that starts unticked. */
  | 'terms'
  | 'choice'
  | 'browser'
  | 'browserCode'
  | 'deviceCode'
  | 'secret'
  | 'waiting'
  | 'result'
  | 'native'
/** A Host-labelled choice of a native menu; the label is plugin text, not CLI output. */
export interface AccountGuideOption {
  id: string
  label: string
  detail?: string
}
/** A Host-authored step hint for an account terminal; never CLI output. */
export interface AccountGuide {
  step: string
  tone: 'info' | 'action' | 'success' | 'warning'
  text: string
  /** A native sign-in page on the CLI's allowlisted https hosts. */
  link?: string
  /** Absent on older Hosts, which only guide Antigravity. */
  template?: AccountTemplate
  /** Host-authored titles of the whole sign-in, and the one this step belongs to. */
  plan?: string[]
  stage?: number
  /** A one-time device code to enter on the sign-in page; never a secret the user typed. */
  code?: string
  options?: AccountGuideOption[]
}
/** The user's answer to the current step; Host turns it into the CLI's own keys. */
export type AccountResponse =
  | { option: string }
  | { code: string }
  | { secret: string }
  | { confirm: 'trust' | 'decline' }
  | { agree: 'terms'; share: boolean }
/** How a login treats a provider that is already signed in. */
export type AccountLoginMode = 'add' | 'replace'
export interface AccountStartOptions {
  provider?: string
  mode?: AccountLoginMode
  /** One login of the account window to sign out (`AccountLogin.id`). */
  login?: string
  source?: AccountSource
}
/** Ephemeral, user-operated terminal transport; never stored with worker events. */
export interface AccountFrame {
  seq: number
  data?: string
  status?: 'running' | 'closed' | 'failed'
  message?: string
  /** Current guide; absent on older Hosts and for CLIs without one. */
  guide?: AccountGuide
  /** Host has confirmed process-range exit and released account resources. */
  cleanupConfirmed?: boolean
}
