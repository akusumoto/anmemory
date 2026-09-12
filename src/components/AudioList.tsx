import { useEffect, useState } from 'react'
import {
  downloadAudio,
  listAudio,
  type AudioListItem as AudioListItemData,
} from '../api'
import AudioEdit from './AudioEdit'
import AudioItem from './AudioItem'

interface Props {
  refreshKey: number
}

function sortAudioItems(items: AudioListItemData[]): AudioListItemData[] {
  return [...items].sort((left, right) => {
    const dateOrder = right.recordedDate.localeCompare(left.recordedDate)
    if (dateOrder !== 0) return dateOrder
    const sequenceOrder =
      (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER)
    return sequenceOrder || right.uploadedAt.localeCompare(left.uploadedAt)
  })
}

export default function AudioList({ refreshKey }: Props) {
  const [items, setItems] = useState<AudioListItemData[]>([])
  const [loadedRefreshKey, setLoadedRefreshKey] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<AudioListItemData | null>(null)
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

  function removeItem(id: string) {
    setItems((current) => current.filter((audio) => audio.id !== id))
    setPlayback((current) => {
      if (current?.id === id) {
        URL.revokeObjectURL(current.url)
        return null
      }
      return current
    })
    setEditingItem(null)
  }

  if (editingItem) {
    return (
      <AudioEdit
        audio={editingItem}
        onBack={() => setEditingItem(null)}
        onDeleted={removeItem}
        onSaved={(updated) => {
          setItems((current) => sortAudioItems(
            current.map((item) => item.id === updated.id ? updated : item),
          ))
          setEditingItem(null)
        }}
      />
    )
  }

  return (
    <section className="audio-list-card" aria-label="音声一覧">
      {loading ? <p className="list-status">一覧を復号しています…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="list-status">保存された音声はありません。</p>
      ) : null}

      <div className="audio-items">
        {items.map((audio) => (
          <AudioItem
            key={audio.id}
            audio={audio}
            isLoading={loadingId === audio.id}
            playbackUrl={playback?.id === audio.id ? playback.url : null}
            onPlay={() => void handlePlay(audio.id)}
            onEdit={() => setEditingItem(audio)}
          />
        ))}
      </div>
    </section>
  )
}
