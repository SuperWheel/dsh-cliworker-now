export const CODEBUDDY_PERMISSION_DENIED: string
export function codebuddyPermissionDenied(result: unknown): boolean
export function createCodeBuddyAcpOutcome(): {
  receive<T>(message: T): T
  clear(): void
  permissionDenied(result: unknown): boolean
}
