const runtimeExtension = /\.(?:mjs|cjs|py|ps1)$/
const declarationExtension = '.d.mts'

// Unbundled Host modules also use these ESM helpers without a .d.mts companion.
const unbundledHelpers = new Set([
  'codebuddy-context-inspection.mjs',
  'hermes-observer.mjs',
  'native-acp.mjs',
  'native-codebuddy.mjs',
  'native-harness-extension.mjs',
  'native-harness-mcp.mjs',
  'native-http.mjs',
  'native-spawn.mjs',
  'native-transport.mjs',
  'private-launch.mjs',
  'windows-account-launch.mjs',
  'windows-account-stdio.mjs',
  'windows-hidden-launch.mjs',
])

// These sidecars are loaded at runtime, so TypeScript cannot report their absence.
const requiredSidecars = [
  'hermes-native-entry.py',
  'hermes-nous-refresh.py',
  'hermes-observer.py',
  'native-file-privacy.ps1',
  'windows-account-bootstrap.ps1',
  'windows-account-owner.ps1',
  'windows-agy-account.ps1',
  'windows-credential-read.ps1',
  'workbuddy-key-helper.cjs',
  'zcode-app-resolve.cjs',
]

/** Plan copies from the filenames in the top level of src/host. No filesystem access. */
export function buildHostCopyManifest(fileNames) {
  const names = new Set(fileNames)
  const requireSource = (name) => {
    if (!names.has(name)) throw new Error(`Missing Host build source: src/host/${name}`)
  }
  for (const name of [...unbundledHelpers, ...requiredSidecars]) requireSource(name)

  const copies = []
  for (const name of [...names].sort()) {
    const source = `src/host/${name}`
    if (name.endsWith(declarationExtension)) {
      requireSource(`${name.slice(0, -declarationExtension.length)}.mjs`)
      copies.push({ source, destination: `lib/types/host/${name}` })
    } else if (runtimeExtension.test(name)) {
      copies.push({ source, destination: `lib/${name}` })
      if (!name.endsWith('.mjs') || unbundledHelpers.has(name) || names.has(name.replace(/\.mjs$/, declarationExtension))) {
        copies.push({ source, destination: `lib/types/host/${name}` })
      }
    }
  }
  return copies
}
