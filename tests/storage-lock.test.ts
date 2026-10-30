import { afterEach, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkerStorage } from '../src/host/storage.ts'

// Simulated stores only: lock files are written by this test with synthetic PIDs.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function store() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-storage-lock-SIMULATED-')))
  roots.push(root)
  const directory = join(root, 'state')
  mkdirSync(directory, { mode: 0o700 })
  return directory
}
/** A PID that has certainly exited (our own short-lived child). */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!
const locks = (directory: string) => readdirSync(directory).filter((name) => name.startsWith('host.lock')).sort()

it('reclaims a stale legacy lock and stale claims, then releases only its own files', () => {
  const directory = store()
  const staleClaim = `host.lock.${randomUUID()}`
  writeFileSync(join(directory, 'host.lock'), JSON.stringify({ pid: deadPid(), token: 'old' }), { mode: 0o600 })
  writeFileSync(join(directory, staleClaim), JSON.stringify({ pid: deadPid(), token: 'old-claim' }), { mode: 0o600 })
  const storage = new WorkerStorage(directory)
  const owned = locks(directory)
  expect(owned).toHaveLength(2)
  expect(owned).not.toContain(staleClaim)
  const legacy = JSON.parse(readFileSync(join(directory, 'host.lock'), 'utf8'))
  expect(legacy.pid).toBe(process.pid)
  if (process.platform !== 'win32')
    for (const name of owned) expect(statSync(join(directory, name)).mode & 0o777).toBe(0o600)
  storage.close()
  expect(locks(directory)).toEqual([])
})

it('never deletes a live claim published by another Host while reclaiming a stale legacy lock', () => {
  const directory = store()
  // Another Host already reclaimed: its claim is live, the legacy file is stale.
  const liveClaim = `host.lock.${randomUUID()}`
  writeFileSync(join(directory, 'host.lock'), JSON.stringify({ pid: deadPid(), token: 'old' }), { mode: 0o600 })
  writeFileSync(join(directory, liveClaim), JSON.stringify({ pid: process.ppid, token: 'other' }), { mode: 0o600 })
  expect(() => new WorkerStorage(directory)).toThrow('already owned')
  expect(locks(directory)).toEqual(['host.lock', liveClaim])
})

it('reclaims locks whose PID now runs a process started after the lock was written', () => {
  const directory = store()
  // SIMULATED PID reuse: a running PID (our parent) named by lock files dated a week
  // before it started, as when Windows hands an exited Host's PID to a new process.
  const claim = `host.lock.${randomUUID()}`
  const written = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  for (const name of ['host.lock', claim]) {
    writeFileSync(join(directory, name), JSON.stringify({ pid: process.ppid, token: 'reused' }), { mode: 0o600 })
    utimesSync(join(directory, name), written, written)
  }
  const storage = new WorkerStorage(directory)
  const owned = locks(directory)
  expect(owned).toHaveLength(2)
  expect(owned).not.toContain(claim)
  expect(JSON.parse(readFileSync(join(directory, 'host.lock'), 'utf8')).pid).toBe(process.pid)
  storage.close()
  expect(locks(directory)).toEqual([])
})

it('refuses an unreadable claim without removing it', () => {
  const directory = store()
  const claim = `host.lock.${randomUUID()}`
  writeFileSync(join(directory, claim), 'not json', { mode: 0o600 })
  expect(() => new WorkerStorage(directory)).toThrow(`inspect ${claim}`)
  expect(locks(directory)).toEqual([claim])
})

it('lets at most one of several concurrently starting Hosts own a store with a stale lock', async () => {
  const directory = store()
  writeFileSync(join(directory, 'host.lock'), JSON.stringify({ pid: deadPid(), token: 'old' }), { mode: 0o600 })
  // A file URL, not a path: Windows ESM rejects drive-letter paths as import specifiers.
  const module = new URL('../src/host/storage.ts', import.meta.url).href
  // Each contender holds the store long enough to overlap all others.
  const script = `
    const { WorkerStorage } = await import(${JSON.stringify(module)})
    let storage
    try { storage = new WorkerStorage(process.argv[1]) } catch (error) { console.log('refused:' + error.message); process.exit(0) }
    console.log('owned')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    storage.close()
  `
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--experimental-transform-types', '--no-warnings', '--input-type=module', '-e', script, directory],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = '',
        errors = ''
      child.stdout.on('data', (chunk) => (output += chunk))
      child.stderr.on('data', (chunk) => (errors += chunk))
      child.once('error', reject)
      child.once('close', (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))))
    })
  const results = await Promise.all(Array.from({ length: 6 }, run))
  const owners = results.filter((result) => result === 'owned').length
  expect(owners).toBeLessThanOrEqual(1)
  for (const result of results) expect(result).toMatch(/^(owned|refused:CLI Worker store is already owned)/)
  // A winner reclaimed and then released the store; if every contender withdrew
  // the stale legacy file is left untouched.
  expect(locks(directory)).toEqual(owners ? [] : ['host.lock'])
}, 30_000)
