import { createHmac, randomBytes } from 'node:crypto'
import type { AccountLogin } from '../../shared/accounts.ts'

// Host-only, process-local evidence. Neither credentials nor fingerprints are
// properties of public account rows, so serialization cannot disclose them.
const secret = randomBytes(32)
const fingerprints = new WeakMap<AccountLogin, string>()

/** Called only for a validated native login, using credential fields, not file metadata. */
export function rememberLoginCredential<T extends AccountLogin>(login: T, material: readonly unknown[]): T {
  fingerprints.set(login, createHmac('sha256', secret).update(JSON.stringify(material)).digest('hex'))
  return login
}

export function loginCredentialChanged(before: AccountLogin, after: AccountLogin): boolean {
  const previous = fingerprints.get(before), current = fingerprints.get(after)
  return previous !== undefined && current !== undefined && previous !== current
}
