import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runStorageCheck } from '../worker/r2.ts'

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>()

  async put(key: string, value: ArrayBuffer | ArrayBufferView) {
    const bytes = ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value)
    this.objects.set(key, Uint8Array.from(bytes))
    return {} as R2Object
  }

  async get(key: string) {
    const value = this.objects.get(key)
    if (!value) {
      return null
    }
    return {
      arrayBuffer: async () => value.slice().buffer,
    } as R2ObjectBody
  }

  async delete(key: string) {
    this.objects.delete(key)
  }

  async head(key: string) {
    return this.objects.has(key) ? ({} as R2Object) : null
  }
}

test('storage check writes, reads, verifies, and removes its probe', async () => {
  const bucket = new MemoryBucket()
  await runStorageCheck(bucket)
  assert.equal(bucket.objects.size, 0)
})
