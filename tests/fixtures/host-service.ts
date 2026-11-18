import { CliWorkerService } from '../../src/host/index.ts'

/** Build a synthetic Remote facade and supply the same per-instance collaborators as the Host. */
export function hostServiceFixture(fields: Record<string, unknown> = {}): CliWorkerService {
  const service: CliWorkerService = Object.create(CliWorkerService.prototype)
  Object.assign(service['host'], fields)
  return service
}
