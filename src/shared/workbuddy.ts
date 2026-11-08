import type { CliId } from './types.ts'

export const isWorkBuddy = (cli: CliId | undefined): boolean => cli === 'workbuddycn' || cli === 'workbuddy'
export const WORKBUDDY_EXPERIMENTAL_NOTICE = '试验性：依赖 WorkBuddy 桌面端非公开接口'
/** Short marker shown under the CLI name in the settings CLI list. */
export const EXPERIMENTAL_MARK = '试验性'
