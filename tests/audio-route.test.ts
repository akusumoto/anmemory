import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppEnv } from '../worker/env.ts'
import type { AudioMetadata } from '../worker/encrypted-audio.ts'
import { encodeBase64Url } from '../worker/encoding.ts'
import { handleAudio } from '../worker/routes/audio.ts'

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>()

  async put(key: string, value: Blob) {
    this.objects.set(key, new Uint8Array(await value.arrayBuffer()))
    return {} as R2Object
  }

  async get(key: string, options?: { range?: { offset: number; length: number } }) {
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
  }

  async list() {
    return {
      objects: [...this.objects].map(([key, value]) => ({ key, size: value.length })),
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
}

test('audio route uploads, lists, decrypts, and deletes an object', async () => {
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
