import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type AudioMetadata,
  openAudioMetadata,
  openAudioObject,
  readEncryptedHeaderLength,
  readEncryptedObjectLayout,
  sealAudioObject,
  sealAudioObjectParts,
} from '../worker/encrypted-audio.ts'
import { encodeBase64Url } from '../worker/encoding.ts'

const secret = encodeBase64Url(new Uint8Array(32).fill(17))
const wrongSecret = encodeBase64Url(new Uint8Array(32).fill(18))
const audio = new TextEncoder().encode('confidential audio marker')
const metadata: AudioMetadata = {
  fileName: 'rec_20260911_1.wav',
  recordedDate: '2026-09-11',
  recordedDateSource: 'filename',
  durationSec: 42,
  sequence: 1,
  tags: ['仕事', '会議'],
  memo: 'confidential metadata marker',
  uploadedAt: '2026-09-11T12:00:00Z',
}

function includesText(bytes: Uint8Array, text: string): boolean {
  const decoded = new TextDecoder().decode(bytes)
  return decoded.includes(text)
}

test('encrypted object round-trips audio and metadata without plaintext', async () => {
  const sealed = await sealAudioObject(audio, metadata, secret)
  assert.equal(includesText(sealed, 'confidential audio marker'), false)
  assert.equal(includesText(sealed, 'confidential metadata marker'), false)
  assert.equal(includesText(sealed, metadata.fileName), false)

  const opened = await openAudioObject(sealed, secret)
  assert.deepEqual(opened.audio, audio)
  assert.deepEqual(opened.metadata, metadata)
})

test('each encryption uses fresh keys and IVs', async () => {
  const first = await sealAudioObject(audio, metadata, secret)
  const second = await sealAudioObject(audio, metadata, secret)
  assert.notDeepEqual(first, second)
})

test('metadata can be decrypted from the encrypted object prefix only', async () => {
  const sealed = await sealAudioObjectParts(audio, metadata, secret)
  const headerContainer = new Uint8Array(sealed.prefix.length + sealed.header.length)
  headerContainer.set(sealed.prefix)
  headerContainer.set(sealed.header, sealed.prefix.length)
  assert.equal(readEncryptedHeaderLength(sealed.prefix), sealed.header.length)

  const layout = readEncryptedObjectLayout(headerContainer)
  const metadataPrefix = new Uint8Array(layout.metadataEnd)
  metadataPrefix.set(headerContainer)
  metadataPrefix.set(sealed.metadataCiphertext, headerContainer.length)
  assert.equal(layout.totalLength, (await sealAudioObject(audio, metadata, secret)).length)
  assert.deepEqual(await openAudioMetadata(metadataPrefix, secret), metadata)
})

test('tampering and the wrong master key are rejected', async () => {
  const sealed = await sealAudioObject(audio, metadata, secret)
  const tampered = sealed.slice()
  tampered[tampered.length - 1] ^= 1

  await assert.rejects(() => openAudioObject(tampered, secret))
  await assert.rejects(() => openAudioObject(sealed, wrongSecret))
})
