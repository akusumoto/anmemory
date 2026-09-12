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
  isLoading: boolean
  playbackUrl: string | null
  onEdit: () => void
  onPlay: () => void
}

export default function AudioItem({
  audio,
  isLoading,
  playbackUrl,
  onEdit,
  onPlay,
}: Props) {
  return (
    <article className="audio-item">
      <div className="audio-item-heading">
        <button
          className="audio-play-button"
          type="button"
          aria-label={`${audio.fileName}を再生`}
          title="再生"
          onClick={onPlay}
          disabled={isLoading}
        >
          {isLoading ? '…' : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 7 8 5-8 5V7Z" />
            </svg>
          )}
        </button>
        <button className="audio-edit-trigger" type="button" onClick={onEdit}>
          <span className="audio-title-row">
            <strong>{audio.fileName}</strong>
            <span>{formatDuration(audio.durationSec)}</span>
            {audio.sequence !== null ? <span className="sequence">#{audio.sequence}</span> : null}
          </span>
          <span className="audio-meta-line">
            <time dateTime={audio.recordedDate}>{audio.recordedDate.replaceAll('-', '/')}</time>
            {audio.tags.length > 0 ? <span>{audio.tags.map((tag) => `#${tag}`).join(' ')}</span> : null}
            {audio.memo ? <span>{audio.memo}</span> : null}
          </span>
        </button>
      </div>

      {playbackUrl ? (
        <audio className="audio-player" controls autoPlay src={playbackUrl} />
      ) : null}
    </article>
  )
}
