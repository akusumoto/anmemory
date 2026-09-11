import { constantTimeEqual } from './encoding.ts'

type StorageCheckBucket = Pick<
  R2Bucket,
  'put' | 'get' | 'delete' | 'head'
>

const PROBE_SIZE_BYTES = 32

export async function runStorageCheck(
  bucket: StorageCheckBucket,
): Promise<void> {
  const objectKey = `system/storage-check/${crypto.randomUUID()}.bin`
  const expected = crypto.getRandomValues(new Uint8Array(PROBE_SIZE_BYTES))
  let objectCreated = false

  try {
    await bucket.put(objectKey, expected, {
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    objectCreated = true

    const stored = await bucket.get(objectKey)
    if (!stored) {
      throw new Error('R2 probe was not found after write')
    }

    const actual = new Uint8Array(await stored.arrayBuffer())
    if (!constantTimeEqual(expected, actual)) {
      throw new Error('R2 probe content did not match')
    }
  } finally {
    if (objectCreated) {
      await bucket.delete(objectKey)
    }
  }

  if (await bucket.head(objectKey)) {
    throw new Error('R2 probe remained after delete')
  }
}
