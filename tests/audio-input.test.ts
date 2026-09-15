import assert from 'node:assert/strict'
import test from 'node:test'
import { isWavFile, passthroughMediaType } from '../src/audio/input.ts'

test('WAV input is selected for conversion', () => {
  assert.equal(isWavFile({ name: 'recording.WAV', type: '' }), true)
  assert.equal(passthroughMediaType({ name: 'recording.wav', type: 'audio/wav' }), null)
})

test('compressed audio formats are selected for passthrough', () => {
  assert.equal(passthroughMediaType({ name: 'recording.m4a', type: '' }), 'audio/mp4')
  assert.equal(passthroughMediaType({ name: 'recording.mp3', type: '' }), 'audio/mpeg')
  assert.equal(passthroughMediaType({ name: 'recording.flac', type: '' }), 'audio/flac')
  assert.equal(passthroughMediaType({ name: 'notes.txt', type: 'text/plain' }), null)
})
