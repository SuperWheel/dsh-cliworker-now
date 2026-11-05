import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type tsTypes from 'typescript'
import { selectBuildDependencies } from '../scripts/build-dependencies.mjs'
import { normalizeAugmentationImports } from '../scripts/build.mjs'

const selected = selectBuildDependencies(resolve('.'), {})
const ts: typeof tsTypes = selected.require('typescript')
const { WorkspaceTypertGenerator } = await import(pathToFileURL(selected.require.resolve('@deepseek-ai/dsh-typert-generator')).href)
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

// Synthetic SDK declaration workspace; no CLI, model, or Desktop process.
function fixture(consumer: string, provider = 'export interface Map {}\nexport type Wrapper<T> = { value: T };\nexport type Other<T> = { other: T };') {
  const root = mkdtempSync(join(tmpdir(), 'cwn-typert-augmentations-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  const paths: Record<string, string[]> = {}
  const files: string[] = []
  const references: { path: string }[] = []
  for (const [name, text] of [['provider', provider], ['consumer', consumer]]) {
    const directory = join(root, 'packages', name)
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'index.d.ts')
    files.push(file)
    paths[`@fixture/${name}`] = [file]
    writeFileSync(file, text)
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: `@fixture/${name}`, type: 'module',
      exports: { '.': { types: './index.d.ts', default: './index.d.ts' },
        './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' } },
      files: ['lib/typert.host.js', 'lib/typert.host.d.ts'],
    }))
    writeFileSync(join(directory, 'tsconfig.host.json'), JSON.stringify({ include: ['*.d.ts'] }))
    references.push({ path: join(directory, 'tsconfig.host.json') })
  }
  const options: tsTypes.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, types: [], paths }
  writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [], paths },
    files: [], references,
  }))
  return { root, files, options, generate: () => new WorkspaceTypertGenerator(root, { checkDiagnostics: false }).generate(['@fixture/consumer'], ['host']) }
}

function diagnostics(files: string[], options: tsTypes.CompilerOptions) {
  return ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: files, options: { ...options, noEmit: true } }))
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

it('restores declaration-only augmentation imports and preserves the authored Typert contract', () => {
  const body = `import type { Map } from '@fixture/provider';
declare module '@fixture/provider' {
  interface Map { first: Wrapper<string>; second: Other<number>; repeated: Wrapper<boolean>; }
}
/** @typert object */
export interface Root { map: Map; }
`
  const { root, files, options, generate } = fixture(body)
  const authoredPath = join(root, 'authored.ts')
  writeFileSync(authoredPath, body.replace('{ Map }', '{ Map, Wrapper, Other }'))
  const emitted: string[] = []
  const authored = ts.createProgram({ rootNames: [authoredPath], options: { ...options, declaration: true, emitDeclarationOnly: true } })
  expect(ts.getPreEmitDiagnostics(authored)).toEqual([])
  expect(authored.emit(undefined, (file, text) => { if (file.endsWith('.d.ts')) emitted.push(text) }).emitSkipped).toBe(false)
  expect(emitted).toHaveLength(1)
  expect(emitted[0]).toContain('import type { Map }')
  expect(emitted[0]).not.toContain('import type { Map, Wrapper, Other }')
  writeFileSync(files[1], emitted[0])
  expect(diagnostics(files, options)).toEqual([])
  expect(() => generate()).toThrow('crosses a package without an explicit package import')
  const installed = join(root, 'published.d.ts')
  writeFileSync(installed, emitted[0])
  const changes = normalizeAugmentationImports(ts, files, options)
  expect(changes).toHaveLength(1)
  expect(changes[0].imports.map((entry: { name: string }) => entry.name)).toEqual(['Wrapper', 'Other'])
  expect(diagnostics(files, options)).toEqual([])
  const normalized = generate()[0]
  expect(normalizeAugmentationImports(ts, files, options)).toEqual([])
  expect(readFileSync(installed, 'utf8')).toBe(emitted[0])
  writeFileSync(files[1], `import type { Wrapper, Other } from '@fixture/provider';\n${emitted[0]}`)
  const explicit = generate()[0]
  expect(normalized.dts).toBe(explicit.dts)
  expect(normalized.js).toBe(explicit.js)
}, 30_000)

it('preserves shadowed names, explicit imports, local declarations, and leading directives', () => {
  const body = `/// <reference lib="esnext" />
import type { Map, Other as ImportedOther } from '@fixture/provider';
type Wrapper = { outside: true };
type __typertAugmentation0 = 'reserved';
declare module '@fixture/provider' {
  interface Local { local: true }
  interface Map {
    first: Wrapper<string>;
    explicit: ImportedOther<number>;
    local: Local;
    generic<Wrapper>(value: Wrapper): Wrapper;
  }
}
export type Outside = Wrapper;
export type Reserved = __typertAugmentation0;
export type Result = Map;
`
  const { root, files, options } = fixture(body)
  const assertion = join(root, 'assertion.ts')
  writeFileSync(assertion, `import type { Result, Outside, Reserved } from '@fixture/consumer';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type A = Assert<Equal<Result['first'], { value: string }>>;
type B = Assert<Equal<Outside, { outside: true }>>;
type C = Assert<Equal<Result['generic'], <T>(value: T) => T>>;
type D = Assert<Equal<Reserved, 'reserved'>>;
type E = Assert<Equal<Result['explicit'], { other: number }>>;
`)
  expect(diagnostics([...files, assertion], options)).toEqual([])
  const changes = normalizeAugmentationImports(ts, files, options)
  expect(changes[0].imports.map((entry: { name: string }) => entry.name)).toEqual(['Wrapper'])
  expect(readFileSync(files[1], 'utf8').startsWith('/// <reference lib="esnext" />')).toBe(true)
  expect(diagnostics([...files, assertion], options)).toEqual([])
}, 30_000)

it('leaves unresolved names and unrelated analyzer failures visible', () => {
  const { files, options, generate } = fixture(`import type { Map } from '@fixture/provider';
declare module '@fixture/provider' { interface Map { good: Wrapper<string>; bad: Missing; } }
/** @typert object */
export interface Root { map: Map; }
`)
  normalizeAugmentationImports(ts, files, options)
  expect(diagnostics(files, options)).toContain("Cannot find name 'Missing'.")
  expect(() => generate()).toThrow()
}, 30_000)
