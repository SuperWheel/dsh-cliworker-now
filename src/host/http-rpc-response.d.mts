import type { NativeResponseUsage, NativeResponseIdentity } from '../shared/types.ts'
import type { EventInput } from './protocol.ts'
export function sessionHttpResponseUsage(value: unknown): NativeResponseUsage | undefined
export function sessionHttpSessionUsage(value: unknown): { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number } | undefined
export function piOmpResponseUsage(value: unknown, cli: 'pi' | 'omp'): NativeResponseUsage | undefined
export function piOmpReportedUsage(value: unknown, cli: 'pi' | 'omp'): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; reasoning?: number; orchestration?: { input?: number; output?: number; cacheRead?: number } } | undefined
export class NativeBlockResponses {
  constructor(cli: string, emit: (event: EventInput) => void)
  event(id: string, blockId: string, event: EventInput, nativeIndex?: number): NativeResponseIdentity
  finish(id: string, usage?: NativeResponseUsage): void
  completed(id: string): boolean
}
export function modelRequestFailure(detail: unknown, aborted?: boolean): string
