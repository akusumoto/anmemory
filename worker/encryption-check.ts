import {
  type AudioMetadata,
  openAudioObject,
  sealAudioObject,
} from './encrypted-audio.ts'
import { constantTimeEqual } from './encoding.ts'

type EncryptionCheckBucket = Pick<
  R2Bucket,
  'put' | 'get' | 'delete' | 'head'
>

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false
  }

  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        continue outer
      }
    }
    return true
  }
  return false
}

export async function runEncryptionCheck(
  bucket: EncryptionCheckBucket,
  encryptionSecret: string,
): Promise<void> {
  const id = crypto.randomUUID()
  const marker = `phase3-${crypto.randomUUID()}`
  const objectKey = `system/encryption-check/${id}.bin`
  const audio = new TextEncoder().encode(`audio:${marker}`)
  const metadata: AudioMetadata = {
    fileName: `${marker}.m4a`,
    recordedDate: '2026-09-11',
    recordedDateSource: 'upload',
    durationSec: 1,
    sequence: null,
    tags: ['encryption-check'],
    memo: marker,
    uploadedAt: new Date().toISOString(),
  }
  const markerBytes = new TextEncoder().encode(marker)
  let objectCreated = false

  try {
    const sealed = await sealAudioObject(audio, metadata, encryptionSecret)
    if (containsBytes(sealed, markerBytes)) {
      throw new Error('Plaintext marker found in encrypted object')
    }

    await bucket.put(objectKey, sealed, {
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    objectCreated = true

    const stored = await bucket.get(objectKey)
    if (!stored) {
      throw new Error('Encrypted probe was not found after write')
    }
    const storedBytes = new Uint8Array(await stored.arrayBuffer())
    if (containsBytes(storedBytes, markerBytes)) {
      throw new Error('Plaintext marker found in R2 object')
    }

    const opened = await openAudioObject(storedBytes, encryptionSecret)
    if (
      !constantTimeEqual(opened.audio, audio) ||
      opened.metadata.memo !== marker ||
      opened.metadata.fileName !== metadata.fileName
    ) {
      throw new Error('Decrypted probe did not match')
    }
  } finally {
    if (objectCreated) {
      await bucket.delete(objectKey)
    }
  }

  if (await bucket.head(objectKey)) {
    throw new Error('Encrypted probe remained after delete')
  }
}
