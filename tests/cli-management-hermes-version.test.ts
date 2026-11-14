/** 模拟：只读临时 Git 元数据，不执行 Git 或 Hermes。 */
import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { mkdtemp, realpath, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesCheckoutVersion } from '../src/host/cli-management/hermes-version.ts'
const roots: string[] = [], head = 'b'.repeat(40), old = 'a'.repeat(40)
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hermes-version-simulated-'))); roots.push(root)
  await mkdir(join(root, '.git/refs/tags'), { recursive: true }); await mkdir(join(root, '.git/refs/heads'))
  await writeFile(join(root, '.git/HEAD'), head)
  return root
}
async function looseObject(root: string, body: string, header = `tag ${Buffer.byteLength(body)}`) {
  const data = Buffer.from(`${header}\0${body}`), object = createHash('sha1').update(data).digest('hex')
  const dir = join(root, '.git/objects', object.slice(0, 2)), path = join(dir, object.slice(2))
  await mkdir(dir, { recursive: true }); await writeFile(path, deflateSync(data))
  return { object, path }
}
it('模拟真实布局：松散注释标签对象剥离至 v0.23.1 HEAD，旧安装记录可回读目标版本', async () => {
  const root = await fixture(), commit = '3b421578588243f920886e6fe79a6faa87ea026e'
  await writeFile(join(root, '.git/HEAD'), commit)
  const { object } = await looseObject(root, `object ${commit}\ntype commit\ntag v0.23.1\ntagger Fixture <fixture@example.invalid> 1 +0000\n\nv0.23.1\n`)
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), `${object}\n`)
  expect(await hermesCheckoutVersion(root, old)).toEqual({ version: '0.23.1', commit })
})
it.each([2, 8, 9])('模拟：嵌套注释标签有界解析（%i 层，最多 8 层）', async depth => {
  const root = await fixture()
  let target = head
  for (let n = 0; n < depth; n++) target = (await looseObject(root, `object ${target}\ntype ${n === 0 ? 'commit' : 'tag'}\ntag nested-${n}\n\nfixture\n`)).object
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), target)
  expect(await hermesCheckoutVersion(root, old)).toEqual(depth <= 8 ? { version: '0.23.1', commit: head } : undefined)
})
it.each(['wrong-size', 'wrong-type', 'oversized-inflate', 'corrupt', 'oversized-file'])('模拟：拒绝损坏或超限的松散标签对象（%s）', async mode => {
  const root = await fixture(), body = `object ${head}\ntype commit\ntag v0.23.1\n\nfixture\n`
  const { object, path } = await looseObject(root, mode === 'oversized-inflate' ? body + 'x'.repeat(65536) : body,
    mode === 'wrong-size' ? 'tag 1' : mode === 'wrong-type' ? `blob ${Buffer.byteLength(body)}` : undefined)
  if (mode === 'corrupt') await writeFile(path, deflateSync(Buffer.from(`tag ${Buffer.byteLength(body)}\0${body.replace(head, old)}`)))
  if (mode === 'oversized-file') await writeFile(path, Buffer.alloc(65537))
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), object)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
it.each(['file', 'directory'])('模拟：不沿松散对象的符号链接读取（%s）', async mode => {
  const root = await fixture(), body = `object ${head}\ntype commit\ntag v0.23.1\n\nfixture\n`
  const { object, path } = await looseObject(root, body)
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), object)
  if (mode === 'file') {
    await rm(path); await writeFile(join(root, 'external-object'), deflateSync(Buffer.from(`tag ${Buffer.byteLength(body)}\0${body}`)))
    await symlink(join(root, 'external-object'), path)
  } else {
    await rm(join(root, '.git/objects'), { recursive: true })
    await mkdir(join(root, 'external-objects', object.slice(0, 2)), { recursive: true })
    await writeFile(join(root, 'external-objects', object.slice(0, 2), object.slice(2)), deflateSync(Buffer.from(`tag ${Buffer.byteLength(body)}\0${body}`)))
    await symlink(join(root, 'external-objects'), join(root, '.git/objects'))
  }
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
it('模拟：仅在 packfile 的未知标签对象不误匹配，也不恢复被松散引用覆盖的 packed peeled 值', async () => {
  const root = await fixture(), object = 'c'.repeat(40)
  await writeFile(join(root, '.git/packed-refs'), `${old} refs/tags/v0.23.1\n^${head}\n`)
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), object)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
  await rm(join(root, '.git/refs/tags/v0.23.1'))
  await writeFile(join(root, '.git/packed-refs'), `${object} refs/tags/v0.23.1\n`)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
it.each(['detached', 'branch', 'packed-branch'])('模拟：%s HEAD 精确匹配稳定标签才覆盖旧安装记录', async mode => {
  const root = await fixture()
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), head)
  if (mode !== 'detached') await writeFile(join(root, '.git/HEAD'), 'ref: refs/heads/main')
  if (mode === 'branch') await writeFile(join(root, '.git/refs/heads/main'), head)
  if (mode === 'packed-branch') await writeFile(join(root, '.git/packed-refs'), `${head} refs/heads/main\n`)
  expect(await hermesCheckoutVersion(root, old)).toEqual({ version: '0.23.1', commit: head })
  expect(await hermesCheckoutVersion(root, head)).toBeUndefined()
})
it('模拟：packed 注释标签使用 peeled SHA，松散引用覆盖 packed 引用', async () => {
  const root = await fixture()
  await writeFile(join(root, '.git/packed-refs'), `${old} refs/tags/v0.23.1\n^${head}\n`)
  expect(await hermesCheckoutVersion(root, old)).toEqual({ version: '0.23.1', commit: head })
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), old)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
it('模拟：无精确标签、预发布或同提交多个稳定版本均不猜版本', async () => {
  const root = await fixture()
  await writeFile(join(root, '.git/refs/tags/v0.23.0'), old)
  await writeFile(join(root, '.git/refs/tags/v0.23.1-rc.1'), head)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
  await writeFile(join(root, '.git/refs/tags/v0.23.1'), head)
  await writeFile(join(root, '.git/refs/tags/v0.23.2'), head)
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
it('模拟：不沿符号链接或越界 HEAD 读取版本', async () => {
  const root = await fixture()
  await writeFile(join(root, 'external'), head); await symlink(join(root, 'external'), join(root, '.git/refs/tags/v0.23.1'))
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
  await writeFile(join(root, '.git/HEAD'), 'ref: refs/heads/../../external')
  expect(await hermesCheckoutVersion(root, old)).toBeUndefined()
})
