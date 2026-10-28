export const LAST_TOOL_FAILED: string
export function recoveredNotice(count: number): string
export interface ToolOutcomes {
  failed(id?: unknown): void
  succeeded(): void
  readonly count: number
  readonly lastFailed: boolean
  settle(
    io: { result(status: string, response: string, error?: string, resultScope?: string, notice?: string): void },
    response: string,
    resultScope: string,
    denied?: boolean,
  ): void
}
export function createToolOutcomes(): ToolOutcomes
