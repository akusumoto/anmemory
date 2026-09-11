export interface WavInfo {
  audioFormat: 1 | 3
  bitsPerSample: 8 | 16 | 24 | 32
  blockAlign: number
  channels: 1 | 2
  dataOffset: number
  dataSize: number
  durationSec: number
  frameCount: number
  sampleRate: number
}

const MAX_FMT_CHUNK_BYTES = 64 * 1024
const MAX_CHUNKS_TO_SCAN = 10_000

function ascii(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }
  return value
}

async function readView(file: Blob, offset: number, length: number) {
  return new DataView(await file.slice(offset, offset + length).arrayBuffer())
}

export async function inspectWav(file: Blob): Promise<WavInfo> {
  if (file.size < 44) {
    throw new Error('WAVファイルが短すぎます。')
  }

  const riff = await readView(file, 0, 12)
  if (ascii(riff, 0, 4) !== 'RIFF' || ascii(riff, 8, 4) !== 'WAVE') {
    throw new Error('RIFF/WAVE形式ではありません。')
  }

  let format: Omit<WavInfo, 'dataOffset' | 'dataSize' | 'durationSec' | 'frameCount'> | null = null
  let offset = 12

  for (let scanned = 0; scanned < MAX_CHUNKS_TO_SCAN; scanned += 1) {
    if (offset + 8 > file.size) {
      break
    }

    const chunkHeader = await readView(file, offset, 8)
    const chunkId = ascii(chunkHeader, 0, 4)
    const chunkSize = chunkHeader.getUint32(4, true)
    const chunkDataOffset = offset + 8
    const availableSize = file.size - chunkDataOffset
    if (chunkSize > availableSize) {
      throw new Error('WAVチャンクが破損しています。')
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || chunkSize > MAX_FMT_CHUNK_BYTES) {
        throw new Error('WAVのfmtチャンクが不正です。')
      }

      const fmt = await readView(file, chunkDataOffset, chunkSize)
      const originalFormat = fmt.getUint16(0, true)
      const channels = fmt.getUint16(2, true)
      const sampleRate = fmt.getUint32(4, true)
      const blockAlign = fmt.getUint16(12, true)
      const bitsPerSample = fmt.getUint16(14, true)
      const audioFormat =
        originalFormat === 0xfffe && chunkSize >= 40
          ? fmt.getUint16(24, true)
          : originalFormat

      if (audioFormat !== 1 && audioFormat !== 3) {
        throw new Error('PCMまたはIEEE Float形式のWAVのみ変換できます。')
      }
      if (channels !== 1 && channels !== 2) {
        throw new Error('モノラルまたはステレオのWAVのみ変換できます。')
      }
      if (![8, 16, 24, 32].includes(bitsPerSample)) {
        throw new Error('8/16/24/32-bit PCMのWAVのみ変換できます。')
      }
      if (audioFormat === 3 && bitsPerSample !== 32) {
        throw new Error('IEEE Float WAVは32-bitのみ対応しています。')
      }
      const expectedBlockAlign = channels * (bitsPerSample / 8)
      if (
        blockAlign !== expectedBlockAlign ||
        sampleRate < 8_000 ||
        sampleRate > 192_000
      ) {
        throw new Error('WAVの音声形式が不正です。')
      }

      format = {
        audioFormat,
        bitsPerSample: bitsPerSample as WavInfo['bitsPerSample'],
        blockAlign,
        channels,
        sampleRate,
      }
    } else if (chunkId === 'data') {
      if (!format) {
        throw new Error('fmtチャンクより前にdataチャンクがあります。')
      }

      const dataSize = chunkSize - (chunkSize % format.blockAlign)
      const frameCount = dataSize / format.blockAlign
      if (frameCount === 0) {
        throw new Error('WAVに音声データがありません。')
      }
      return {
        ...format,
        dataOffset: chunkDataOffset,
        dataSize,
        frameCount,
        durationSec: frameCount / format.sampleRate,
      }
    }

    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2)
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new Error('WAVチャンクが破損しています。')
    }
    offset = nextOffset
  }

  throw new Error('WAVの音声データを確認できませんでした。')
}

function readSample(
  view: DataView,
  offset: number,
  audioFormat: 1 | 3,
  bitsPerSample: WavInfo['bitsPerSample'],
): number {
  if (audioFormat === 3) {
    const value = view.getFloat32(offset, true)
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
  }

  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128
    case 16:
      return view.getInt16(offset, true) / 32_768
    case 24: {
      let value =
        view.getUint8(offset) |
        (view.getUint8(offset + 1) << 8) |
        (view.getUint8(offset + 2) << 16)
      if (value & 0x80_0000) {
        value |= 0xff00_0000
      }
      return value / 8_388_608
    }
    case 32:
      return view.getInt32(offset, true) / 2_147_483_648
  }
}

export function decodePcmToStereoPlanar(
  bytes: ArrayBuffer,
  info: WavInfo,
): Float32Array {
  if (bytes.byteLength % info.blockAlign !== 0) {
    throw new Error('PCMチャンクがフレーム境界に揃っていません。')
  }

  const view = new DataView(bytes)
  const frames = bytes.byteLength / info.blockAlign
  const output = new Float32Array(frames * 2)
  const bytesPerSample = info.bitsPerSample / 8

  for (let frame = 0; frame < frames; frame += 1) {
    const inputOffset = frame * info.blockAlign
    const left = readSample(
      view,
      inputOffset,
      info.audioFormat,
      info.bitsPerSample,
    )
    const right =
      info.channels === 2
        ? readSample(
            view,
            inputOffset + bytesPerSample,
            info.audioFormat,
            info.bitsPerSample,
          )
        : left
    output[frame] = left
    output[frames + frame] = right
  }

  return output
}

export async function readWavFrames(
  file: Blob,
  info: WavInfo,
  firstFrame: number,
  frameCount: number,
): Promise<Float32Array> {
  const byteOffset = info.dataOffset + firstFrame * info.blockAlign
  const byteLength = frameCount * info.blockAlign
  const bytes = await file.slice(byteOffset, byteOffset + byteLength).arrayBuffer()
  return decodePcmToStereoPlanar(bytes, info)
}
