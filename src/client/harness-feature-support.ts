import type { HarnessConversationBinding, HarnessConversationFeature } from '../shared/types.ts'
import { t, type MessageKey } from './i18n.ts'
import { hostText } from './operation-error.ts'

const reasons: Partial<Record<HarnessConversationFeature, MessageKey>> = {
  goal: '当前 CLI 不支持目标',
  plan: '当前 CLI 不支持规划模式',
  feedback: '当前 CLI 不支持反馈',
  fork: '当前 CLI 不支持会话分支',
  forkEarlier: '当前 CLI 只支持从最新一轮分支',
}

export function harnessFeatureReason(
  binding: HarnessConversationBinding,
  feature: HarnessConversationFeature,
) {
  return binding.capabilities[feature]
    ? undefined
    : hostText(binding.reasons?.[feature]) || t(reasons[feature] ?? '当前 CLI 不支持此功能')
}
