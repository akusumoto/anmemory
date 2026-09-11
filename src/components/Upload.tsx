import { useEffect, useRef, useState } from 'react'
import {
  AAC_BITRATE,
  convertWavToM4a,
  type ConversionResult,
  supportsAacEncoding,
} from '../audio/encoder.ts'
import { inspectWav, type WavInfo } from '../audio/wav.ts'

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

export default function Upload() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [wav, setWav] = useState<WavInfo | null>(null)
  const [result, setResult] = useState<ConversionResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const abortController = useRef<AbortController | null>(null)

  useEffect(() => {
    void supportsAacEncoding().then(setSupported)
    return () => abortController.current?.abort()
  }, [])

  async function handleFileChange(selected: File | undefined) {
    abortController.current?.abort()
    setFile(null)
    setWav(null)
    setResult(null)
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
      setFile(selected)
      setWav(inspected)
    } catch (caught) {
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

  return (
    <section className="upload-card" aria-labelledby="upload-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Phase 4</p>
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
          disabled={supported !== true || isConverting}
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
          <p>元のWAVはサーバーへ送信されていません。</p>
        </div>
      ) : null}

      {file && wav && !isConverting && !result ? (
        <button type="button" onClick={() => void handleConvert()}>
          M4Aへ変換
        </button>
      ) : null}
    </section>
  )
}
