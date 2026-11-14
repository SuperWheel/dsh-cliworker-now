/** Compatibility entry point; descriptors and placement now live in artifacts/. */
export { canPrepareWindowsUpdate, validateOmpArtifact } from './artifacts/windows.ts'
import { describeWindowsUpdate } from './artifacts/windows.ts'
import { prepareArtifactBundle } from './artifacts/bundle.ts'
import type { LocalArtifactOptions } from './local-artifacts.ts'
export function prepareWindowsUpdate(options: LocalArtifactOptions) {
  options.output(`插件已接管 ${options.cli} 官方下载；校验 ${options.cli === 'antigravity' ? 'sha512' : 'sha256'}（同源发布清单，不等于独立签名）。\n`)
  return prepareArtifactBundle(options, (directory, signal) => describeWindowsUpdate({ ...options, signal }, directory))
}
