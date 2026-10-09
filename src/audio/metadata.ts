import type { WavInfo } from './wav'

export type RecordedDateSource = 'metadata' | 'filename' | 'upload'

export interface AudioMetadata {
  fileName: string
  recordedDate: string
  recordedDateSource: RecordedDateSource
  durationSec: number
  sequence: number | null
  tags: string[]
  memo: string
  uploadedAt: string
  mediaType?: string
}

export const MAX_MEMO_LENGTH = 200
export const MAX_TAGS = 20

const MAX_METADATA_CHUNK_BYTES = 1024 * 1024
const MAX_CHUNKS_TO_SCAN = 10_000
const textDecoder = new TextDecoder('utf-8')

function ascii(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }
  return value
}

async function readView(file: Blob, offset: number, length: number) {
  return new DataView(await file.slice(offset, offset + length).arrayBuffer())
}

function normalizeDate(value: string): string | null {
  const match = value.match(/(?:^|\D)(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?:\D|$)/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

function decodeText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes).replace(/\0.*$/s, '').trim()
}

function findInfoDate(view: DataView): string | null {
  if (view.byteLength < 4 || ascii(view, 0, 4) !== 'INFO') return null

  let offset = 4
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8
    if (size > view.byteLength - dataOffset) return null
    if (id === 'ICRD') {
      return normalizeDate(
        decodeText(new Uint8Array(view.buffer, view.byteOffset + dataOffset, size)),
      )
    }
    offset = dataOffset + size + (size % 2)
  }
  return null
}

export async function extractWavRecordedDate(file: Blob): Promise<string | null> {
  if (file.size < 12) return null
  const riff = await readView(file, 0, 12)
  if (ascii(riff, 0, 4) !== 'RIFF' || ascii(riff, 8, 4) !== 'WAVE') return null

  let broadcastDate: string | null = null
  let infoDate: string | null = null
  let offset = 12

  for (let scanned = 0; scanned < MAX_CHUNKS_TO_SCAN; scanned += 1) {
    if (offset + 8 > file.size) break
    const header = await readView(file, offset, 8)
    const id = ascii(header, 0, 4)
    const size = header.getUint32(4, true)
    const dataOffset = offset + 8
    if (size > file.size - dataOffset) break

    if (id === 'bext' && size >= 330) {
      const view = await readView(file, dataOffset + 320, 10)
      broadcastDate ??= normalizeDate(ascii(view, 0, 10))
    } else if (id === 'LIST' && size <= MAX_METADATA_CHUNK_BYTES) {
      infoDate ??= findInfoDate(await readView(file, dataOffset, size))
    }

    const nextOffset = dataOffset + size + (size % 2)
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) break
    offset = nextOffset
  }

  return broadcastDate ?? infoDate
}

export function parseRecordingFileName(fileName: string): {
  recordedDate: string
  sequence: number
} | null {
  const match = fileName.match(/^rec_(\d{4})(\d{2})(\d{2})_(\d+)\.[^.]+$/i)
  if (!match) return null
  const recordedDate = normalizeDate(`${match[1]}-${match[2]}-${match[3]}`)
  const sequence = Number(match[4])
  if (!recordedDate || !Number.isSafeInteger(sequence)) return null
  return { recordedDate, sequence }
}

export function normalizeTags(value: string): string[] {
  return [...new Set(value.split(/[,、\n]/).map((tag) => tag.trim()).filter(Boolean))]
}

export async function createAudioMetadata(
  file: File,
  audioInfo: Pick<WavInfo, 'durationSec'>,
  now = new Date(),
  inspectWavMetadata = true,
): Promise<AudioMetadata> {
  const uploadedAt = now.toISOString()
  const metadataDate = inspectWavMetadata ? await extractWavRecordedDate(file) : null
  const fileNameData = parseRecordingFileName(file.name)

  return {
    fileName: file.name,
    recordedDate:
      metadataDate ?? fileNameData?.recordedDate ?? uploadedAt.slice(0, 10),
    recordedDateSource: metadataDate
      ? 'metadata'
      : fileNameData
        ? 'filename'
        : 'upload',
    durationSec: Math.round(audioInfo.durationSec),
    sequence: fileNameData?.sequence ?? null,
    tags: [],
    memo: '',
    uploadedAt,
  }
}
