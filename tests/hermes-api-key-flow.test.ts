import { expect, it } from 'vitest'
import type { GuideEvent } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'

const steps = (events: GuideEvent[]) => events.flatMap((event) => ('guide' in event ? [event.guide.step] : []))

// 模拟：Hermes 当前 `auth add <provider> --type api-key` 在终端里先问 Key、再问名称
// （hermes_cli/auth_commands.py `_add_api_key_credential`，Windows 与 macOS 安装相同）。
it('模拟 Hermes 在 Key 之后询问名称：回车保留原生默认名称，保存后才确认登录', () => {
  const guide = createAccountGuide('hermes', 'login', { provider: 'deepseek' })!
  expect(steps(guide.output('Paste your API key: '))).toEqual(['key'])
  const submitted = guide.respond({ secret: 'simulated-hermes-key' })
  expect(submitted).toEqual([{ write: 'simulated-hermes-key', enter: true }])
  const label = guide.output('\r\nLabel (optional, default: api-key-2): ')
  expect(steps(label)).toEqual(['saving'])
  expect(label).toContainEqual({ write: '\r' })
  expect(label).not.toContainEqual({ confirm: 'login' })
  expect(guide.output('\r\nAdded deepseek credential #2: "api-key-2"\r\n')).toContainEqual({ confirm: 'login' })
})

it('模拟旧版先问名称：名称回车后粘贴 Key，打印保存结果即确认', () => {
  const guide = createAccountGuide('hermes', 'login', { provider: 'deepseek' })!
  expect(guide.output('Label / account name (optional): ')).toContainEqual({ write: '\r' })
  expect(steps(guide.output('\r\nPaste your API key: '))).toEqual(['key'])
  guide.respond({ secret: 'simulated-hermes-key' })
  expect(guide.output('\r\nAdded deepseek credential #1: "api-key-1"\r\n')).toContainEqual({ confirm: 'login' })
})
