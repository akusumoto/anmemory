import { type FormEvent, useState } from 'react'
import {
  deleteAudio,
  updateAudioMetadata,
  type AudioListItem,
} from '../api'
import { normalizeTags } from '../audio/metadata'

interface Props {
  audio: AudioListItem
  onBack: () => void
  onDeleted: (id: string) => void
  onSaved: (audio: AudioListItem) => void
}

export default function AudioEdit({ audio, onBack, onDeleted, onSaved }: Props) {
  const [recordedDate, setRecordedDate] = useState(audio.recordedDate)
  const [tagText, setTagText] = useState(audio.tags.join(', '))
  const [memo, setMemo] = useState(audio.memo)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving || isDeleting) return
    setIsSaving(true)
    setError('')
    try {
      onSaved(await updateAudioMetadata(audio.id, {
        recordedDate,
        tags: normalizeTags(tagText),
        memo,
      }))
    } catch {
      setError('タグとメモを保存できませんでした。')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (isSaving || isDeleting) return
    if (!window.confirm(`${audio.fileName} を削除しますか？`)) return
    setIsDeleting(true)
    setError('')
    try {
      await deleteAudio(audio.id)
      onDeleted(audio.id)
    } catch {
      setError('音声を削除できませんでした。')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="audio-edit-card" aria-labelledby="audio-edit-title">
      <div className="section-heading edit-heading">
        <div>
          <h2 id="audio-edit-title">編集</h2>
          <p className="edit-file-name">{audio.fileName}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      <form className="edit-form" onSubmit={handleSave}>
        <label>
          <span>録音日</span>
          <input
            type="date"
            value={recordedDate}
            onChange={(event) => setRecordedDate(event.target.value)}
            required
          />
        </label>
        <label>
          <span>タグ</span>
          <input
            type="text"
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
          />
        </label>
        <label>
          <span>メモ</span>
          <textarea
            rows={5}
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={isSaving || isDeleting}>
          {isSaving ? '保存中…' : '保存'}
        </button>
      </form>

      <button
        className="danger-button edit-delete-button"
        type="button"
        onClick={() => void handleDelete()}
        disabled={isSaving || isDeleting}
      >
        {isDeleting ? '削除中…' : '削除'}
      </button>
    </section>
  )
}
