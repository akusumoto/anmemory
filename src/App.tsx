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
        <button className="secondary-button" type="button" onClick={handleLogout}>
          ログアウト
        </button>
      </header>
      <Upload onUploaded={() => setAudioRefreshKey((current) => current + 1)} />
      <AudioList refreshKey={audioRefreshKey} />
    </main>
  )
}

export default App
