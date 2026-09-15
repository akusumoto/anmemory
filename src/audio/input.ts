const WAV_EXTENSIONS = new Set(['wav', 'wave'])
const PASSTHROUGH_EXTENSIONS = new Set([
  'm4a',
  'mp3',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'webm',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
}

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function isWavFile(file: Pick<File, 'name' | 'type'>): boolean {
  return WAV_EXTENSIONS.has(extensionOf(file.name)) ||
    file.type === 'audio/wav' || file.type === 'audio/x-wav'
}

export function passthroughMediaType(
  file: Pick<File, 'name' | 'type'>,
): string | null {
  const extension = extensionOf(file.name)
  if (!PASSTHROUGH_EXTENSIONS.has(extension)) return null
  return MIME_BY_EXTENSION[extension] ??
    (file.type.startsWith('audio/') ? file.type : null)
}

export function readBrowserAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    const cleanup = () => {
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      cleanup()
      if (Number.isFinite(duration) && duration >= 0) resolve(duration)
      else reject(new Error('音声の長さを取得できませんでした。'))
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('この音声ファイルを読み込めませんでした。'))
    }
    audio.src = url
  })
}
