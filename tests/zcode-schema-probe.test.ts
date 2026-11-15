import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyZCodeWorkflowSurface, zcodeWorkflowSurface } from '../src/host/zcode-schema-probe.ts'
import { zcodeRuntimePreferences, zcodeSessionWorkflow } from '../src/host/cli-native-capabilities.mjs'

// 模拟：合成的打包片段，只复刻已安装版本 schema 的字段形状，不运行 ZCode。
const minified017 =
  '_un=m.object({additionalDirectories:m.array(hn).max(256).optional(),nativeSearchEnhancementsEnabled:m.boolean(),toolSearchMode:P0e.default("off"),memoryEnabled:m.boolean().default(!1),askUserQuestionAutoResolutionEnabled:m.boolean().default(!0),modelContextBudgetStrategy:LRr.default(kN)}).strict(),' +
  'sun=m.object({toolDenylist:m.array(hn).optional(),offPeakToolEnabled:m.boolean().optional(),dynamicWorkflowEnabled:m.boolean().optional(),dynamicWorkflowMode:Kat.optional()}).strict()'
const pretty0169 = `zcodeSessionRuntimePreferencesResultSchema = external_exports.object({
      nativeSearchEnhancementsEnabled: external_exports.boolean(),
      memoryEnabled: external_exports.boolean().default(false),
      askUserQuestionAutoResolutionEnabled: external_exports.boolean().default(true),
    }).strict();
    create = external_exports.object({
      offPeakToolEnabled: external_exports.boolean().optional(),
      dynamicWorkflowEnabled: external_exports.boolean().optional()
    }).strict();`
const legacyPreferences =
  'x=m.object({nativeSearchEnhancementsEnabled:m.boolean(),memoryEnabled:m.boolean().default(!1),dynamicWorkflowEnabled:m.boolean().optional(),dynamicWorkflowMode:Kat.optional(),askUserQuestionAutoResolutionEnabled:m.boolean().default(!0)}).strict(),' +
  'y=m.object({offPeakToolEnabled:m.boolean().optional(),dynamicWorkflowEnabled:m.boolean().optional(),dynamicWorkflowMode:Kat.optional()}).strict()'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('ZCode workflow surface probe (synthetic bundles)', () => {
  it('classifies each known schema shape', () => {
    expect(classifyZCodeWorkflowSurface(minified017)).toBe('session')
    expect(classifyZCodeWorkflowSurface(pretty0169)).toBe('none')
    expect(classifyZCodeWorkflowSurface(legacyPreferences)).toBe('preferences')
    expect(classifyZCodeWorkflowSurface('unrelated text')).toBe('none')
  })

  it('reads only script entries, caches by file identity and rereads a replaced file', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcode-schema-probe-'))
    roots.push(root)
    const entry = join(root, 'zcode.cjs')
    writeFileSync(entry, minified017)
    expect(zcodeWorkflowSurface(entry)).toBe('session')
    writeFileSync(entry, legacyPreferences)
    utimesSync(entry, new Date(), new Date(Date.now() + 5000))
    expect(zcodeWorkflowSurface(entry)).toBe('preferences')
    expect(zcodeWorkflowSurface(join(root, 'zcode.exe'))).toBe('none')
    expect(zcodeWorkflowSurface(join(root, 'missing.cjs'))).toBe('none')
  })

  it('builds replies that never carry workflow keys outside the proven surface', () => {
    expect(zcodeRuntimePreferences({ memory: true, workflow: 'onDemand', surface: 'session' })).toEqual({
      nativeSearchEnhancementsEnabled: false, memoryEnabled: true, askUserQuestionAutoResolutionEnabled: false,
    })
    expect(zcodeRuntimePreferences({ memory: false, workflow: 'alwaysOn', surface: 'preferences' })).toMatchObject({
      dynamicWorkflowEnabled: true, dynamicWorkflowMode: 'alwaysOn',
    })
    expect(zcodeSessionWorkflow({ workflow: 'onDemand', surface: 'session' })).toEqual({ dynamicWorkflowEnabled: true, dynamicWorkflowMode: 'onDemand' })
    expect(zcodeSessionWorkflow({ workflow: 'disabled', surface: 'session' })).toEqual({ dynamicWorkflowEnabled: false })
    expect(zcodeSessionWorkflow({ workflow: 'alwaysOn', surface: 'none' })).toEqual({ dynamicWorkflowEnabled: false })
  })
})

// 本机静态读取（不运行 CLI、不调用模型）：存在时核对已安装 0.17.1 与缓存的 0.16.9。
const installed = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
const cached0169 = join(process.env.HOME ?? '', '.local/share/cliworker-now/runtimes/zcode/cli/zcode.cjs')
describe('ZCode workflow surface probe (local installed bundles, static read only)', () => {
  it.skipIf(!existsSync(installed))('classifies the installed Desktop CLI', () => {
    expect(['session', 'preferences', 'none']).toContain(zcodeWorkflowSurface(installed))
  })
  it.skipIf(!existsSync(cached0169))('keeps the cached 0.16.9 runtime on the field set it accepts', () => {
    expect(zcodeWorkflowSurface(cached0169)).toBe('none')
  })
})
