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

export interface EncryptedObjectLayout {
  headerLength: number
  metadataLength: number
  metadataEnd: number
  totalLength: number
}

export interface SealedAudioObjectParts {
  prefix: Uint8Array
  header: Uint8Array
  metadataCiphertext: Uint8Array
  audioCiphertext: Uint8Array
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

function validDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validMetadata(value: unknown): value is AudioMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const metadata = value as Partial<AudioMetadata>
  return (
    typeof metadata.fileName === 'string' &&
    validDateOnly(metadata.recordedDate) &&
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

function parseHeader(container: Uint8Array): {
  header: ContainerHeader
  headerEnd: number
} {
  const headerLength = readEncryptedHeaderLength(container)

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

  return { header: parsedHeader, headerEnd }
}

export function readEncryptedHeaderLength(prefix: Uint8Array): number {
  if (
    prefix.length < PREFIX_BYTES ||
    !MAGIC.every((byte, index) => prefix[index] === byte)
  ) {
    throw new Error('Invalid encrypted object')
  }
  const headerLength = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  ).getUint32(MAGIC.length, false)
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error('Invalid encrypted object')
  }
  return headerLength
}

export function readEncryptedObjectLayout(
  containerHeader: Uint8Array,
): EncryptedObjectLayout {
  const { header, headerEnd } = parseHeader(containerHeader)
  return {
    headerLength: headerEnd - PREFIX_BYTES,
    metadataLength: header.metadataLength,
    metadataEnd: headerEnd + header.metadataLength,
    totalLength: headerEnd + header.metadataLength + header.audioLength,
  }
}

function parseContainer(container: Uint8Array): ParsedContainer {
  const { header, headerEnd } = parseHeader(container)
  const metadataEnd = headerEnd + header.metadataLength
  const audioEnd = metadataEnd + header.audioLength
  if (audioEnd !== container.length) {
    throw new Error('Invalid encrypted object')
  }

  return {
    header,
    metadataCiphertext: container.subarray(headerEnd, metadataEnd),
    audioCiphertext: container.subarray(metadataEnd, audioEnd),
  }
}

export async function sealAudioObjectParts(
  audio: Uint8Array,
  metadata: AudioMetadata,
  encryptionSecret: string,
): Promise<SealedAudioObjectParts> {
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

  return {
    prefix,
    header: headerBytes,
    metadataCiphertext,
    audioCiphertext,
  }
}

export async function sealAudioObject(
  audio: Uint8Array,
  metadata: AudioMetadata,
  encryptionSecret: string,
): Promise<Uint8Array> {
  const sealed = await sealAudioObjectParts(audio, metadata, encryptionSecret)
  return concatenate([
    sealed.prefix,
    sealed.header,
    sealed.metadataCiphertext,
    sealed.audioCiphertext,
  ])
}

function parseMetadataBytes(metadataBytes: Uint8Array): AudioMetadata {
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
  return metadata
}

async function decryptMetadata(
  parsed: ParsedContainer,
  encryptionSecret: string,
): Promise<AudioMetadata> {
  const masterKey = await importMasterKey(encryptionSecret)
  const fileKey = await unwrapFileKey(
    decodeBase64Url(parsed.header.wrappedKey),
    masterKey,
    decodeBase64Url(parsed.header.wrappedKeyIv),
  )
  const metadataBytes = await decryptBytes(
    parsed.metadataCiphertext,
    fileKey,
    decodeBase64Url(parsed.header.metadataIv),
    'metadata',
  )
  return parseMetadataBytes(metadataBytes)
}

export async function openAudioMetadata(
  containerPrefix: Uint8Array,
  encryptionSecret: string,
): Promise<AudioMetadata> {
  const { header, headerEnd } = parseHeader(containerPrefix)
  const metadataEnd = headerEnd + header.metadataLength
  if (containerPrefix.length !== metadataEnd) {
    throw new Error('Invalid encrypted object')
  }
  return decryptMetadata(
    {
      header,
      metadataCiphertext: containerPrefix.subarray(headerEnd, metadataEnd),
      audioCiphertext: new Uint8Array(),
    },
    encryptionSecret,
  )
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

  const metadata = parseMetadataBytes(metadataBytes)
  return { audio, metadata }
}
