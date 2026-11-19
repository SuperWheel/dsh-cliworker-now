import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentNameOverrides,
  officialRename,
  type OfficialSubagentRename,
} from '../src/host/agent-name-overrides.ts'
import { migrateOverridesToOfficial, renameThroughOfficial } from '../src/host/agent-name-official.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface CatalogRow {
  id: string
  name?: string
  formerNames?: string[]
}

// 模拟未来的官方改名服务。按父目录保存现名与曾用名；插件覆盖文件使用真实存储，重启重新读取同一文件。
function fixture(
  parents: Record<string, CatalogRow[]> = { parent: [{ id: 'child', name: 'first', formerNames: [] }] },
) {
  const directory = mkdtempSync(join(import.meta.dirname, '模拟迁移覆盖-'))
  dirs.push(directory)
  const overrides = new AgentNameOverrides(directory)
  const controller = new AbortController(),
    signal = controller.signal
  const rename = vi.fn<OfficialSubagentRename['rename']>(async (request) => {
    request.signal?.throwIfAborted()
    const rows = parents[request.parentSessionId] ?? []
    const child = rows.find((row) => row.id === request.childSessionId)
    if (!child) throw new Error('模拟：目标不在父目录内')
    if (
      rows.some(
        (row) => row !== child && (row.name === request.name || row.formerNames?.includes(request.name)),
      )
    )
      throw new Error('模拟：名称冲突')
    if (child.formerNames) {
      const history = new Set(child.formerNames)
      if (child.name) history.add(child.name)
      history.delete(request.name)
      child.formerNames = [...history]
    }
    child.name = request.name
  })
  const deps = {
    overrides,
    official: { rename },
    readCatalog: vi.fn(async (parent: string, signal: AbortSignal) => {
      signal.throwIfAborted()
      return structuredClone(parents[parent] ?? [])
    }),
    log: vi.fn(),
  }
  const record = (parent = 'parent', childId = 'child', first = 'first', current = 'audit') => {
    overrides.set(parent, childId, { expected: first, name: 'middle', registeredName: first, kind: 'native' })
    overrides.set(parent, childId, { expected: 'middle', name: current, kind: 'native' })
  }
  return {
    directory,
    parents,
    deps,
    overrides,
    controller,
    signal,
    rename,
    record,
    migrate: () => migrateOverridesToOfficial(deps, signal),
  }
}

describe('模拟 DSH 官方改名与重启迁移', () => {
  it('缺失能力保留覆盖文件，发现接口后用原父子 ID 和 signal 请求改名', async () => {
    const f = fixture()
    f.record()
    const request = { parentSessionId: 'parent', childSessionId: 'child', name: 'official', signal: f.signal }
    expect(officialRename({})).toBeUndefined()
    await expect(renameThroughOfficial(undefined, request)).rejects.toThrow('不可用')
    const unavailable = await migrateOverridesToOfficial({ ...f.deps, official: undefined }, f.signal)
    expect(unavailable.kept).toEqual([
      { parent: 'parent', childId: 'child', reason: expect.stringContaining('不可用') },
    ])
    expect(f.deps.readCatalog).not.toHaveBeenCalled()
    expect(new AgentNameOverrides(f.directory).get('parent', 'child')?.name).toBe('audit')
    await renameThroughOfficial(officialRename(f.deps.official), request)
    expect(f.rename).toHaveBeenCalledExactlyOnceWith(request)
    expect(f.parents.parent![0]!.name).toBe('official')
  })

  it('官方拒绝（异常或明确的拒绝回执）直接失败，不发布本地成功', async () => {
    const f = fixture()
    const request = { parentSessionId: 'parent', childSessionId: 'child', name: 'audit', signal: f.signal }
    f.rename.mockRejectedValueOnce(new Error('模拟授权失败')).mockResolvedValueOnce({ accepted: false })
    await expect(renameThroughOfficial(f.deps.official, request)).rejects.toThrow('模拟授权失败')
    await expect(renameThroughOfficial(f.deps.official, request)).rejects.toThrow('拒绝')
    expect(f.overrides.parents()).toEqual([])
    expect(f.parents.parent![0]!.name).toBe('first')
  })

  it('跳过已确认的历史名，按顺序补齐中间名，最后把当前仅为别名的目标设为现名', async () => {
    const f = fixture({ parent: [{ id: 'child', name: 'first', formerNames: ['middle', 'audit'] }] })
    f.record('parent', 'child', 'first', 'pending-name')
    f.overrides.set('parent', 'child', { expected: 'pending-name', name: 'audit', kind: 'native' })
    expect(await f.migrate()).toEqual({ migrated: [{ parent: 'parent', childId: 'child' }], kept: [] })
    expect(f.rename.mock.calls.map(([r]) => r.name)).toEqual(['pending-name', 'audit'])
    expect(f.parents.parent![0]!).toEqual({
      id: 'child',
      name: 'audit',
      formerNames: ['middle', 'first', 'pending-name'],
    })
    expect(f.deps.readCatalog).toHaveBeenCalledTimes(2)
    expect(new AgentNameOverrides(f.directory).get('parent', 'child')).toBeUndefined()
  })

  it('目录仅提供现名时仍逐步调用并读回最终名称', async () => {
    const f = fixture({ parent: [{ id: 'child', name: 'first' }] })
    f.record()
    expect((await f.migrate()).migrated).toEqual([{ parent: 'parent', childId: 'child' }])
    expect(f.rename.mock.calls.map(([r]) => r.name)).toEqual(['middle', 'audit'])
    expect(f.deps.readCatalog).toHaveBeenCalledTimes(2)
  })

  it('同父名称冲突保留，其他父的同名仍可迁移；官方中途拒绝后从已登记步骤继续', async () => {
    const f = fixture({
      collision: [
        { id: 'child', name: 'first', formerNames: [] },
        { id: 'sibling', name: 'sibling', formerNames: ['audit'] },
      ],
      failed: [{ id: 'child', name: 'first', formerNames: [] }],
      success: [{ id: 'child', name: 'first', formerNames: [] }],
    })
    for (const parent of Object.keys(f.parents)) f.record(parent)
    const rename = f.rename.getMockImplementation()!
    f.rename.mockImplementationOnce(rename).mockRejectedValueOnce(new Error('模拟：官方繁忙'))
    const result = await f.migrate()
    expect(result.kept).toEqual([
      { parent: 'collision', childId: 'child', reason: expect.stringContaining('冲突') },
      { parent: 'failed', childId: 'child', reason: '模拟：官方繁忙' },
    ])
    expect(result.migrated).toEqual([{ parent: 'success', childId: 'child' }])
    expect(f.deps.log).toHaveBeenCalledTimes(2)
    expect(f.parents.failed![0]!.name).toBe('middle')
    const restarted = new AgentNameOverrides(f.directory)
    expect(restarted.parents()).toEqual(['collision', 'failed'])
    f.rename.mockClear()
    const retry = await migrateOverridesToOfficial({ ...f.deps, overrides: restarted }, f.signal)
    expect(retry.migrated).toEqual([{ parent: 'failed', childId: 'child' }])
    expect(f.rename.mock.calls.map(([r]) => [r.parentSessionId, r.name])).toEqual([['failed', 'audit']])
  })

  it('两项本地旧名有歧义时保留双方，后续无冲突条目仍然成功', async () => {
    const f = fixture({
      parent: [
        { id: 'a', name: 'alpha', formerNames: [] },
        { id: 'b', name: 'beta', formerNames: [] },
        { id: 'c', name: 'gamma', formerNames: [] },
      ],
    })
    for (const [id, first] of [
      ['a', 'alpha'],
      ['b', 'beta'],
    ] as const) {
      f.overrides.set('parent', id, {
        expected: first,
        name: first + '-new',
        kind: 'native',
        alsoFormer: ['shared'],
      })
    }
    f.overrides.set('parent', 'c', { expected: 'gamma', name: 'gamma-new', kind: 'worker' })
    const result = await f.migrate()
    expect(result.kept.map((row) => [row.childId, row.reason])).toEqual([
      ['a', expect.stringContaining('冲突')],
      ['b', expect.stringContaining('冲突')],
    ])
    expect(result.migrated).toEqual([{ parent: 'parent', childId: 'c' }])
    expect(f.rename.mock.calls.map(([request]) => request.name)).toEqual(['gamma-new'])
  })

  it('读回时发现同父其他成员占用曾用名则保留覆盖项', async () => {
    const f = fixture()
    f.record()
    f.deps.readCatalog.mockResolvedValueOnce(structuredClone(f.parents.parent!)).mockResolvedValueOnce([
      { id: 'child', name: 'audit', formerNames: ['first', 'middle'] },
      { id: 'other', name: 'middle' },
    ])
    expect((await f.migrate()).kept[0]?.reason).toContain('冲突')
    expect(f.overrides.get('parent', 'child')).toBeDefined()
  })

  it('官方成功而本地清理失败后，重启仅复核并删除', async () => {
    const f = fixture()
    f.record()
    vi.spyOn(f.overrides, 'delete').mockImplementationOnce(() => {
      throw new Error('模拟：本地写入失败')
    })
    expect((await f.migrate()).kept[0]?.reason).toContain('本地写入失败')
    expect(f.parents.parent![0]).toMatchObject({ name: 'audit', formerNames: ['first', 'middle'] })
    const restarted = new AgentNameOverrides(f.directory)
    expect(restarted.get('parent', 'child')).toBeDefined()
    f.rename.mockClear()
    const deps = { ...f.deps, overrides: restarted }
    expect((await migrateOverridesToOfficial(deps, f.signal)).migrated).toEqual([
      { parent: 'parent', childId: 'child' },
    ])
    expect(await migrateOverridesToOfficial(deps, f.signal)).toEqual({ migrated: [], kept: [] })
    expect(f.rename).not.toHaveBeenCalled()
  })

  it('历史中文名继续由插件寻址，重复执行不重放已确认的步骤', async () => {
    const f = fixture()
    f.overrides.set('parent', 'child', {
      expected: 'first',
      name: 'audit',
      registeredName: 'first',
      alsoFormer: ['小林'],
      kind: 'worker',
    })
    expect((await f.migrate()).kept[0]).toMatchObject({ reason: expect.stringContaining('保留插件兼容别名') })
    const restarted = new AgentNameOverrides(f.directory)
    expect(restarted.lookup('parent', '小林')).toMatchObject({ kind: 'match', childId: 'child' })
    await migrateOverridesToOfficial({ ...f.deps, overrides: restarted }, f.signal)
    expect(f.rename.mock.calls.map(([r]) => r.name)).toEqual(['audit'])
  })

  it.each([
    [[], '子会话 ID'],
    [[{ id: 'child', name: 'middle', formerNames: ['first'] }], '现名'],
    [[{ id: 'child', name: 'audit', formerNames: ['first'] }], '曾用名'],
  ] as const)('清理前重新读取身份、现名和曾用名（%j）', async (rows, reason) => {
    const f = fixture()
    f.record()
    f.deps.readCatalog
      .mockResolvedValueOnce(structuredClone(f.parents.parent!))
      .mockResolvedValueOnce(rows.map((row) => ({ ...row, formerNames: [...row.formerNames] })))
    expect((await f.migrate()).kept[0]?.reason).toContain(reason)
    expect(new AgentNameOverrides(f.directory).get('parent', 'child')?.name).toBe('audit')
  })

  it('读回期间发生并发改名不会删除较新的覆盖项', async () => {
    const f = fixture()
    f.record()
    const read = f.deps.readCatalog.getMockImplementation()!
    f.deps.readCatalog.mockImplementationOnce(read).mockImplementationOnce(async (...args) => {
      f.overrides.set('parent', 'child', { expected: 'audit', name: 'newer', kind: 'native' })
      return read(...args)
    })
    expect((await f.migrate()).kept[0]?.reason).toContain('已变更')
    expect(f.overrides.get('parent', 'child')?.name).toBe('newer')
  })

  it('取消期间保留原覆盖项并停止后续改名', async () => {
    const f = fixture()
    f.record()
    f.rename.mockImplementationOnce(async () => f.controller.abort(new Error('模拟卸载取消')))
    await expect(f.migrate()).rejects.toThrow('模拟卸载取消')
    expect(f.rename).toHaveBeenCalledTimes(1)
    expect(f.overrides.get('parent', 'child')).toBeDefined()
  })
})
