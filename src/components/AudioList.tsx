import { useEffect, useMemo, useState } from 'react'
import {
  deleteAudio,
  downloadAudio,
  listAudio,
  type AudioListItem as AudioListItemData,
} from '../api'
import AudioItem from './AudioItem'

interface Props {
  refreshKey: number
}

export default function AudioList({ refreshKey }: Props) {
  const [items, setItems] = useState<AudioListItemData[]>([])
  const [loadedRefreshKey, setLoadedRefreshKey] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [playback, setPlayback] = useState<{ id: string; url: string } | null>(null)
  const loading = loadedRefreshKey !== refreshKey

  useEffect(() => {
    let active = true
    void listAudio()
      .then((loaded) => {
        if (active) {
          setItems(loaded)
          setError('')
        }
      })
      .catch(() => {
        if (active) setError('音声一覧を取得できませんでした。')
      })
      .finally(() => {
        if (active) setLoadedRefreshKey(refreshKey)
      })
    return () => {
      active = false
    }
  }, [refreshKey])

  useEffect(() => () => {
    if (playback) URL.revokeObjectURL(playback.url)
  }, [playback])

  const groups = useMemo(() => {
    const grouped = new Map<string, AudioListItemData[]>()
    for (const item of items) {
      const group = grouped.get(item.recordedDate) ?? []
      group.push(item)
      grouped.set(item.recordedDate, group)
    }
    return [...grouped]
  }, [items])

  async function handlePlay(id: string) {
    if (loadingId) return
    setLoadingId(id)
    setError('')
    try {
      const blob = await downloadAudio(id)
      const url = URL.createObjectURL(blob)
      setPlayback((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { id, url }
      })
    } catch {
      setError('音声を復号して取得できませんでした。')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleDelete(item: AudioListItemData) {
    if (!window.confirm(`${item.fileName} を削除しますか？`)) return
    setDeletingId(item.id)
    setError('')
    try {
      await deleteAudio(item.id)
      setItems((current) => current.filter((audio) => audio.id !== item.id))
      setPlayback((current) => {
        if (current?.id === item.id) {
          URL.revokeObjectURL(current.url)
          return null
        }
        return current
      })
    } catch {
      setError('音声を削除できませんでした。')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="audio-list-card" aria-labelledby="audio-list-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Private R2</p>
          <h2 id="audio-list-title">保存した音声</h2>
        </div>
        <span className="audio-count">{items.length}件</span>
      </div>

      {loading ? <p className="list-status">一覧を復号しています…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="list-status">保存された音声はありません。</p>
      ) : null}

      <div className="audio-groups">
        {groups.map(([date, group]) => (
          <section className="audio-group" key={date} aria-labelledby={`date-${date}`}>
            <h3 id={`date-${date}`}>{date.replaceAll('-', '/')}</h3>
            <div className="audio-items">
              {group.map((audio) => (
                <AudioItem
                  key={audio.id}
                  audio={audio}
                  isDeleting={deletingId === audio.id}
                  isLoading={loadingId === audio.id}
                  playbackUrl={playback?.id === audio.id ? playback.url : null}
                  onPlay={() => void handlePlay(audio.id)}
                  onDelete={() => void handleDelete(audio)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
