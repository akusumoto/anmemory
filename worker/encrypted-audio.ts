import {
  AES_GCM_IV_BYTES,
  decryptBytes,
  encryptBytes,
  generateFileKey,
  importMasterKey,
  randomIv,
  unwrapFileKey,
  wrapFileKey,
} from './crypto.ts'
import { decodeBase64Url, encodeBase64Url } from './encoding.ts'

const MAGIC = new TextEncoder().encode('ANMEM001')
const PREFIX_BYTES = MAGIC.length + 4
const MAX_HEADER_BYTES = 16 * 1024
const MAX_METADATA_BYTES = 64 * 1024
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024

export interface AudioMetadata {
  fileName: string
  recordedDate: string
  recordedDateSource: 'metadata' | 'filename' | 'upload'
  durationSec: number
  sequence: number | null
  tags: string[]
  memo: string
  uploadedAt: string
}

interface ContainerHeader {
  version: 1
  algorithm: 'AES-256-GCM'
  audioIv: string
  metadataIv: string
  wrappedKey: string
  wrappedKeyIv: string
  audioLength: number
  metadataLength: number
}

interface ParsedContainer {
  header: ContainerHeader
  audioCiphertext: Uint8Array
  metadataCiphertext: Uint8Array
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function validMetadata(value: unknown): value is AudioMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const metadata = value as Partial<AudioMetadata>
  return (
    typeof metadata.fileName === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(metadata.recordedDate ?? '') &&
    ['metadata', 'filename', 'upload'].includes(
      metadata.recordedDateSource ?? '',
    ) &&
    typeof metadata.durationSec === 'number' &&
    Number.isFinite(metadata.durationSec) &&
    metadata.durationSec >= 0 &&
    (metadata.sequence === null ||
      (Number.isSafeInteger(metadata.sequence) &&
        typeof metadata.sequence === 'number' &&
        metadata.sequence >= 0)) &&
    Array.isArray(metadata.tags) &&
    metadata.tags.every((tag) => typeof tag === 'string') &&
    typeof metadata.memo === 'string' &&
    typeof metadata.uploadedAt === 'string' &&
    Number.isFinite(Date.parse(metadata.uploadedAt))
  )
}

function validHeader(value: unknown): value is ContainerHeader {
  if (!value || typeof value !== 'object') {
    return false
  }

  const header = value as Partial<ContainerHeader>
  try {
    return (
      header.version === 1 &&
      header.algorithm === 'AES-256-GCM' &&
      decodeBase64Url(header.audioIv ?? '').length === AES_GCM_IV_BYTES &&
      decodeBase64Url(header.metadataIv ?? '').length === AES_GCM_IV_BYTES &&
      decodeBase64Url(header.wrappedKeyIv ?? '').length === AES_GCM_IV_BYTES &&
      decodeBase64Url(header.wrappedKey ?? '').length === 48 &&
      Number.isSafeInteger(header.audioLength) &&
      typeof header.audioLength === 'number' &&
      header.audioLength >= 16 &&
      header.audioLength <= MAX_AUDIO_BYTES + 16 &&
      Number.isSafeInteger(header.metadataLength) &&
      typeof header.metadataLength === 'number' &&
      header.metadataLength >= 16 &&
      header.metadataLength <= MAX_METADATA_BYTES + 16
    )
  } catch {
    return false
  }
}

function parseContainer(container: Uint8Array): ParsedContainer {
  if (
    container.length < PREFIX_BYTES ||
    !MAGIC.every((byte, index) => container[index] === byte)
  ) {
    throw new Error('Invalid encrypted object')
  }

  const view = new DataView(
    container.buffer,
    container.byteOffset,
    container.byteLength,
  )
  const headerLength = view.getUint32(MAGIC.length, false)
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error('Invalid encrypted object')
  }

  const headerEnd = PREFIX_BYTES + headerLength
  if (headerEnd > container.length) {
    throw new Error('Invalid encrypted object')
  }

  let parsedHeader: unknown
  try {
    parsedHeader = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        container.subarray(PREFIX_BYTES, headerEnd),
      ),
    )
  } catch {
    throw new Error('Invalid encrypted object')
  }
  if (!validHeader(parsedHeader)) {
    throw new Error('Invalid encrypted object')
  }

  const metadataEnd = headerEnd + parsedHeader.metadataLength
  const audioEnd = metadataEnd + parsedHeader.audioLength
  if (audioEnd !== container.length) {
    throw new Error('Invalid encrypted object')
  }

  return {
    header: parsedHeader,
    metadataCiphertext: container.subarray(headerEnd, metadataEnd),
    audioCiphertext: container.subarray(metadataEnd, audioEnd),
  }
}

export async function sealAudioObject(
  audio: Uint8Array,
  metadata: AudioMetadata,
  encryptionSecret: string,
): Promise<Uint8Array> {
  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) {
    throw new Error('Invalid audio size')
  }
  if (!validMetadata(metadata)) {
    throw new Error('Invalid audio metadata')
  }

  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata))
  if (metadataBytes.length > MAX_METADATA_BYTES) {
    throw new Error('Audio metadata is too large')
  }

  const masterKey = await importMasterKey(encryptionSecret)
  const fileKey = await generateFileKey()
  const audioIv = randomIv()
  const metadataIv = randomIv()
  const wrappedKeyIv = randomIv()

  const [audioCiphertext, metadataCiphertext, wrappedKey] = await Promise.all([
    encryptBytes(audio, fileKey, audioIv, 'audio'),
    encryptBytes(metadataBytes, fileKey, metadataIv, 'metadata'),
    wrapFileKey(fileKey, masterKey, wrappedKeyIv),
  ])

  const header: ContainerHeader = {
    version: 1,
    algorithm: 'AES-256-GCM',
    audioIv: encodeBase64Url(audioIv),
    metadataIv: encodeBase64Url(metadataIv),
    wrappedKey: encodeBase64Url(wrappedKey),
    wrappedKeyIv: encodeBase64Url(wrappedKeyIv),
    audioLength: audioCiphertext.length,
    metadataLength: metadataCiphertext.length,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const prefix = new Uint8Array(PREFIX_BYTES)
  prefix.set(MAGIC)
  new DataView(prefix.buffer).setUint32(MAGIC.length, headerBytes.length, false)

  return concatenate([
    prefix,
    headerBytes,
    metadataCiphertext,
    audioCiphertext,
  ])
}

export async function openAudioObject(
  container: Uint8Array,
  encryptionSecret: string,
): Promise<{ audio: Uint8Array; metadata: AudioMetadata }> {
  const parsed = parseContainer(container)
  const masterKey = await importMasterKey(encryptionSecret)
  const fileKey = await unwrapFileKey(
    decodeBase64Url(parsed.header.wrappedKey),
    masterKey,
    decodeBase64Url(parsed.header.wrappedKeyIv),
  )

  const [audio, metadataBytes] = await Promise.all([
    decryptBytes(
      parsed.audioCiphertext,
      fileKey,
      decodeBase64Url(parsed.header.audioIv),
      'audio',
    ),
    decryptBytes(
      parsed.metadataCiphertext,
      fileKey,
      decodeBase64Url(parsed.header.metadataIv),
      'metadata',
    ),
  ])

  let metadata: unknown
  try {
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        metadataBytes,
      ),
    )
  } catch {
    throw new Error('Invalid encrypted metadata')
  }
  if (!validMetadata(metadata)) {
    throw new Error('Invalid encrypted metadata')
  }

  return { audio, metadata }
}
