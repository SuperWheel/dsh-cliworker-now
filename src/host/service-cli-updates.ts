import { cliTakeoverRequestSchema } from '../shared/cli-management.ts'
import { z as validate } from 'zod'
import { CLI_IDS } from '../shared/types.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

export async function cliUpdateSnapshot(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  // The update page is machine-wide: parent() records the project when it still exists, and a
  // conversation whose working directory was deleted must not break the page (ENOENT observed on Windows, 2026-11-17).
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.cliManagement.snapshot())
  } catch (error) {
    throw failure(error)
  }
}

export async function checkCliUpdates(
  host: ServiceContext,
  parentSessionId: string,
  scope: 'missing' | 'all',
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.cliManagement.check(validate.enum(['missing', 'all']).parse(scope)))
  } catch (error) {
    throw failure(error)
  }
}

export async function* watchCliUpdates(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  try {
    await host.parent(parentSessionId)
    for await (const snapshot of host.cliManagement.watch(signal)) yield JSON.stringify(snapshot)
  } catch (error) {
    throw failure(error)
  }
}

export async function startCliOperation(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  intent: 'update' | 'install',
  planToken: string,
  installDirectory: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    host.assertExecution(parent)
    signal.throwIfAborted()
    const id = validate.enum(CLI_IDS).parse(cli),
      action = validate.enum(['update', 'install']).parse(intent)
    const directory = validate.string().max(4096).parse(installDirectory)
    if (directory) {
      const check = await host.cliManagement.checkDirectory(id, directory, signal)
      if (check.problem) throw new Error(`LOCATION_INVALID：${check.message}`)
    }
    signal.throwIfAborted()
    return JSON.stringify(
      host.cliManagement.start(
        id,
        action,
        validate.string().max(128).parse(planToken),
        directory,
        validate.string().min(1).max(256).parse(requestId),
      ),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function updateAllClis(
  host: ServiceContext,
  parentSessionId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    host.assertExecution(parent)
    signal.throwIfAborted()
    return JSON.stringify(host.cliManagement.updateAll(validate.string().min(1).max(256).parse(requestId)))
  } catch (error) {
    throw failure(error)
  }
}

export async function cancelCliOperation(
  host: ServiceContext,
  parentSessionId: string,
  target: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.cliManagement.cancel(validate.string().min(1).max(256).parse(target)))
  } catch (error) {
    throw failure(error)
  }
}

export async function requestCliTakeover(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  operationId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    host.assertExecution(parent)
    signal.throwIfAborted()
    const request = cliTakeoverRequestSchema.parse({ cli, operationId })
    return JSON.stringify(await host.cliManagement.requestTakeover(request.cli, request.operationId))
  } catch (error) {
    throw failure(error)
  }
}

export async function chooseInstallDirectory(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(await host.cliManagement.chooseDirectory(validate.enum(CLI_IDS).parse(cli), signal))
  } catch (error) {
    throw failure(error)
  }
}

export async function checkInstallDirectory(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(
      await host.cliManagement.checkDirectory(
        validate.enum(CLI_IDS).parse(cli),
        validate.string().max(4096).parse(path),
        signal,
      ),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function cliDownloadSource(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(await host.cliManagement.downloadSource(signal))
  } catch (error) {
    throw failure(error)
  }
}

export async function saveCliDownloadSource(
  host: ServiceContext,
  parentSessionId: string,
  json: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.cliManagement.saveDownloadSource(JSON.parse(json)))
  } catch (error) {
    throw failure(error)
  }
}

export async function testCliDownloadSource(
  host: ServiceContext,
  parentSessionId: string,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(await host.cliManagement.testDownloadSource(url, signal))
  } catch (error) {
    throw failure(error)
  }
}
