import { useEffect, useRef, useState } from 'react'
import {
  AAC_BITRATE,
  convertWavToM4a,
  type ConversionResult,
  supportsAacEncoding,
} from '../audio/encoder.ts'
import {
  createAudioMetadata,
  normalizeTags,
  type AudioMetadata,
  type RecordedDateSource,
} from '../audio/metadata.ts'
import { inspectWav, type WavInfo } from '../audio/wav.ts'
import { uploadAudio } from '../api.ts'

const dateSourceLabels: Record<RecordedDateSource, string> = {
  metadata: 'ファイル内メタデータ',
  filename: 'ファイル名',
  upload: '選択日',
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
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

interface Props {
  onUploaded: () => void
}

export default function Upload({ onUploaded }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [wav, setWav] = useState<WavInfo | null>(null)
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
    setFile(null)
    setWav(null)
    setMetadata(null)
    setTagText('')
    setResult(null)
    setStoredId(null)
    setProgress(0)
    setError('')
    if (!selected) {
      return
    }
    if (!selected.name.toLowerCase().endsWith('.wav')) {
      setError('WAVファイルを選択してください。')
      return
    }

    try {
      const inspected = await inspectWav(selected)
      const extractedMetadata = await createAudioMetadata(selected, inspected)
      if (selectionVersion !== fileSelectionVersion.current) return
      setFile(selected)
      setWav(inspected)
      setMetadata(extractedMetadata)
    } catch (caught) {
      if (selectionVersion !== fileSelectionVersion.current) return
      setError(caught instanceof Error ? caught.message : 'WAVを解析できませんでした。')
    }
  }

  async function handleConvert() {
    if (!file || !wav || isConverting) {
      return
    }

    const controller = new AbortController()
    abortController.current = controller
    setIsConverting(true)
    setResult(null)
    setStoredId(null)
    setProgress(0)
    setError('')
    try {
      const converted = await convertWavToM4a(
        file,
        ({ percent }) => setProgress(percent),
        controller.signal,
      )
      setResult(converted)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('変換をキャンセルしました。')
      } else {
        setError(caught instanceof Error ? caught.message : '音声変換に失敗しました。')
      }
    } finally {
      abortController.current = null
      setIsConverting(false)
    }
  }

  async function handleUpload() {
    if (!result || !metadata || isUploading || storedId) return
    setIsUploading(true)
    setError('')
    try {
      const id = await uploadAudio(result.blob, metadata)
      setStoredId(id)
      onUploaded()
    } catch {
      setError('暗号化して保存できませんでした。通信状態とR2設定を確認してください。')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="upload-card" aria-labelledby="upload-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Encrypted upload</p>
          <h2 id="upload-title">WAVをM4Aへ変換</h2>
        </div>
        <span className="local-badge">端末内処理</span>
      </div>

      {supported === false ? (
        <p className="form-error" role="alert">
          このブラウザはAAC-LC変換に対応していません。新しいChromeなどの対応ブラウザをご利用ください。
        </p>
      ) : null}

      <label className="file-picker">
        <span>{file ? '別のWAVを選択' : 'WAVファイルを選択'}</span>
        <input
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          disabled={supported !== true || isConverting || isUploading}
          onChange={(event) => void handleFileChange(event.target.files?.[0])}
        />
      </label>

      {file && wav ? (
        <div className="file-summary">
          <strong>{file.name}</strong>
          <dl>
            <div><dt>元サイズ</dt><dd>{formatBytes(file.size)}</dd></div>
            <div><dt>長さ</dt><dd>{formatDuration(wav.durationSec)}</dd></div>
            <div><dt>入力</dt><dd>{wav.sampleRate / 1000}kHz / {wav.channels}ch / {wav.bitsPerSample}bit</dd></div>
            <div><dt>出力</dt><dd>AAC-LC / {AAC_BITRATE / 1000}kbps / Stereo</dd></div>
          </dl>
        </div>
      ) : null}

      {metadata ? (
        <fieldset
          className="metadata-fields"
          disabled={isConverting || isUploading || Boolean(storedId)}
        >
          <legend>メタデータ</legend>
          <div className="recorded-date-row">
            <label>
              <span>録音日</span>
              <input type="date" value={metadata.recordedDate} readOnly />
            </label>
            <small>{dateSourceLabels[metadata.recordedDateSource]}から取得</small>
          </div>
          <label>
            <span>タグ</span>
            <input
              type="text"
              value={tagText}
              placeholder="仕事, 会議"
              onChange={(event) => {
                const value = event.target.value
                setTagText(value)
                setMetadata((current) =>
                  current ? { ...current, tags: normalizeTags(value) } : current,
                )
              }}
            />
            <small>カンマ、読点、または改行で区切ります。</small>
          </label>
          <label>
            <span>メモ</span>
            <textarea
              rows={3}
              value={metadata.memo}
              placeholder="音声についてのメモ"
              onChange={(event) => {
                const memo = event.target.value
                setMetadata((current) => current ? { ...current, memo } : current)
              }}
            />
          </label>
          <div className="metadata-preview">
            <span>長さ {metadata.durationSec}秒</span>
            <span>連番 {metadata.sequence ?? 'なし'}</span>
            <span>タグ {metadata.tags.length}件</span>
          </div>
        </fieldset>
      ) : null}

      {isConverting ? (
        <div className="conversion-progress" aria-live="polite">
          <div><span>変換中…</span><strong>{progress}%</strong></div>
          <progress max="100" value={progress}>{progress}%</progress>
          <button className="secondary-button" type="button" onClick={() => abortController.current?.abort()}>
            キャンセル
          </button>
        </div>
      ) : null}

      {error ? <p className="form-error upload-error" role="alert">{error}</p> : null}

      {result ? (
        <div className="conversion-result" aria-live="polite">
          <strong>変換完了</strong>
          <span>M4A {formatBytes(result.blob.size)}</span>
          <span>AAC-LC {result.bitrate / 1000}kbps Stereo</span>
          {metadata ? (
            <span>{metadata.recordedDate} / タグ {metadata.tags.length}件</span>
          ) : null}
          <p>元のWAVはサーバーへ送信されていません。</p>
          {storedId ? <strong>暗号化してR2へ保存しました。</strong> : null}
        </div>
      ) : null}

      {result && metadata && !storedId ? (
        <button type="button" onClick={() => void handleUpload()} disabled={isUploading}>
          {isUploading ? '暗号化して保存中…' : '暗号化して保存'}
        </button>
      ) : null}

      {file && wav && !isConverting && !result ? (
        <button type="button" onClick={() => void handleConvert()}>
          M4Aへ変換
        </button>
      ) : null}
    </section>
  )
}
