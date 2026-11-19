import { ServiceContext } from '../../src/host/service-context.ts'
import { CliWorkerService } from '../../src/host/index.ts'

/** Build a synthetic Remote facade and supply the same per-instance collaborators as the Host. */
export function hostServiceFixture(fields: Record<string, unknown> = {}) {
  const service = Object.create(CliWorkerService.prototype)
  const context = new ServiceContext(service['ctx'], service)
  Object.assign(service, { context })
  Object.assign(
    context,
    { dshSubagents: { readDirectoryNames: async () => [], occupiedNames: () => new Set() } },
    fields,
  )
  return service
}
