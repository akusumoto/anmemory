import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppEnv } from '../worker/env.ts'
import type { AudioMetadata } from '../worker/encrypted-audio.ts'
import { encodeBase64Url } from '../worker/encoding.ts'
import { handleAudio } from '../worker/routes/audio.ts'

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>()
  readonly customMetadata = new Map<string, Record<string, string>>()
  getCount = 0

  async put(key: string, value: Blob, options?: R2PutOptions) {
    this.objects.set(key, new Uint8Array(await value.arrayBuffer()))
    this.customMetadata.set(key, { ...options?.customMetadata })
    return {} as R2Object
  }

  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    this.getCount += 1
    const stored = this.objects.get(key)
    if (!stored) return null
    const range = options?.range
    const bytes = range
      ? stored.slice(range.offset, range.offset + range.length)
      : stored
    return {
      arrayBuffer: async () => bytes.slice().buffer,
    } as R2ObjectBody
  }

  async head(key: string) {
    return this.objects.has(key) ? ({} as R2Object) : null
  }

  async delete(key: string) {
    this.objects.delete(key)
    this.customMetadata.delete(key)
  }

  async list(options?: R2ListOptions) {
    const includeCustomMetadata = options?.include?.includes('customMetadata')
    return {
      objects: [...this.objects].map(([key, value]) => ({
        key,
        size: value.length,
        customMetadata: includeCustomMetadata ? this.customMetadata.get(key) : undefined,
      })),
      truncated: false,
      delimitedPrefixes: [],
    } as unknown as R2Objects
  }
}

const metadata: AudioMetadata = {
  fileName: 'rec_20260911_1.wav',
  recordedDate: '2026-09-11',
  recordedDateSource: 'filename',
  durationSec: 1,
  sequence: 1,
  tags: ['会議'],
  memo: 'route test',
  uploadedAt: '2026-09-12T00:00:00.000Z',
  mediaType: 'audio/mp4',
}

test('compressed MP3 is stored unchanged and returned with its media type', async () => {
  const bucket = new MemoryBucket()
  const env = {
    AUDIO_BUCKET: bucket,
    ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(29)),
  } as unknown as AppEnv
  const original = new Uint8Array([73, 68, 51, 4, 0, 0])
  const form = new FormData()
  form.set('audio', new File([original], 'recording.mp3', { type: 'audio/mpeg' }))
  form.set('metadata', JSON.stringify({
    ...metadata,
    fileName: 'recording.mp3',
    mediaType: 'application/octet-stream',
  }))

  const upload = await handleAudio(
    new Request('https://example.test/api/audio', { method: 'POST', body: form }),
    env,
  )
  assert.equal(upload.status, 201)
  const { id } = await upload.json() as { id: string }
  const download = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`),
    env,
    id,
  )
  assert.equal(download.headers.get('Content-Type'), 'audio/mpeg')
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), original)
})

test('audio route uploads, lists, updates, decrypts, and deletes an object', async () => {
  const bucket = new MemoryBucket()
  const env = {
    AUDIO_BUCKET: bucket,
    ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(23)),
  } as unknown as AppEnv
  const original = new Uint8Array([0, 1, 2, 3, 4, 5])
  const form = new FormData()
  form.set('audio', new File([original], 'audio.m4a', { type: 'audio/mp4' }))
  form.set('metadata', JSON.stringify(metadata))

  const upload = await handleAudio(
    new Request('https://example.test/api/audio', { method: 'POST', body: form }),
    env,
  )
  assert.equal(upload.status, 201)
  const { id } = (await upload.json()) as { id: string }
  assert.equal(bucket.objects.size, 1)
  assert.equal(new TextDecoder().decode([...bucket.objects.values()][0]).includes('route test'), false)

  const list = await handleAudio(new Request('https://example.test/api/audio'), env)
  assert.equal(list.status, 200)
  assert.deepEqual((await list.json() as { items: unknown[] }).items, [{ id, ...metadata }])

  const invalidUpdate = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordedDate: '2026-02-30',
        tags: [],
        memo: '',
      }),
    }),
    env,
    id,
  )
  assert.equal(invalidUpdate.status, 400)

  const update = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordedDate: '2026-09-13',
        tags: ['updated'],
        memo: 'updated memo',
      }),
    }),
    env,
    id,
  )
  assert.equal(update.status, 200)
  assert.deepEqual((await update.json() as { item: unknown }).item, {
    id,
    ...metadata,
    recordedDate: '2026-09-13',
    tags: ['updated'],
    memo: 'updated memo',
  })

  const updatedList = await handleAudio(
    new Request('https://example.test/api/audio'),
    env,
  )
  assert.deepEqual((await updatedList.json() as { items: unknown[] }).items, [{
    id,
    ...metadata,
    recordedDate: '2026-09-13',
    tags: ['updated'],
    memo: 'updated memo',
  }])

  const download = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`),
    env,
    id,
  )
  assert.equal(download.headers.get('Content-Type'), 'audio/mp4')
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), original)

  const removed = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`, { method: 'DELETE' }),
    env,
    id,
  )
  assert.equal(removed.status, 204)
  assert.equal(bucket.objects.size, 0)
})

async function uploadForTest(env: AppEnv, uploadMetadata: AudioMetadata) {
  const form = new FormData()
  form.set('audio', new File([new Uint8Array([0, 1, 2])], 'audio.m4a', { type: 'audio/mp4' }))
  form.set('metadata', JSON.stringify(uploadMetadata))
  return handleAudio(
    new Request('https://example.test/api/audio', { method: 'POST', body: form }),
    env,
  )
}

test('list reads encrypted custom metadata without fetching objects', async () => {
  const bucket = new MemoryBucket()
  const env = {
    AUDIO_BUCKET: bucket,
    ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(31)),
  } as unknown as AppEnv
  const upload = await uploadForTest(env, metadata)
  const { id } = await upload.json() as { id: string }

  const stored = [...bucket.customMetadata.values()][0]
  assert.equal(JSON.stringify(stored).includes('route test'), false)
  assert.equal(JSON.stringify(stored).includes(metadata.fileName), false)

  bucket.getCount = 0
  const list = await handleAudio(new Request('https://example.test/api/audio'), env)
  assert.deepEqual((await list.json() as { items: unknown[] }).items, [{ id, ...metadata }])
  assert.equal(bucket.getCount, 0)
})

test('list falls back to range reads for objects without custom metadata', async () => {
  const bucket = new MemoryBucket()
  const env = {
    AUDIO_BUCKET: bucket,
    ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(37)),
  } as unknown as AppEnv
  const upload = await uploadForTest(env, metadata)
  const { id } = await upload.json() as { id: string }
  bucket.customMetadata.set(`audio/${id}.bin`, { version: '1' })

  const list = await handleAudio(new Request('https://example.test/api/audio'), env)
  assert.deepEqual((await list.json() as { items: unknown[] }).items, [{ id, ...metadata }])
  assert.ok(bucket.getCount > 0)
})

test('memo and tag limits are rejected on upload and update', async () => {
  const bucket = new MemoryBucket()
  const env = {
    AUDIO_BUCKET: bucket,
    ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(41)),
  } as unknown as AppEnv

  assert.equal((await uploadForTest(env, { ...metadata, memo: 'あ'.repeat(201) })).status, 400)
  assert.equal(
    (await uploadForTest(env, {
      ...metadata,
      tags: Array.from({ length: 21 }, (_, index) => `tag${index}`),
    })).status,
    400,
  )
  assert.equal(bucket.objects.size, 0)

  const upload = await uploadForTest(env, { ...metadata, memo: 'あ'.repeat(200) })
  assert.equal(upload.status, 201)
  const { id } = await upload.json() as { id: string }
  const update = await handleAudio(
    new Request(`https://example.test/api/audio/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordedDate: '2026-09-13',
        tags: Array.from({ length: 21 }, (_, index) => `tag${index}`),
        memo: '',
      }),
    }),
    env,
    id,
  )
  assert.equal(update.status, 400)
})
