export const WORKBUDDY_CLIS = ['workbuddycn', 'workbuddy'] as const
export type WorkBuddyCliId = typeof WORKBUDDY_CLIS[number]

export function isWorkBuddyCli(cli: unknown): cli is WorkBuddyCliId {
  return cli === 'workbuddycn' || cli === 'workbuddy'
}

/** Names are discovery hints only. product.json determines the installed site. */
export function workbuddyVariant(cli: WorkBuddyCliId) {
  if (!isWorkBuddyCli(cli)) throw new Error('Unknown WorkBuddy variant')
  return cli === 'workbuddycn'
    ? { cli, label: 'WorkBuddy', endpointHosts: ['www.workbuddy.cn', 'workbuddy.cn'],
        dataFolderName: '.workbuddy', macAppNames: ['WorkBuddy.app', 'WorkBuddy AI.app'],
        windowsDirectoryNames: ['WorkBuddy', 'WorkBuddy AI'], transport: 'workbuddycn-acp-v1' }
    : { cli, label: 'WorkBuddy AI', endpointHosts: ['www.workbuddy.ai', 'workbuddy.ai'],
        dataFolderName: '.workbuddy', macAppNames: ['WorkBuddy AI.app', 'WorkBuddy.app'],
        windowsDirectoryNames: ['WorkBuddy AI', 'WorkBuddy'], transport: 'workbuddy-acp-v1' }
}
