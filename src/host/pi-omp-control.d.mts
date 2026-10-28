export function nativeControlPathKey(path: string, platform?: string): string
export function createPiOmpControl(
  directory: string,
  options?: { timeoutMs?: number },
): Promise<{
  nonce: string
  steer: (message: string, requestId: string, signal?: AbortSignal) => Promise<void>
  close: () => Promise<void>
}>
export function receivePiOmpControl(
  directory: string,
  nonce: string,
  handle: (message: string, requestId: string, attempt: string) => Promise<void>,
): Promise<{ close: () => Promise<void> }>
export const createNativeGuidanceControl: typeof createPiOmpControl
export const receiveNativeGuidanceControl: typeof receivePiOmpControl
export function createNativeStopControl(
  directory: string,
  options?: { timeoutMs?: number },
): Promise<{
  nonce: string
  stop: () => Promise<void>
  close: () => Promise<void>
}>
export function receiveNativeStopControl(
  directory: string,
  nonce: string,
  handle: () => Promise<void>,
): Promise<{ close: () => Promise<void> }>
export const createNativeApprovalControl: typeof createPiOmpControl
export const receiveNativeApprovalControl: typeof receivePiOmpControl
