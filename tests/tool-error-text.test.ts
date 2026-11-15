import { expect, it } from 'vitest'
import { toolErrorText, toolReceiptError } from '../src/host/tool-error-text.ts'

it.each([
  ['plain', 'plain'],
  [{ message: 'read denied' }, 'read denied'],
  [{ text: 'not found' }, 'not found'],
  [{ error: { message: 'nested failure' } }, 'nested failure'],
  [{ content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }, 'first\nsecond'],
  [{ code: 42, details: { denied: true } }, '{"code":42,"details":{"denied":true}}'],
  [new Error('native failure'), 'native failure'],
  [{ text: '<script>untrusted()</script>' }, '<script>untrusted()</script>'],
])('模拟 tool error text %j', (value, expected) => {
  expect(toolErrorText(value)).toBe(expected)
})
it('模拟 bounds strings, unknown JSON, depth and cycles', () => {
  expect(toolErrorText({ message: 'x'.repeat(10000) })).toHaveLength(4096)
  expect(toolErrorText({ unknown: 'x'.repeat(10000) })).toHaveLength(4096)
  const cycle: any = { code: 'cycle' }; cycle.self = cycle
  expect(toolErrorText(cycle)).toContain('[circular]')
  const deep: any = {}; let cursor = deep
  for (let i = 0; i < 50; i++) { cursor.next = {}; cursor = cursor.next }
  expect(toolErrorText(deep)).toContain('[truncated]')
  expect(toolErrorText({ get message() { throw new Error('hostile getter') } })).toBe('CLI 工具失败（错误详情无法读取）')
})
it('模拟 converts cancellation objects while preserving AbortError identity', () => {
  const controller = new AbortController()
  controller.abort({ kind: 'user' })
  expect(toolReceiptError(controller.signal.reason, controller.signal)).toMatchObject({ name: 'AbortError', message: '用户已停止任务' })
  expect(toolReceiptError({ text: 'unrelated failure' }, controller.signal)).toMatchObject({ name: 'Error', message: 'unrelated failure' })
  const original = Object.assign(new Error('known'), { code: 'CLI_TOOL_FAILED' })
  expect(toolReceiptError(original, controller.signal)).toBe(original)
})
