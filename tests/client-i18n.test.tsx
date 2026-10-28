import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  effortLabel,
  formatLocale,
  installClientLocale,
  languagePreference,
  LOCALE_NS,
  setLanguagePreference,
  t,
  uiLanguage,
  zh,
} from '../src/client/i18n.ts'
import { en, type MessageKey } from '../src/client/i18n-messages.ts'
import { hostText, operationMessage } from '../src/client/operation-error.ts'
import { NameCopy } from '../src/client/name-copy.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  writeClipboard: vi.fn(),
  Tooltip: ({ children }: any) => children,
}))

/**
 * Simulated Harness locale service: it keeps registered dictionaries per
 * namespace and resolves the active language the way the real runtime does
 * (namespace entry, else the key itself).
 */
function fakeLocale(active = 'zh-CN') {
  const dictionaries = new Map<string, Record<string, Record<string, string>>>()
  const listeners = new Set<() => void>()
  let state = { active, revision: 1 }
  const locale = {
    register: vi.fn((ns: string, dicts: Record<string, Record<string, string>>) => {
      dictionaries.set(ns, dicts)
      return () => dictionaries.delete(ns)
    }),
    bind: (ns: string) => (key: string, params?: Record<string, string | number>) => {
      const text = dictionaries.get(ns)?.[state.active.split('-')[0]!]?.[key] ?? key
      return params ? text.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match)) : text
    },
    getLocale: () => state,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const change = (next: string) => {
    state = { active: next, revision: state.revision + 1 }
    for (const listener of listeners) listener()
  }
  return { locale, dictionaries, listeners, change }
}

/** Simulated Cordis context: `inject` runs at once and `effect` disposers run on dispose. */
function fakeContext(locale: unknown) {
  const disposers: (() => void)[] = []
  const ctx = {
    inject: (_deps: string[], body: (scope: any) => void) =>
      body({
        locale,
        effect: (fn: () => () => void) => disposers.push(fn()),
      }),
  } as unknown as Context
  return { ctx, dispose: () => disposers.splice(0).reverse().forEach((fn) => fn()) }
}

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  setLanguagePreference('follow')
})
function install(active?: string) {
  const harness = fakeLocale(active)
  const context = fakeContext(harness.locale)
  installClientLocale(context.ctx)
  cleanup.push(context.dispose)
  return { ...harness, dispose: context.dispose }
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

it('keeps every English entry non-empty with the same placeholders as its Chinese key', () => {
  const keys = Object.keys(en) as MessageKey[]
  expect(keys.length).toBeGreaterThan(500)
  for (const key of keys) {
    expect(en[key].trim(), key).not.toBe('')
    expect(placeholders(en[key]), key).toEqual(placeholders(key))
    // Every key carries Chinese source text, so English copy never doubles as a key.
    expect(/[㐀-鿿]/u.test(key), key).toBe(true)
    expect(/[㐀-鿿]/u.test(en[key]), key).toBe(false)
  }
  expect(Object.keys(zh)).toEqual(keys)
  for (const key of keys) expect(zh[key]).toBe(key)
})

it('defaults to Chinese without a Harness locale and honours an explicit preference', () => {
  expect(languagePreference()).toBe('follow')
  expect(uiLanguage()).toBe('zh')
  expect(t('复制名称 {name}', { name: 'pi-1' })).toBe('复制名称 pi-1')
  setLanguagePreference('en')
  expect(uiLanguage()).toBe('en')
  expect(formatLocale()).toBe('en-US')
  expect(t('复制名称 {name}', { name: 'pi-1' })).toBe('Copy name pi-1')
  expect(effortLabel('default')).toBe('Default')
  setLanguagePreference('zh')
  expect(t('复制名称 {name}', { name: 'pi-1' })).toBe('复制名称 pi-1')
  expect(formatLocale()).toBe('zh-CN')
})

it.each(['fr', '', 1, null, {}])('ignores an unknown preference %j', (value) => {
  setLanguagePreference('en')
  setLanguagePreference(value)
  expect(languagePreference()).toBe('en')
})

it('treats a missing preference as follow', () => {
  setLanguagePreference('en')
  setLanguagePreference(undefined)
  expect(languagePreference()).toBe('follow')
})

it('registers both dictionaries and follows the Harness language live', () => {
  const harness = install('zh-CN')
  expect(harness.locale.register).toHaveBeenCalledWith(LOCALE_NS, { zh, en })
  expect(uiLanguage()).toBe('zh')
  expect(t('语言')).toBe('语言')
  harness.change('en-US')
  expect(uiLanguage()).toBe('en')
  expect(t('语言')).toBe('Language')
  // Any non-Chinese Harness language resolves to English for the plugin's own copy.
  harness.change('ja')
  expect(uiLanguage()).toBe('en')
  harness.change('zh-TW')
  expect(uiLanguage()).toBe('zh')
})

it('lets an explicit plugin language override the Harness language', () => {
  const harness = install('zh-CN')
  setLanguagePreference('en')
  expect(t('语言')).toBe('Language')
  harness.change('en-US')
  setLanguagePreference('zh')
  expect(t('语言')).toBe('语言')
  setLanguagePreference('follow')
  expect(t('语言')).toBe('Language')
})

it('unregisters and unsubscribes on dispose, then falls back to Chinese', () => {
  const harness = install('en-US')
  expect(harness.dictionaries.has(LOCALE_NS)).toBe(true)
  expect(harness.listeners.size).toBe(1)
  expect(t('语言')).toBe('Language')
  harness.dispose()
  expect(harness.dictionaries.has(LOCALE_NS)).toBe(false)
  expect(harness.listeners.size).toBe(0)
  expect(uiLanguage()).toBe('zh')
  expect(t('语言')).toBe('语言')
})

it('maps known Host messages to English and leaves unknown Host or CLI text verbatim', () => {
  setLanguagePreference('en')
  expect(hostText('请先关闭账号终端')).toBe('Close the account terminal first')
  expect(hostText('Error: 请先关闭账号终端')).toBe('Close the account terminal first')
  expect(hostText('Codex 已关闭，请先在 CLI Worker 设置中开启')).toBe(
    'Codex is turned off. Turn it on in CLI Worker settings first',
  )
  expect(hostText('目标须包含 1–4000 个字符')).toBe('The goal must contain 1–4000 characters')
  expect(hostText('模拟的未知 CLI 错误')).toBe('模拟的未知 CLI 错误')
  expect(hostText('Error: 模拟的未知 CLI 错误')).toBe('Error: 模拟的未知 CLI 错误')
  expect(hostText(undefined)).toBeUndefined()
  expect(operationMessage(new Error('cliworker/unavailable: 请先关闭账号终端'))).toBe('Close the account terminal first')
  expect(operationMessage('HTTP 404')).toMatch(/^The plugin service/)
  setLanguagePreference('zh')
  expect(hostText('Error: 请先关闭账号终端')).toBe('Error: 请先关闭账号终端')
  expect(operationMessage(new Error('请先关闭账号终端'))).toBe('请先关闭账号终端')
})

it.each([
  ['任务超时：已达到总时限 30 分钟', 'The task timed out: reached the total time limit of 30 min'],
  ['任务超时：已达到总时限 2 小时', 'The task timed out: reached the total time limit of 2 h'],
  ['任务超时：已达到总时限 90 秒', 'The task timed out: reached the total time limit of 90 s'],
  ['任务超时：连续 10 分钟没有收到 CLI 事件（空闲时限）', 'The task timed out: no CLI event for 10 min (idle time limit)'],
  ['任务超时', 'The task timed out'],
])('translates timeout messages and duration units: %s', (message, english) => {
  setLanguagePreference('en')
  expect(hostText(message)).toBe(english)
  expect(hostText(`Error: ${message}`)).toBe(english)
  setLanguagePreference('zh')
  expect(hostText(message)).toBe(message)
})

it('maps isolated-copy Host messages, translating a nested Host reason but not paths or details', () => {
  setLanguagePreference('en')
  expect(hostText('项目文件数超过隔离副本上限（20000 个）；已改为排队，等待主目录空闲')).toBe(
    'The project has more files than the isolated copy limit (20000); queued instead until the main folder is free',
  )
  expect(hostText('无法创建隔离副本：模拟的系统错误；已改为排队，等待主目录空闲')).toBe(
    'Could not create an isolated copy: 模拟的系统错误; queued instead until the main folder is free',
  )
  expect(hostText('合并失败：两边改动了相同或相邻的行')).toBe('Merge failed: Both sides changed the same or adjacent lines')
  expect(hostText('合并期间主目录中的 src/模拟.ts 发生变化，请重新合并')).toBe(
    'src/模拟.ts in the main folder changed during the merge. Merge again',
  )
  expect(hostText('已合并隔离副本：写回 3 个、删除 1 个文件（未提交）')).toBe(
    'Isolated copy merged: wrote back 3 and deleted 1 files (uncommitted)',
  )
  expect(hostText('2 个文件两边都改过，等待主 Agent 整合，主目录未改动')).toBe(
    '2 files were changed on both sides and wait for the main agent to integrate them; the main folder was not changed',
  )
  setLanguagePreference('zh')
  expect(hostText('合并失败：两边改动了相同或相邻的行')).toBe('合并失败：两边改动了相同或相邻的行')
})

it('re-renders a mounted component when the Harness language changes', async () => {
  const harness = install('zh-CN')
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(NameCopy, { name: 'pi-1' }))
  })
  cleanup.push(() => act(async () => renderer.unmount()))
  const label = () => renderer.root.findByType('button').props['aria-label']
  expect(label()).toBe('复制名称 pi-1')
  await act(async () => harness.change('en-US'))
  expect(label()).toBe('Copy name pi-1')
  await act(async () => setLanguagePreference('zh'))
  expect(label()).toBe('复制名称 pi-1')
})
