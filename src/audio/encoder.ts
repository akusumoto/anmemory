import { type AacSample, buildM4a } from './m4a.ts'
import { inspectWav, readWavFrames } from './wav.ts'

export const AAC_BITRATE = 96_000
export const OUTPUT_CHANNELS = 2
export const MAX_M4A_BYTES = 50 * 1024 * 1024
const FRAMES_PER_INPUT_CHUNK = 16_384
const MAX_ENCODER_QUEUE = 8

export interface ConversionProgress {
  percent: number
  processedFrames: number
  totalFrames: number
}

export interface ConversionResult {
  blob: Blob
  bitrate: number
  channels: number
  durationSec: number
  sampleRate: number
}

interface EncodedSampleWithTime {
  data: Uint8Array
  durationMicroseconds: number | null
  timestamp: number
}

function abortError(): DOMException {
  return new DOMException('変換をキャンセルしました。', 'AbortError')
}

function copyDescription(source: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ),
    )
  }
  return new Uint8Array(source.slice(0))
}

export function aacEncoderConfig(sampleRate: number): AudioEncoderConfig {
  return {
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: OUTPUT_CHANNELS,
    bitrate: AAC_BITRATE,
    aac: { format: 'aac' },
  }
}

export async function supportsAacEncoding(sampleRate = 48_000) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return false
  }
  try {
    return Boolean(
      (await AudioEncoder.isConfigSupported(aacEncoderConfig(sampleRate)))
        .supported,
    )
  } catch {
    return false
  }
}

export async function convertWavToM4a(
  file: File,
  onProgress: (progress: ConversionProgress) => void,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const wav = await inspectWav(file)
  if (!(await supportsAacEncoding(wav.sampleRate))) {
    throw new Error('この端末はAAC-LC音声変換に対応していません。')
  }

  const encoded: EncodedSampleWithTime[] = []
  let audioSpecificConfig: Uint8Array | undefined
  let encodingError: DOMException | null = null
  const encoder = new AudioEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      encoded.push({
        data,
        durationMicroseconds: chunk.duration,
        timestamp: chunk.timestamp,
      })
      const description = metadata?.decoderConfig?.description
      if (!audioSpecificConfig && description) {
        audioSpecificConfig = copyDescription(description)
      }
    },
    error(error) {
      encodingError = error
    },
  })

  try {
    encoder.configure(aacEncoderConfig(wav.sampleRate))
    let processedFrames = 0

    while (processedFrames < wav.frameCount) {
      if (signal?.aborted) {
        throw abortError()
      }

      const frameCount = Math.min(
        FRAMES_PER_INPUT_CHUNK,
        wav.frameCount - processedFrames,
      )
      const planar = await readWavFrames(
        file,
        wav,
        processedFrames,
        frameCount,
      )
      if (signal?.aborted) {
        throw abortError()
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: wav.sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: OUTPUT_CHANNELS,
        timestamp: Math.round((processedFrames * 1_000_000) / wav.sampleRate),
        data: planar.buffer as ArrayBuffer,
      })
      encoder.encode(audioData)
      audioData.close()
      processedFrames += frameCount
      onProgress({
        percent: Math.min(99, Math.floor((processedFrames / wav.frameCount) * 100)),
        processedFrames,
        totalFrames: wav.frameCount,
      })

      if (encoder.encodeQueueSize > MAX_ENCODER_QUEUE) {
        await encoder.flush()
      }
      if (encodingError) {
        throw encodingError
      }
    }

    await encoder.flush()
    if (encodingError) {
      throw encodingError
    }
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close()
    }
  }

  if (signal?.aborted) {
    throw abortError()
  }

  const samples: AacSample[] = encoded.map((sample, index) => {
    const nextTimestamp = encoded[index + 1]?.timestamp
    const durationMicroseconds =
      sample.durationMicroseconds ??
      (nextTimestamp === undefined ? null : nextTimestamp - sample.timestamp) ??
      (1_024 * 1_000_000) / wav.sampleRate
    return {
      data: sample.data,
      duration: Math.max(
        1,
        Math.round((durationMicroseconds * wav.sampleRate) / 1_000_000),
      ),
    }
  })
  const blob = buildM4a({
    samples,
    sampleRate: wav.sampleRate,
    channels: OUTPUT_CHANNELS,
    bitrate: AAC_BITRATE,
    audioSpecificConfig,
  })
  if (blob.size > MAX_M4A_BYTES) {
    throw new Error('変換後のM4Aが50MBを超えたため、アップロードできません。')
  }

  onProgress({ percent: 100, processedFrames: wav.frameCount, totalFrames: wav.frameCount })
  return {
    blob,
    bitrate: AAC_BITRATE,
    channels: OUTPUT_CHANNELS,
    durationSec: wav.durationSec,
    sampleRate: wav.sampleRate,
  }
}
