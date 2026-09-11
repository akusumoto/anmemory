import type { AudioListItem as AudioListItemData } from '../api'

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

interface Props {
  audio: AudioListItemData
  isDeleting: boolean
  isLoading: boolean
  playbackUrl: string | null
  onDelete: () => void
  onPlay: () => void
}

export default function AudioItem({
  audio,
  isDeleting,
  isLoading,
  playbackUrl,
  onDelete,
  onPlay,
}: Props) {
  return (
    <article className="audio-item">
      <div className="audio-item-heading">
        <div>
          <strong>{audio.fileName}</strong>
          <span>{formatDuration(audio.durationSec)}</span>
        </div>
        {audio.sequence !== null ? <span className="sequence">#{audio.sequence}</span> : null}
      </div>

      {audio.tags.length > 0 ? (
        <div className="audio-tags">
          {audio.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
      {audio.memo ? <p className="audio-memo">{audio.memo}</p> : null}

      {playbackUrl ? (
        <audio className="audio-player" controls autoPlay src={playbackUrl} />
      ) : null}

      <div className="audio-actions">
        <button type="button" onClick={onPlay} disabled={isLoading || isDeleting}>
          {isLoading ? '復号中…' : playbackUrl ? '再読み込み' : '再生'}
        </button>
        <button
          className="danger-button"
          type="button"
          onClick={onDelete}
          disabled={isDeleting || isLoading}
        >
          {isDeleting ? '削除中…' : '削除'}
        </button>
      </div>
    </article>
  )
}
