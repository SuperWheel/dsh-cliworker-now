import type { downloadCliArtifact } from '../download.ts'
import type { ArtifactFile } from './types.ts'
/** Translate validated publisher fields, without maintaining another transport. */
export type LegacyDownloadData = Pick<Parameters<typeof downloadCliArtifact>[0], 'url' | 'integrity' | 'expectedBytes' | 'officialSignedArtifact' | 'sources' | 'requireContentMd5'>
export function toFile(data: LegacyDownloadData, dest: string): ArtifactFile {
  return { sources: data.sources ?? [data.url], bytes: data.expectedBytes ?? (data.requireContentMd5 ? 'HEAD' : undefined),
    integrity: data.requireContentMd5 ? 'response-md5' : data.integrity, dest, officialSignedArtifact: data.officialSignedArtifact }
}
