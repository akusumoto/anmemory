import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePcmToStereoPlanar, inspectWav } from '../src/audio/wav.ts'

function pcm16Wav(samples: number[], channels: 1 | 2, sampleRate = 8_000) {
  const dataSize = samples.length * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true))
  return bytes
}

test('WAV inspector finds PCM format and data without loading the whole file', async () => {
  const bytes = pcm16Wav([0, 16_384, -16_384, 32_767], 1)
  const info = await inspectWav(new Blob([bytes]))
  assert.equal(info.channels, 1)
  assert.equal(info.bitsPerSample, 16)
  assert.equal(info.frameCount, 4)
  assert.equal(info.dataOffset, 44)
})

test('mono PCM is normalized and duplicated into stereo planes', () => {
  const pcm = new ArrayBuffer(4)
  const view = new DataView(pcm)
  view.setInt16(0, 16_384, true)
  view.setInt16(2, -16_384, true)
  const output = decodePcmToStereoPlanar(pcm, {
    audioFormat: 1,
    bitsPerSample: 16,
    blockAlign: 2,
    channels: 1,
    dataOffset: 44,
    dataSize: 4,
    durationSec: 2 / 8_000,
    frameCount: 2,
    sampleRate: 8_000,
  })
  assert.deepEqual(Array.from(output), [0.5, -0.5, 0.5, -0.5])
})

test('invalid and unsupported WAV inputs are rejected', async () => {
  await assert.rejects(() => inspectWav(new Blob([new Uint8Array(44)])))
  const bytes = pcm16Wav([0, 0, 0], 1)
  new DataView(bytes.buffer).setUint16(22, 3, true)
  await assert.rejects(() => inspectWav(new Blob([bytes])))
})
