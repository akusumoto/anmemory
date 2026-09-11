export interface AacSample {
  data: Uint8Array
  duration: number
}

interface M4aOptions {
  audioSpecificConfig?: Uint8Array
  bitrate: number
  channels: number
  sampleRate: number
  samples: AacSample[]
}

const textEncoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length)
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2)
  new DataView(result.buffer).setUint16(0, value, false)
  return result
}

function u24(value: number): Uint8Array {
  return bytes((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, false)
  return result
}

function text(value: string): Uint8Array {
  return textEncoder.encode(value)
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload)
  return concat(u32(body.length + 8), text(type), body)
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: Uint8Array[]
): Uint8Array {
  return box(type, bytes(version), u24(flags), ...payload)
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  const encodedLength = [payload.length & 0x7f]
  let remaining = payload.length >>> 7
  while (remaining > 0) {
    encodedLength.unshift((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  return concat(bytes(tag, ...encodedLength), payload)
}

function fallbackAudioSpecificConfig(sampleRate: number, channels: number) {
  const frequencies = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000,
    12_000, 11_025, 8_000, 7_350,
  ]
  const frequencyIndex = frequencies.indexOf(sampleRate)
  if (frequencyIndex === -1) {
    throw new Error('このサンプルレートのAAC設定を生成できません。')
  }

  const config = (2 << 11) | (frequencyIndex << 7) | (channels << 3)
  return bytes((config >>> 8) & 0xff, config & 0xff)
}

function esds(config: Uint8Array, bitrate: number): Uint8Array {
  const decoderSpecific = descriptor(0x05, config)
  const decoderConfig = descriptor(
    0x04,
    concat(
      bytes(0x40, 0x15),
      u24(0),
      u32(bitrate),
      u32(bitrate),
      decoderSpecific,
    ),
  )
  const slConfig = descriptor(0x06, bytes(0x02))
  const esDescriptor = descriptor(
    0x03,
    concat(u16(1), bytes(0), decoderConfig, slConfig),
  )
  return fullBox('esds', 0, 0, esDescriptor)
}

function sampleDescription(options: M4aOptions): Uint8Array {
  const config =
    options.audioSpecificConfig ??
    fallbackAudioSpecificConfig(options.sampleRate, options.channels)
  const mp4a = box(
    'mp4a',
    zeros(6),
    u16(1),
    zeros(8),
    u16(options.channels),
    u16(16),
    u16(0),
    u16(0),
    u32(options.sampleRate * 65_536),
    esds(config, options.bitrate),
  )
  return fullBox('stsd', 0, 0, u32(1), mp4a)
}

function timeToSample(samples: AacSample[]): Uint8Array {
  const entries: Array<{ count: number; duration: number }> = []
  for (const sample of samples) {
    const previous = entries.at(-1)
    if (previous?.duration === sample.duration) {
      previous.count += 1
    } else {
      entries.push({ count: 1, duration: sample.duration })
    }
  }
  return fullBox(
    'stts',
    0,
    0,
    u32(entries.length),
    ...entries.flatMap((entry) => [u32(entry.count), u32(entry.duration)]),
  )
}

const MATRIX = concat(
  u32(0x0001_0000), u32(0), u32(0),
  u32(0), u32(0x0001_0000), u32(0),
  u32(0), u32(0), u32(0x4000_0000),
)

function movieBox(options: M4aOptions, chunkOffset: number): Uint8Array {
  const mediaDuration = options.samples.reduce(
    (sum, sample) => sum + sample.duration,
    0,
  )
  const movieTimescale = 1_000
  const movieDuration = Math.ceil(
    (mediaDuration * movieTimescale) / options.sampleRate,
  )
  const mvhd = fullBox(
    'mvhd', 0, 0,
    u32(0), u32(0), u32(movieTimescale), u32(movieDuration),
    u32(0x0001_0000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2),
  )
  const tkhd = fullBox(
    'tkhd', 0, 7,
    u32(0), u32(0), u32(1), u32(0), u32(movieDuration), zeros(8),
    u16(0), u16(0), u16(0x0100), u16(0), MATRIX, u32(0), u32(0),
  )
  const languageUnd = (21 << 10) | (14 << 5) | 4
  const mdhd = fullBox(
    'mdhd', 0, 0,
    u32(0), u32(0), u32(options.sampleRate), u32(mediaDuration),
    u16(languageUnd), u16(0),
  )
  const hdlr = fullBox(
    'hdlr', 0, 0,
    u32(0), text('soun'), zeros(12), text('SoundHandler\0'),
  )
  const smhd = fullBox('smhd', 0, 0, u16(0), u16(0))
  const url = fullBox('url ', 0, 1)
  const dref = fullBox('dref', 0, 0, u32(1), url)
  const dinf = box('dinf', dref)
  const stsc = fullBox(
    'stsc', 0, 0, u32(1), u32(1), u32(options.samples.length), u32(1),
  )
  const stsz = fullBox(
    'stsz', 0, 0, u32(0), u32(options.samples.length),
    ...options.samples.map((sample) => u32(sample.data.length)),
  )
  const stco = fullBox('stco', 0, 0, u32(1), u32(chunkOffset))
  const stbl = box(
    'stbl',
    sampleDescription(options),
    timeToSample(options.samples),
    stsc,
    stsz,
    stco,
  )
  const minf = box('minf', smhd, dinf, stbl)
  const mdia = box('mdia', mdhd, hdlr, minf)
  return box('moov', mvhd, box('trak', tkhd, mdia))
}

export function buildM4a(options: M4aOptions): Blob {
  if (
    options.samples.length === 0 ||
    options.channels !== 2 ||
    options.sampleRate <= 0 ||
    options.samples.some(
      (sample) => sample.data.length === 0 || sample.duration <= 0,
    )
  ) {
    throw new Error('AACサンプル情報が不正です。')
  }

  const mediaBytes = options.samples.reduce(
    (sum, sample) => sum + sample.data.length,
    0,
  )
  const ftyp = box(
    'ftyp', text('M4A '), u32(0x200), text('M4A '), text('isom'), text('mp42'),
  )
  let moov = movieBox(options, 0)
  const chunkOffset = ftyp.length + moov.length + 8
  moov = movieBox(options, chunkOffset)
  const mdatHeader = concat(u32(mediaBytes + 8), text('mdat'))

  const parts = [
    ftyp,
    moov,
    mdatHeader,
    ...options.samples.map((sample) => sample.data),
  ].map((part) => part as unknown as BlobPart)
  return new Blob(parts, { type: 'audio/mp4' })
}
