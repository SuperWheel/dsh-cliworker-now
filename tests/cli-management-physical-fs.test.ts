import { afterEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'

// 模拟：不启动 Electron。用假的 original-fs 标记对象，核对桌面应用更新/安装在 Electron Host 下绕开 ASAR 补丁。
const marker = vi.hoisted(() => ({ promises: { rm: () => 'physical-rm' }, requests: 0 }))

vi.mock('node:module', async (load) => {
  const native = await load<typeof import('node:module')>()
  return {
    ...native,
    createRequire: (...args: Parameters<typeof native.createRequire>) => {
      const nativeRequire = native.createRequire(...args)
      return Object.assign((id: string) => {
        if (id !== 'original-fs') return nativeRequire(id)
        marker.requests++
        return marker
      }, nativeRequire)
    },
  }
})

const versions = process.versions as Record<string, string | undefined>
const electron = versions.electron

afterEach(() => {
  if (electron === undefined) delete versions.electron
  else versions.electron = electron
  marker.requests = 0
  vi.resetModules()
})

describe('模拟：应用目录文件操作绕开 Electron ASAR 补丁', () => {
  it('Electron Host 下使用 original-fs，避免把 app.asar 当成目录删除失败', async () => {
    versions.electron = '40.0.0'
    const { physicalFs } = await import('../src/host/cli-management/physical-fs.ts')
    expect(physicalFs()).toBe(marker)
    expect(physicalFs()).toBe(marker)
    expect(marker.requests).toBe(1)
  })

  it('普通 Node 下沿用 node:fs', async () => {
    delete versions.electron
    const { physicalFs } = await import('../src/host/cli-management/physical-fs.ts')
    expect(physicalFs().promises.rm).toBe(nodeFs.promises.rm)
    expect(marker.requests).toBe(0)
  })

  it('桌面应用更新与首次安装的删除都走物理文件系统', async () => {
    versions.electron = '40.0.0'
    const { updateCleanupIo } = await import('../src/host/cli-management/update-cleanup.ts')
    const removal = vi.spyOn(marker.promises, 'rm')
    expect(await updateCleanupIo.remove('/synthetic-never-created')).toBe(true)
    expect(removal).toHaveBeenCalledWith('/synthetic-never-created', expect.objectContaining({recursive:true, maxRetries:6}))
  })
})
