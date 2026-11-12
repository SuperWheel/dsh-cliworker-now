import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { applyPlan, collectReferences, parseArgs, parseDuration, planClean, targetTag } from '../scripts/clean.mjs'

const DAY = 86_400_000
const now = Date.now()
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

type Item = { path: string; action: 'keep' | 'remove'; reason: string; bytes: number }

/** Synthetic repository; every file here is a test fixture, not real evidence. */
function repository(target = '0.2.2-rc.1') {
  const root = mkdtempSync(join(tmpdir(), 'cliworker-clean-test-'))
  roots.push(root)
  file(root, 'package.json', JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': target } }))
  file(root, 'lib/index.js', 'synthetic build output')
  file(root, 'node_modules/dep/index.js', 'synthetic dependency')
  file(root, 'doc/local/runbook.md', 'synthetic private note')
  return root
}
function file(root: string, path: string, content = 'synthetic') {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
/** Sets every mtime in a tree (children first, so directory times stick). */
function age(path: string, days: number) {
  const info = lstatSync(path)
  if (info.isDirectory() && !info.isSymbolicLink()) for (const name of readdirSync(path)) age(join(path, name), days)
  const time = new Date(now - days * DAY)
  lutimesSync(path, time, time)
}
function plan(root: string, options: Record<string, unknown> = {}) {
  return planClean({ root, now, trackedFiles: [], isPidAlive: (pid: number) => pid === 4242, ...options })
}
const find = (items: Item[], path: string) => {
  const item = items.find((entry) => entry.path === path)
  if (!item) throw new Error(`No plan item for ${path}`)
  return item
}
const removed = (items: Item[]) => items.filter((item) => item.action === 'remove').map((item) => item.path).sort()

describe('clean retention rules (synthetic repository fixtures)', () => {
  it('parses options strictly and maps the pinned SDK to its cache tag', () => {
    expect(targetTag('0.2.2-rc.1')).toBe('022rc1')
    expect(targetTag('0.2.2-rc.2')).toBe('022rc2')
    expect(parseDuration('14d')).toBe(14 * DAY)
    expect(parseDuration('36h')).toBe(36 * 3_600_000)
    expect(parseDuration('2w')).toBe(14 * DAY)
    expect(parseDuration('3')).toBe(3 * DAY)
    expect(() => parseDuration('soon')).toThrow('older-than')
    expect(parseArgs(['--apply', '--keep-last', '2', '--older-than', '1d'])).toMatchObject({ apply: true, keepLast: 2, olderThanMs: DAY })
    expect(parseArgs([])).toMatchObject({ apply: false, keepLast: undefined, olderThanMs: undefined })
    expect(() => parseArgs(['--keep-last', '-1'])).toThrow('keep-last')
    expect(() => parseArgs(['--force'])).toThrow('Unknown')
    expect(parseArgs(['--scope', 'test-data,artifacts']).scopes).toEqual(['.test-data', 'artifacts'])
    expect(() => parseArgs(['--scope', 'lib'])).toThrow('--scope')
  })

  it('always removes regenerable dependency caches and tgz copies, but not links, markers or cited paths', () => {
    const root = repository()
    file(root, '.test-data/run-a/node_modules/pkg/index.js')
    file(root, '.test-data/run-a/report.json')
    file(root, '.test-data/run-b/home/npm-cache/_cacache/index')
    file(root, '.test-data/run-b/pnpm-store/v10/file')
    file(root, '.test-data/run-b/nested/_cacache/data')
    file(root, '.test-data/run-b/copy.tgz')
    file(root, '.test-data/run-b/openai/lib/.keep', '')
    file(root, '.test-data/kept/.keep', '')
    file(root, '.test-data/kept/node_modules/pkg/index.js')
    file(root, '.test-data/cited/node_modules/pkg/index.js')
    file(root, '.test-data/cited/dsh-cliworker-now-0.8.1.tgz')
    file(root, '.test-data/globbed/copy-1.tgz')
    file(root, '.test-data/node_modules/pkg/index.js')
    file(root, '.test-data/stray.tgz')
    file(root, 'doc/tasks.md', 'Evidence: `.test-data/cited/dsh-cliworker-now-0.8.1.tgz`, `.test-data/cited/report.json` and .test-data/globbed/copy-*.tgz.')
    mkdirSync(join(root, '.test-data/linked'))
    symlinkSync(join(root, 'node_modules'), join(root, '.test-data/linked/node_modules'))
    expect(plan(root, { scopes: ['.cache'] }).items).toEqual([])
    const { items } = plan(root)
    expect(removed(items)).toEqual([
      '.test-data/cited/node_modules',
      '.test-data/node_modules',
      '.test-data/run-a/node_modules',
      '.test-data/run-b/copy.tgz',
      '.test-data/run-b/home/npm-cache',
      '.test-data/run-b/nested/_cacache',
      '.test-data/run-b/pnpm-store',
      '.test-data/stray.tgz',
    ])
    // A package's nested .keep is not a retention marker; an entry-level one is.
    expect(find(items, '.test-data/run-b').reason).toContain('evidence')
    expect(find(items, '.test-data/kept').reason).toBe('.keep marker')
    expect(find(items, '.test-data/cited').reason).toBe('referenced in doc/tasks.md')
    expect(find(items, '.test-data/run-a/node_modules').reason).toContain('regenerable')
  })

  it('prunes evidence only with --keep-last/--older-than and never protected entries', () => {
    const root = repository()
    for (const [name, days] of [['newest', 1], ['middle', 5], ['old', 20], ['oldest', 40]] as const) {
      file(root, `.test-data/${name}/result.json`)
      age(join(root, '.test-data', name), days)
    }
    file(root, '.test-data/old-log.txt')
    age(join(root, '.test-data/old-log.txt'), 30)
    file(root, '.test-data/cited-run/result.json')
    file(root, '.test-data/screens-v1/a.png')
    file(root, '.test-data/marked/.keep', '')
    file(root, '.test-data/active/run.lock', JSON.stringify({ pid: 4242 }))
    file(root, '.test-data/stale/run.lock', JSON.stringify({ pid: 999_999 }))
    file(root, '.test-data/plain-pid/worker.pid', '4242')
    file(root, '.test-data/copy.tgz')
    file(root, '.test-data/tracked/notes.md')
    file(root, '.test-data/windows-remote/config.json', '{}')
    for (const name of ['cited-run', 'screens-v1', 'marked', 'active', 'stale', 'plain-pid', 'tracked', 'windows-remote', 'copy.tgz']) age(join(root, '.test-data', name), 60)
    file(root, 'doc/tasks.md', 'See `.test-data/cited-run/result.json` and .test-data/screens-v*.png')
    file(root, 'openspec/changes/x/tasks.md', '.test-data/marked/')
    const trackedFiles = ['.test-data/tracked/notes.md']

    const untouched = plan(root, { trackedFiles })
    expect(removed(untouched.items)).toEqual(['.test-data/copy.tgz'])
    expect(find(untouched.items, '.test-data/old').reason).toBe('evidence (pass --keep-last/--older-than to prune)')

    const byAge = plan(root, { trackedFiles, olderThanMs: 10 * DAY, olderThan: '10d' })
    expect(removed(byAge.items)).toEqual(['.test-data/copy.tgz', '.test-data/old', '.test-data/old-log.txt', '.test-data/oldest', '.test-data/stale'])

    const byCount = plan(root, { trackedFiles, keepLast: 2 })
    // The regenerable top-level copy.tgz does not take an evidence slot.
    expect(removed(byCount.items)).toEqual(['.test-data/copy.tgz', '.test-data/old', '.test-data/old-log.txt', '.test-data/oldest', '.test-data/stale'])
    expect(find(byCount.items, '.test-data/middle').reason).toBe('among newest 2 evidence entries')

    const both = plan(root, { trackedFiles, keepLast: 1, olderThanMs: 25 * DAY, olderThan: '25d' })
    expect(removed(both.items)).toEqual(['.test-data/copy.tgz', '.test-data/old-log.txt', '.test-data/oldest', '.test-data/stale'])
    expect(find(both.items, '.test-data/middle').reason).toBe('newer than 25d')

    for (const [path, reason] of [
      ['.test-data/cited-run', 'referenced in doc/tasks.md'],
      ['.test-data/screens-v1', 'referenced in doc/tasks.md'],
      ['.test-data/marked', '.keep marker'],
      ['.test-data/active', 'active lock (pid 4242)'],
      ['.test-data/plain-pid', 'active lock (pid 4242)'],
      ['.test-data/tracked', 'contains Git-tracked files'],
      ['.test-data/windows-remote', 'Windows remote private config and run evidence'],
    ]) expect(find(both.items, path)).toMatchObject({ action: 'keep', reason })
  })

  it('keeps the pinned cache target and fixed build caches; old targets need --older-than', () => {
    const root = repository()
    for (const name of ['cliworker-build-deps-022rc1', 'dsh-host-build-deps', 'preview-package', 'typert', 'build-configs', 'cliworker-build-deps-020rc2', 'reference-dump', 'dsh-host-extension-output-4242', 'cited-ui'])
      file(root, `.cache/${name}/data.bin`)
    file(root, '.cache/run.lock', '4242')
    file(root, 'doc/tasks.md', 'Screenshot: .cache/cited-ui/verification.json')
    age(join(root, '.cache'), 30)
    expect(removed(plan(root).items)).toEqual([])
    expect(find(plan(root).items, '.cache/cliworker-build-deps-020rc2').reason).toBe('old DSH target (020rc2) (pass --older-than to prune)')
    const { items } = plan(root, { olderThanMs: 7 * DAY, olderThan: '7d' })
    expect(removed(items)).toEqual(['.cache/cliworker-build-deps-020rc2', '.cache/reference-dump'])
    expect(find(items, '.cache/cliworker-build-deps-022rc1').reason).toBe('current DSH 0.2.2-rc.1 target')
    expect(find(items, '.cache/dsh-host-build-deps').reason).toContain('build-host-extension')
    expect(find(items, '.cache/dsh-host-extension-output-4242').reason).toBe('active build (pid 4242)')
    expect(find(items, '.cache/cited-ui').reason).toBe('referenced in doc/tasks.md')
    expect(find(items, '.cache/run.lock').reason).toBe('active lock (pid 4242)')
    expect(removed(plan(root, { olderThanMs: 60 * DAY, olderThan: '60d' }).items)).toEqual([])
  })

  it('keeps rc.2 SDK, source and typecheck caches while pruning aged rc.1 targets', () => {
    const root = repository('0.2.2-rc.2')
    const current = ['cliworker-build-deps-022rc2', 'dsh-host-source-022rc2', 'dsh-host-typecheck-022rc2']
    const previous = ['cliworker-build-deps-022rc1', 'dsh-host-source-022rc1', 'dsh-host-typecheck-022rc1']
    for (const name of [...current, ...previous]) file(root, `.cache/${name}/data.bin`)
    age(join(root, '.cache'), 30)
    expect(removed(plan(root).items)).toEqual([])
    for (const name of previous)
      expect(find(plan(root).items, `.cache/${name}`).reason).toBe('old DSH target (022rc1) (pass --older-than to prune)')
    const { items } = plan(root, { olderThanMs: 7 * DAY, olderThan: '7d' })
    expect(removed(items)).toEqual(previous.map(name => `.cache/${name}`).sort())
    for (const name of current)
      expect(find(items, `.cache/${name}`)).toMatchObject({ action: 'keep', reason: 'current DSH 0.2.2-rc.2 target' })
  })

  it('keeps the three newest formal release groups and every verification.json', () => {
    const root = repository()
    for (const version of ['0.6.9', '0.7.10', '0.7.7', '0.7.8', '0.8.1']) {
      file(root, `artifacts/dsh-cliworker-now-${version}.tgz`)
      file(root, `artifacts/dsh-cliworker-now-${version}.tgz.sha256`)
      file(root, `artifacts/dsh-cliworker-now-${version}-verification.json`, '{}')
    }
    file(root, 'artifacts/dsh-cliworker-now-0.5.0-verification.json', '{}')
    file(root, 'artifacts/dsh-cliworker-now-0.9.0-preview.tgz')
    file(root, 'artifacts/dsh-cliworker-now-0.9.0-preview.tgz.sha256')
    file(root, 'artifacts/cli-icons-v1.zip')
    file(root, 'artifacts/bot-icons/a.png')
    age(join(root, 'artifacts'), 30)
    const { items } = plan(root)
    expect(removed(items)).toEqual([
      'artifacts/dsh-cliworker-now-0.6.9.tgz', 'artifacts/dsh-cliworker-now-0.6.9.tgz.sha256',
      'artifacts/dsh-cliworker-now-0.7.7.tgz', 'artifacts/dsh-cliworker-now-0.7.7.tgz.sha256',
    ])
    for (const version of ['0.7.8', '0.7.10', '0.8.1']) expect(find(items, `artifacts/dsh-cliworker-now-${version}.tgz`).reason).toBe('one of 3 newest formal releases')
    expect(items.filter((item: Item) => item.path.endsWith('-verification.json')).every((item: Item) => item.action === 'keep')).toBe(true)
    expect(find(items, 'artifacts/dsh-cliworker-now-0.9.0-preview.tgz').reason).toBe('pre-release package (pass --older-than to prune)')
    expect(find(items, 'artifacts/bot-icons').reason).toBe('outside release retention rules')
    expect(removed(plan(root, { olderThanMs: DAY, olderThan: '1d' }).items)).toEqual(expect.arrayContaining(['artifacts/dsh-cliworker-now-0.9.0-preview.tgz', 'artifacts/dsh-cliworker-now-0.9.0-preview.tgz.sha256']))
  })

  it('collects cited paths from doc and openspec Markdown, including glob prefixes', () => {
    const root = repository()
    file(root, 'doc/tasks.md', '- `.test-data/evidence/a.png`\n- .test-data/stop-regression-*.json\n- .cache/agy/{a,b}\n- artifacts/dsh-cliworker-now-0.7.7.tgz。')
    const references = collectReferences(root)
    expect(references.get('.test-data')).toEqual([
      { path: 'evidence/a.png', prefix: false, source: 'doc/tasks.md' },
      { path: 'stop-regression-', prefix: true, source: 'doc/tasks.md' },
    ])
    expect(references.get('.cache')).toEqual([{ path: 'agy', prefix: false, source: 'doc/tasks.md' }])
    expect(references.get('artifacts')).toEqual([{ path: 'dsh-cliworker-now-0.7.7.tgz', prefix: false, source: 'doc/tasks.md' }])
  })

  it('applies only planned removals, never follows links and leaves lib, node_modules and doc/local intact', () => {
    const root = repository()
    file(root, '.test-data/old-run/result.json')
    symlinkSync(root, join(root, '.test-data/old-run/repository-link'))
    symlinkSync(join(root, 'lib'), join(root, '.test-data/desktop-link'))
    file(root, '.test-data/keep-run/node_modules/pkg/index.js')
    symlinkSync(join(root, 'node_modules/dep'), join(root, '.test-data/keep-run/node_modules/linked-dep'))
    file(root, '.test-data/keep-run/result.json')
    age(join(root, '.test-data/old-run'), 30)
    const result = plan(root, { olderThanMs: 7 * DAY, olderThan: '7d' })
    expect(removed(result.items)).toEqual(['.test-data/keep-run/node_modules', '.test-data/old-run'])
    expect(find(result.items, '.test-data/desktop-link').reason).toBe('symbolic link (not followed)')
    const applied = applyPlan(result)
    expect(applied.every((item: { removed: boolean }) => item.removed)).toBe(true)
    expect(existsSync(join(root, '.test-data/old-run'))).toBe(false)
    expect(existsSync(join(root, '.test-data/keep-run/node_modules'))).toBe(false)
    expect(existsSync(join(root, '.test-data/keep-run/result.json'))).toBe(true)
    expect(lstatSync(join(root, '.test-data/desktop-link')).isSymbolicLink()).toBe(true)
    for (const path of ['package.json', 'lib/index.js', 'node_modules/dep/index.js', 'doc/local/runbook.md']) expect(existsSync(join(root, path))).toBe(true)
  })

  it('refuses a linked scope directory and honours a scope-level .keep', () => {
    const root = repository()
    const outside = mkdtempSync(join(tmpdir(), 'cliworker-clean-outside-'))
    roots.push(outside)
    file(outside, 'run/node_modules/pkg/index.js')
    symlinkSync(outside, join(root, '.test-data'))
    file(root, '.cache/.keep', '')
    file(root, '.cache/old/data.bin')
    age(join(root, '.cache'), 30)
    const result = plan(root, { olderThanMs: DAY, olderThan: '1d' })
    expect(result.warnings).toContain('.test-data is not a real directory; skipped')
    expect(removed(result.items)).toEqual([])
    expect(find(result.items, '.cache').reason).toBe('.keep marker')
    expect(existsSync(join(outside, 'run/node_modules/pkg/index.js'))).toBe(true)
  })
})
