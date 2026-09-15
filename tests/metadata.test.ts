import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAudioMetadata,
  extractWavRecordedDate,
  normalizeTags,
  parseRecordingFileName,
} from '../src/audio/metadata.ts'
import type { WavInfo } from '../src/audio/wav.ts'

function chunk(id: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length % 2)
  const result = new Uint8Array(8 + padded)
  const view = new DataView(result.buffer)
  for (let index = 0; index < 4; index += 1) view.setUint8(index, id.charCodeAt(index))
  view.setUint32(4, data.length, true)
  result.set(data, 8)
  return result
}

function wavWith(chunks: Uint8Array[], name = 'recording.wav'): File {
  const size = 12 + chunks.reduce((sum, item) => sum + item.length, 0)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, size - 8, true)
  bytes.set(new TextEncoder().encode('WAVE'), 8)
  let offset = 12
  for (const item of chunks) {
    bytes.set(item, offset)
    offset += item.length
  }
  return new File([bytes], name, { type: 'audio/wav' })
}

const wavInfo: WavInfo = {
  audioFormat: 1,
  bitsPerSample: 16,
  blockAlign: 2,
  channels: 1,
  dataOffset: 44,
  dataSize: 96_000,
  durationSec: 12.6,
  frameCount: 48_000,
  sampleRate: 48_000,
}

test('recording filename yields a validated date and sequence', () => {
  assert.deepEqual(parseRecordingFileName('rec_20260911_3.wav'), {
    recordedDate: '2026-09-11',
    sequence: 3,
  })
  assert.equal(parseRecordingFileName('rec_20260230_1.wav'), null)
  assert.equal(parseRecordingFileName('other.wav'), null)
  assert.deepEqual(parseRecordingFileName('rec_20260911_4.mp3'), {
    recordedDate: '2026-09-11',
    sequence: 4,
  })
})

test('WAV INFO ICRD date is extracted even after an audio chunk', async () => {
  const data = chunk('data', new Uint8Array(16))
  const icrd = chunk('ICRD', new TextEncoder().encode('2026-09-10\0'))
  const list = chunk('LIST', new Uint8Array([
    ...new TextEncoder().encode('INFO'),
    ...icrd,
  ]))
  assert.equal(await extractWavRecordedDate(wavWith([data, list])), '2026-09-10')
})

test('BWF origination date takes priority over INFO date', async () => {
  const bext = new Uint8Array(330)
  bext.set(new TextEncoder().encode('2026-09-09'), 320)
  const icrd = chunk('ICRD', new TextEncoder().encode('2026-09-10\0'))
  const list = chunk('LIST', new Uint8Array([
    ...new TextEncoder().encode('INFO'),
    ...icrd,
  ]))
  assert.equal(
    await extractWavRecordedDate(wavWith([list, chunk('bext', bext)])),
    '2026-09-09',
  )
})

test('metadata date, filename date, and upload date follow priority order', async () => {
  const bext = new Uint8Array(330)
  bext.set(new TextEncoder().encode('2026-09-08'), 320)
  const metadataFile = wavWith(
    [chunk('bext', bext)],
    'rec_20260911_3.wav',
  )
  const now = new Date('2026-09-12T01:02:03.000Z')

  const fromMetadata = await createAudioMetadata(metadataFile, wavInfo, now)
  assert.equal(fromMetadata.recordedDate, '2026-09-08')
  assert.equal(fromMetadata.recordedDateSource, 'metadata')
  assert.equal(fromMetadata.sequence, 3)
  assert.equal(fromMetadata.durationSec, 13)

  const filenameFile = new File([], 'rec_20260911_2.wav')
  const fromFilename = await createAudioMetadata(filenameFile, wavInfo, now)
  assert.equal(fromFilename.recordedDate, '2026-09-11')
  assert.equal(fromFilename.recordedDateSource, 'filename')

  const fallbackFile = new File([], 'recording.wav')
  const fromUpload = await createAudioMetadata(fallbackFile, wavInfo, now)
  assert.equal(fromUpload.recordedDate, '2026-09-12')
  assert.equal(fromUpload.recordedDateSource, 'upload')
})

test('tags are trimmed, deduplicated, and empty values are removed', () => {
  assert.deepEqual(normalizeTags('仕事, 会議、仕事\n重要'), ['仕事', '会議', '重要'])
})
