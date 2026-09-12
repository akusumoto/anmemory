import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildM4a } from '../src/audio/m4a.ts'

function boxType(bytes: Uint8Array, offset: number): string {
  return new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
}

test('M4A muxer creates ftyp, moov, and mdat with raw AAC samples', async () => {
  const first = Uint8Array.from([1, 2, 3, 4])
  const second = Uint8Array.from([5, 6, 7])
  const blob = buildM4a({
    samples: [
      { data: first, duration: 1_024 },
      { data: second, duration: 1_024 },
    ],
    sampleRate: 48_000,
    channels: 2,
    bitrate: 96_000,
    audioSpecificConfig: Uint8Array.from([0x11, 0x90]),
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.equal(blob.type, 'audio/mp4')
  assert.equal(boxType(bytes, 0), 'ftyp')

  const ftypSize = new DataView(bytes.buffer).getUint32(0, false)
  assert.equal(boxType(bytes, ftypSize), 'moov')
  const moovSize = new DataView(bytes.buffer).getUint32(ftypSize, false)
  assert.equal(boxType(bytes, ftypSize + moovSize), 'mdat')
  assert.deepEqual(Array.from(bytes.slice(-7)), [...first, ...second])
})

test('M4A muxer handles twenty minutes of 48 kHz AAC samples', () => {
  const sampleCount = Math.ceil((20 * 60 * 48_000) / 1_024)
  const sampleData = Uint8Array.from([1])
  const samples = Array.from({ length: sampleCount }, () => ({
    data: sampleData,
    duration: 1_024,
  }))

  const blob = buildM4a({
    samples,
    sampleRate: 48_000,
    channels: 2,
    bitrate: 96_000,
    audioSpecificConfig: Uint8Array.from([0x11, 0x90]),
  })

  assert.equal(blob.type, 'audio/mp4')
  assert.ok(blob.size > sampleCount)
})
