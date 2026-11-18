import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createTypeScriptImportResolver, defaultExtensionAlias } from 'eslint-import-resolver-typescript'
import importX from 'eslint-plugin-import-x'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const root = import.meta.dirname
const tsconfig = join(root, 'tsconfig.eslint.json')
const host = join(root, 'src/host')
const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']
const sourceFiles = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'
const resolver = createTypeScriptImportResolver({
  project: tsconfig,
  alwaysTryTypes: false,
  extensionAlias: {
    ...defaultExtensionAlias,
    // Follow the runtime implementation before any adjacent declaration file.
    '.js': ['.js', '.ts', '.tsx', '.d.ts'],
    '.mjs': ['.mjs', '.mts', '.d.mts'],
    '.cjs': ['.cjs', '.cts', '.d.cts'],
  },
})

function restrictImports(isRestricted, message) {
  return {
    meta: { type: 'problem', schema: [], messages: { restricted: message } },
    create(context) {
      function check(node) {
        const specifier =
          node?.type === 'TemplateLiteral' && node.expressions.length === 0
            ? node.quasis[0].value.cooked
            : node?.value
        if (typeof specifier === 'string' && isRestricted(specifier, context.physicalFilename)) {
          context.report({ node, messageId: 'restricted', data: { module: specifier } })
        }
      }

      return {
        'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType'(
          node,
        ) {
          check(node.source)
        },
        TSExternalModuleReference(node) {
          check(node.expression)
        },
        'CallExpression[callee.type="Identifier"][callee.name="require"]'(node) {
          check(node.arguments[0])
        },
      }
    },
  }
}

function importsHost(specifier, importer) {
  const target =
    resolver.resolve(specifier, importer).path ??
    (specifier.startsWith('.') || isAbsolute(specifier) ? resolve(dirname(importer), specifier) : undefined)
  if (!target) return false
  const fromHost = relative(host, target)
  return fromHost !== '..' && !fromHost.startsWith(`..${sep}`) && !isAbsolute(fromHost)
}

const architecture = {
  rules: {
    'no-host-imports': restrictImports(
      importsHost,
      'Client and shared code cannot import Host module {{module}}.',
    ),
    'no-node-imports': restrictImports(
      (specifier) => specifier.startsWith('node:'),
      'Shared code cannot import Node.js module {{module}}.',
    ),
  },
}

export default [
  {
    ignores: [
      '**/node_modules/',
      'lib/',
      'dist/',
      'artifacts/',
      '.test-data/',
      '.cache/',
      '.claude/',
      'runtime-host/',
      'host-extensions/',
      'vendor/',
      'openspec/',
      'doc/',
      'promotion/',
      'coverage/',
      'tests/',
      '**/generated/',
      '**/*.generated.*',
      '**/*.gen.*',
      '**/.env*',
      '**/.dev.vars',
    ],
  },
  {
    files: [`{src,scripts}/${sourceFiles}`],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/extensions': extensions,
      'import-x/resolver-next': [resolver],
    },
    rules: {
      'import-x/no-cycle': ['warn', { commonjs: true, maxDepth: 5, ignoreExternal: true }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['{src,scripts}/**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parserOptions: { project: tsconfig, tsconfigRootDir: root } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: [`src/{client,shared}/${sourceFiles}`],
    plugins: { architecture },
    rules: { 'architecture/no-host-imports': 'error' },
  },
  {
    files: [`src/shared/${sourceFiles}`],
    rules: { 'architecture/no-node-imports': 'error' },
  },
  {
    files: [`src/client/${sourceFiles}`],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/exhaustive-deps': 'warn' },
  },
]
