import type { Stats } from 'node:fs'
export const TEMPORARY_TREE_MAX_AGE_MS: number
export const temporaryTreeRemovalOptions: { recursive: true; force: true; maxRetries: number; retryDelay: number }
export function removeTemporaryTree(path: string, remove?: typeof import('node:fs/promises').rm): Promise<boolean>
export function markTemporaryTreeActive(path: string): void
export function temporaryTreeHasLiveOwner(path: string): Promise<boolean>
export function realDirectory(path: string): Promise<Stats | undefined>
export function prepareOmpNativesDirectory(stateDirectory?: string): Promise<string>
export function pruneOmpNativesDirectory(stateDirectory: string, signal?: AbortSignal, now?: number): Promise<void>
