import { useEffect, useRef, useState } from 'react'
import { AAC_BITRATE, convertWavToM4a, type ConversionResult, supportsAacEncoding } from '../audio/encoder.ts'
import { isWavFile, passthroughMediaType, readBrowserAudioDuration } from '../audio/input.ts'
import { createAudioMetadata, normalizeTags, type AudioMetadata, type RecordedDateSource } from '../audio/metadata.ts'
import { inspectWav, type WavInfo } from '../audio/wav.ts'
import { uploadAudio } from '../api.ts'

const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const dateSourceLabels: Record<RecordedDateSource, string> = {
  metadata: 'ファイル内メタデータ', filename: 'ファイル名', upload: '選択日',
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

export default function Upload({ onUploaded }: { onUploaded: () => void }) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [wav, setWav] = useState<WavInfo | null>(null)
  const [directMediaType, setDirectMediaType] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null)
  const [tagText, setTagText] = useState('')
  const [result, setResult] = useState<ConversionResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [storedId, setStoredId] = useState<string | null>(null)
  const abortController = useRef<AbortController | null>(null)
  const fileSelectionVersion = useRef(0)

  useEffect(() => {
    void supportsAacEncoding().then(setSupported)
    return () => abortController.current?.abort()
  }, [])

  async function handleFileChange(selected: File | undefined) {
    const selectionVersion = ++fileSelectionVersion.current
    abortController.current?.abort()
    setFile(null); setWav(null); setDirectMediaType(null); setMetadata(null)
    setTagText(''); setResult(null); setStoredId(null); setProgress(0); setError('')
    if (!selected) return
    try {
      const wavInput = isWavFile(selected)
      const mediaType = wavInput ? null : passthroughMediaType(selected)
      if (!wavInput && !mediaType) throw new Error('対応している音声ファイルを選択してください。')
      if (!wavInput && selected.size > MAX_AUDIO_BYTES) {
        throw new Error('圧縮済み音声ファイルは50MB以下にしてください。')
      }
      if (wavInput && supported === false) throw new Error('このブラウザではWAVをM4Aへ変換できません。')
      const inspected = wavInput ? await inspectWav(selected) : null
      const durationSec = inspected?.durationSec ?? await readBrowserAudioDuration(selected)
      const extracted = await createAudioMetadata(selected, { durationSec }, new Date(), wavInput)
      if (selectionVersion !== fileSelectionVersion.current) return
      setFile(selected); setWav(inspected); setDirectMediaType(mediaType)
      setMetadata({ ...extracted, mediaType: mediaType ?? 'audio/mp4' })
    } catch (caught) {
      if (selectionVersion === fileSelectionVersion.current) {
        setError(caught instanceof Error ? caught.message : '音声ファイルを解析できませんでした。')
      }
    }
  }

  async function handleUpload() {
    if (!file || !metadata || isConverting || isUploading || storedId) return
    setError('')
    let converted = result
    try {
      let uploadBlob: Blob
      if (wav) {
        if (!converted) {
          const controller = new AbortController()
          abortController.current = controller; setIsConverting(true); setProgress(0)
          converted = await convertWavToM4a(file, ({ percent }) => setProgress(percent), controller.signal)
          setResult(converted); setIsConverting(false)
        }
        uploadBlob = converted.blob
      } else {
        if (!directMediaType) throw new Error('音声形式を確認できませんでした。')
        uploadBlob = file.slice(0, file.size, directMediaType)
      }
      setIsUploading(true)
      setStoredId(await uploadAudio(uploadBlob, metadata))
      onUploaded()
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') setError('変換をキャンセルしました。')
      else setError(caught instanceof Error ? caught.message : '暗号化して保存できませんでした。')
    } finally {
      abortController.current = null; setIsConverting(false); setIsUploading(false)
    }
  }

  return (
    <section className="upload-card" aria-labelledby="upload-title">
      <div className="section-heading"><h2 id="upload-title">アップロード</h2></div>
      {supported === false ? <p className="form-error" role="alert">このブラウザではWAVからM4Aへの変換ができません。圧縮済み音声はアップロードできます。</p> : null}
      <label className="file-picker">
        <span>{file ? '別の音声ファイルを選択' : '音声ファイルを選択'}</span>
        <input type="file" accept=".wav,.wave,.m4a,.mp3,.aac,.ogg,.oga,.opus,.flac,.webm,audio/*" disabled={isConverting || isUploading} onChange={(event) => void handleFileChange(event.target.files?.[0])} />
      </label>

      {file && metadata ? <div className="file-summary">
        <strong>{file.name}</strong><dl>
          <div><dt>元サイズ</dt><dd>{formatBytes(file.size)}</dd></div>
          <div><dt>長さ</dt><dd>{formatDuration(metadata.durationSec)}</dd></div>
          {wav ? <div><dt>入力</dt><dd>{wav.sampleRate / 1000}kHz / {wav.channels}ch / {wav.bitsPerSample}bit</dd></div> : null}
          <div><dt>処理</dt><dd>{wav ? `AAC-LC / ${AAC_BITRATE / 1000}kbps / Stereoへ変換` : '変換せずそのまま保存'}</dd></div>
        </dl>
      </div> : null}

      {metadata ? <fieldset className="metadata-fields" disabled={isConverting || isUploading || Boolean(storedId)}>
        <legend>メタデータ</legend>
        <div className="recorded-date-row"><label><span>録音日</span><input type="date" value={metadata.recordedDate} readOnly /></label><small>{dateSourceLabels[metadata.recordedDateSource]}から取得</small></div>
        <label><span>タグ</span><input type="text" value={tagText} placeholder="仕事, 会議" onChange={(event) => { const value = event.target.value; setTagText(value); setMetadata((current) => current ? { ...current, tags: normalizeTags(value) } : current) }} /><small>カンマ、読点、または改行で区切ります。</small></label>
        <label><span>メモ</span><textarea rows={3} value={metadata.memo} placeholder="音声についてのメモ" onChange={(event) => { const memo = event.target.value; setMetadata((current) => current ? { ...current, memo } : current) }} /></label>
        <div className="metadata-preview"><span>長さ {metadata.durationSec}秒</span><span>連番 {metadata.sequence ?? 'なし'}</span><span>タグ {metadata.tags.length}件</span></div>
      </fieldset> : null}

      {isConverting ? <div className="conversion-progress" aria-live="polite"><div><span>変換中…</span><strong>{progress}%</strong></div><progress max="100" value={progress}>{progress}%</progress><button className="secondary-button" type="button" onClick={() => abortController.current?.abort()}>キャンセル</button></div> : null}
      {isUploading ? <p className="upload-status" aria-live="polite">アップロード中…</p> : null}
      {error ? <p className="form-error upload-error" role="alert">{error}</p> : null}

      {result ? <div className="conversion-result" aria-live="polite"><strong>変換完了</strong><span>M4A {formatBytes(result.blob.size)}</span><span>AAC-LC {result.bitrate / 1000}kbps Stereo</span>{metadata ? <span>{metadata.recordedDate} / タグ {metadata.tags.length}件</span> : null}<p>元のWAVはサーバーへ送信されません。</p>{storedId ? <strong>暗号化してR2へ保存しました。</strong> : null}</div> : null}
      {file && directMediaType && storedId ? <div className="conversion-result" aria-live="polite"><strong>暗号化してR2へ保存しました。</strong><span>{file.name} / {formatBytes(file.size)}</span><p>圧縮済み音声のため、変換せずにアップロードしました。</p></div> : null}
      {file && metadata && !storedId ? <button type="button" onClick={() => void handleUpload()} disabled={isConverting || isUploading}>{isConverting ? '変換中…' : isUploading ? 'アップロード中…' : 'アップロード'}</button> : null}
    </section>
  )
}
