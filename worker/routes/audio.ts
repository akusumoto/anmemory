import type { AppEnv } from '../env.ts'
import {
  MAX_AUDIO_BYTES,
  openAudioMetadata,
  openAudioObject,
  readEncryptedHeaderLength,
  readEncryptedObjectLayout,
  sealAudioObjectParts,
  type AudioMetadata,
} from '../encrypted-audio.ts'
import { jsonResponse, methodNotAllowed } from '../http.ts'

const AUDIO_PREFIX = 'audio/'
const PREFIX_BYTES = 12
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface AudioListItem extends AudioMetadata {
  id: string
}

function objectKey(id: string): string | null {
  return UUID_PATTERN.test(id) ? `${AUDIO_PREFIX}${id}.bin` : null
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

async function getRange(
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const object = await bucket.get(key, { range: { offset, length } })
  if (!object) throw new Error('Audio object not found')
  return new Uint8Array(await object.arrayBuffer())
}

async function readMetadata(
  bucket: R2Bucket,
  key: string,
  expectedSize: number,
  encryptionSecret: string,
): Promise<AudioMetadata> {
  const prefix = await getRange(bucket, key, 0, PREFIX_BYTES)
  const headerLength = readEncryptedHeaderLength(prefix)
  const containerHeader = await getRange(
    bucket,
    key,
    0,
    PREFIX_BYTES + headerLength,
  )
  const layout = readEncryptedObjectLayout(containerHeader)
  if (layout.totalLength !== expectedSize) throw new Error('Invalid audio object size')
  const metadataPrefix = await getRange(bucket, key, 0, layout.metadataEnd)
  return openAudioMetadata(metadataPrefix, encryptionSecret)
}

async function listAudio(env: AppEnv): Promise<Response> {
  const items: AudioListItem[] = []
  let cursor: string | undefined

  do {
    const page = await env.AUDIO_BUCKET.list({ prefix: AUDIO_PREFIX, cursor })
    for (const object of page.objects) {
      const id = object.key.slice(AUDIO_PREFIX.length, -4)
      const key = objectKey(id)
      if (!key || key !== object.key) continue
      const metadata = await readMetadata(
        env.AUDIO_BUCKET,
        key,
        object.size,
        env.ENCRYPTION_KEY,
      )
      items.push({ id, ...metadata })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  items.sort((left, right) => {
    const dateOrder = right.recordedDate.localeCompare(left.recordedDate)
    if (dateOrder !== 0) return dateOrder
    const sequenceOrder =
      (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER)
    return sequenceOrder || right.uploadedAt.localeCompare(left.uploadedAt)
  })
  return jsonResponse({ items })
}

async function uploadAudio(request: Request, env: AppEnv): Promise<Response> {
  const contentLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 128 * 1024) {
    return jsonResponse({ error: 'Audio file is too large' }, { status: 413 })
  }

  const form = await request.formData()
  const audioValue = form.get('audio')
  const metadataValue = form.get('metadata')
  if (!(audioValue instanceof File) || typeof metadataValue !== 'string') {
    return jsonResponse({ error: 'Invalid upload' }, { status: 400 })
  }
  if (
    audioValue.size === 0 ||
    audioValue.size > MAX_AUDIO_BYTES ||
    audioValue.type !== 'audio/mp4'
  ) {
    return jsonResponse({ error: 'Invalid audio file' }, { status: 400 })
  }

  let metadata: AudioMetadata
  try {
    metadata = JSON.parse(metadataValue) as AudioMetadata
  } catch {
    return jsonResponse({ error: 'Invalid metadata' }, { status: 400 })
  }

  try {
    const audio = new Uint8Array(await audioValue.arrayBuffer())
    const sealed = await sealAudioObjectParts(audio, metadata, env.ENCRYPTION_KEY)
    const encryptedBlob = new Blob(
      [
        sealed.prefix,
        sealed.header,
        sealed.metadataCiphertext,
        sealed.audioCiphertext,
      ],
      { type: 'application/octet-stream' },
    )
    const id = crypto.randomUUID()
    await env.AUDIO_BUCKET.put(`${AUDIO_PREFIX}${id}.bin`, encryptedBlob, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { version: '1' },
    })
    return jsonResponse({ id }, { status: 201 })
  } catch {
    return jsonResponse({ error: 'Unable to store audio' }, { status: 503 })
  }
}

async function getAudio(id: string, env: AppEnv): Promise<Response> {
  const key = objectKey(id)
  if (!key) return jsonResponse({ error: 'Not Found' }, { status: 404 })

  try {
    const object = await env.AUDIO_BUCKET.get(key)
    if (!object) return jsonResponse({ error: 'Not Found' }, { status: 404 })
    const opened = await openAudioObject(
      new Uint8Array(await object.arrayBuffer()),
      env.ENCRYPTION_KEY,
    )
    return new Response(opened.audio, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'audio/mp4',
        'Content-Length': String(opened.audio.length),
      },
    })
  } catch {
    return jsonResponse({ error: 'Unable to read audio' }, { status: 503 })
  }
}

async function updateAudio(
  request: Request,
  id: string,
  env: AppEnv,
): Promise<Response> {
  const key = objectKey(id)
  if (!key) return jsonResponse({ error: 'Not Found' }, { status: 404 })

  let update: { recordedDate?: unknown; tags?: unknown; memo?: unknown }
  try {
    update = (await request.json()) as {
      recordedDate?: unknown
      tags?: unknown
      memo?: unknown
    }
  } catch {
    return jsonResponse({ error: 'Invalid metadata' }, { status: 400 })
  }
  if (
    !validDateOnly(update.recordedDate) ||
    !Array.isArray(update.tags) ||
    !update.tags.every((tag) => typeof tag === 'string') ||
    typeof update.memo !== 'string'
  ) {
    return jsonResponse({ error: 'Invalid metadata' }, { status: 400 })
  }

  try {
    const object = await env.AUDIO_BUCKET.get(key)
    if (!object) return jsonResponse({ error: 'Not Found' }, { status: 404 })
    const opened = await openAudioObject(
      new Uint8Array(await object.arrayBuffer()),
      env.ENCRYPTION_KEY,
    )
    const metadata = {
      ...opened.metadata,
      recordedDate: update.recordedDate,
      tags: update.tags,
      memo: update.memo,
    }
    const sealed = await sealAudioObjectParts(
      opened.audio,
      metadata,
      env.ENCRYPTION_KEY,
    )
    const encryptedBlob = new Blob(
      [sealed.prefix, sealed.header, sealed.metadataCiphertext, sealed.audioCiphertext],
      { type: 'application/octet-stream' },
    )
    await env.AUDIO_BUCKET.put(key, encryptedBlob, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { version: '1' },
    })
    return jsonResponse({ item: { id, ...metadata } })
  } catch {
    return jsonResponse({ error: 'Unable to update audio' }, { status: 503 })
  }
}

async function deleteAudio(id: string, env: AppEnv): Promise<Response> {
  const key = objectKey(id)
  if (!key) return jsonResponse({ error: 'Not Found' }, { status: 404 })
  try {
    if (!(await env.AUDIO_BUCKET.head(key))) {
      return jsonResponse({ error: 'Not Found' }, { status: 404 })
    }
    await env.AUDIO_BUCKET.delete(key)
    return new Response(null, { status: 204 })
  } catch {
    return jsonResponse({ error: 'Unable to delete audio' }, { status: 503 })
  }
}

export async function handleAudio(
  request: Request,
  env: AppEnv,
  id?: string,
): Promise<Response> {
  try {
    if (!id) {
      if (request.method === 'GET') return listAudio(env)
      if (request.method === 'POST') return uploadAudio(request, env)
      return methodNotAllowed('GET, POST')
    }
    if (request.method === 'GET') return getAudio(id, env)
    if (request.method === 'PUT') return updateAudio(request, id, env)
    if (request.method === 'DELETE') return deleteAudio(id, env)
    return methodNotAllowed('GET, PUT, DELETE')
  } catch {
    return jsonResponse({ error: 'Unable to process audio request' }, { status: 503 })
  }
}
