import { useEffect, useState } from 'react'
import { getSession, logout } from './api'
import AudioList from './components/AudioList'
import Login from './components/Login'
import Upload from './components/Upload'
import './App.css'

type AuthState = 'checking' | 'authenticated' | 'unauthenticated' | 'error'

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [audioRefreshKey, setAudioRefreshKey] = useState(0)
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  useEffect(() => {
    let active = true
    getSession()
      .then((authenticated) => {
        if (active) {
          setAuthState(authenticated ? 'authenticated' : 'unauthenticated')
        }
      })
      .catch(() => {
        if (active) {
          setAuthState('error')
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function handleLogout() {
    try {
      await logout()
    } finally {
      setAuthState('unauthenticated')
    }
  }

  if (authState === 'checking') {
    return (
      <main className="status-layout" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>セッションを確認しています…</p>
      </main>
    )
  }

  if (authState === 'error') {
    return (
      <main className="status-layout">
        <p>サイトへ接続できませんでした。</p>
        <button type="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </main>
    )
  }

  if (authState === 'unauthenticated') {
    return <Login onAuthenticated={() => setAuthState('authenticated')} />
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Private audio archive</p>
          <h1>AnMemory</h1>
        </div>
        <div className="app-header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="アップロード"
            title="アップロード"
            onClick={() => setIsUploadOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
            </svg>
          </button>
          <button
            className="secondary-button icon-button"
            type="button"
            aria-label="ログアウト"
            title="ログアウト"
            onClick={handleLogout}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 5H5v14h5m4-3 4-4-4-4m4 4H9" />
            </svg>
          </button>
        </div>
      </header>
      <AudioList refreshKey={audioRefreshKey} />
      {isUploadOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setIsUploadOpen(false)}
        >
          <div
            className="upload-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="secondary-button dialog-close-button"
              type="button"
              onClick={() => setIsUploadOpen(false)}
            >
              閉じる
            </button>
            <Upload
              onUploaded={() => {
                setAudioRefreshKey((current) => current + 1)
                setIsUploadOpen(false)
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
