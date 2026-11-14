import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { safeObservation } from './artifacts/observations.ts'

/** Only loose tag objects are decoded. Packed objects without a peeled ref are
 * unknown; do not run Git/Hermes or mistake a tag object's SHA for its commit. */
async function peelLooseTag(git: string, object: string): Promise<string | undefined> {
  const seen = new Set<string>(), limit = 64 * 1024
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(object)) return
    seen.add(object)
    const path = join(git, 'objects', object.slice(0, 2), object.slice(2))
    try {
      for (let p = dirname(path); ; p = dirname(p)) {
        const s = await lstat(p)
        if (!s.isDirectory() || s.isSymbolicLink()) return
        if (dirname(p) === p) break
      }
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let decoded: Buffer
      try {
        const s = await file.stat()
        if (!s.isFile() || s.nlink !== 1 || s.size > limit) return
        const compressed = Buffer.alloc(s.size)
        const { bytesRead } = await file.read(compressed, 0, compressed.length, 0)
        if (bytesRead !== s.size) return
        decoded = inflateSync(compressed, { maxOutputLength: limit })
      } finally { await file.close() }
      if (createHash('sha1').update(decoded).digest('hex') !== object) return
      const separator = decoded.indexOf(0)
      if (separator < 0 || decoded.subarray(0, separator).toString('ascii') !== `tag ${decoded.length - separator - 1}`) return
      const target = /^object ([a-f0-9]{40})\ntype (commit|tag)\n/.exec(decoded.subarray(separator + 1).toString('utf8'))
      if (!target) return
      if (target[2] === 'commit') return target[1]
      object = target[1]!
    } catch { return }
  }
}

/** A source update may move HEAD before rewriting install-stamp. Only an exact
 * local stable tag proves a different version; never use pyproject's placeholder,
 * a nearest tag, or run Hermes (which can resume the interrupted update). */
export async function hermesCheckoutVersion(checkout: string, stampCommit: unknown): Promise<{ version: string; commit: string } | undefined> {
  const git = join(checkout, '.git')
  const head = (await safeObservation(join(git, 'HEAD'), 4096))?.text.trim()
  if (!head) return
  const sha = /^[a-f0-9]{40}$/i, tag = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/
  const packed = new Map<string, string>()
  let previous: string | undefined
  for (const line of ((await safeObservation(join(git, 'packed-refs'), 4 * 1024 * 1024))?.text ?? '').split(/\r?\n/)) {
    const ref = /^([a-f0-9]{40}) (refs\/.+)$/.exec(line)
    if (ref) { packed.set(ref[2]!, ref[1]!); previous = ref[2] }
    else if (previous && /^\^[a-f0-9]{40}$/.test(line)) { packed.set(previous, line.slice(1)); previous = undefined }
    else previous = undefined
  }
  let commit = sha.test(head) ? head.toLowerCase() : undefined
  const symbolic = /^ref: (refs\/heads\/[A-Za-z0-9_./-]+)$/.exec(head)?.[1]
  if (!commit && symbolic && !symbolic.split('/').some(p => !p || p === '.' || p === '..')) {
    const loose = (await safeObservation(join(git, symbolic), 4096))?.text.trim()
    commit = loose && sha.test(loose) ? loose.toLowerCase() : packed.get(symbolic)
  }
  if (!commit || commit === stampCommit) return
  const tags = join(git, 'refs/tags'), info = await lstat(tags).catch(() => undefined)
  if (info?.isDirectory() && !info.isSymbolicLink()) {
    const names = (await readdir(tags)).filter(name => tag.test(name))
    if (names.length > 256) return
    for (const name of names) {
      const value = (await safeObservation(join(tags, name), 4096))?.text.trim()
      // A loose tag overrides a packed one, even when it is annotated/unknown.
      packed.delete(`refs/tags/${name}`)
      if (value && sha.test(value)) packed.set(`refs/tags/${name}`, value.toLowerCase())
    }
  }
  const candidates = [...packed].filter(([ref]) => ref.startsWith('refs/tags/') && tag.test(ref.slice(10)))
  if (candidates.length > 256) return
  const versions: string[] = []
  for (const [ref, value] of candidates) {
    if (value === commit || await peelLooseTag(git, value) === commit) versions.push(ref.slice(11))
  }
  if (versions.length !== 1) return
  // HEAD must not have moved while refs were being inspected.
  if ((await safeObservation(join(git, 'HEAD'), 4096))?.text.trim() !== head) return
  if (symbolic) {
    const loose = (await safeObservation(join(git, symbolic), 4096))?.text.trim()
    if (loose && loose.toLowerCase() !== commit) return
  }
  return { version: versions[0]!, commit }
}
