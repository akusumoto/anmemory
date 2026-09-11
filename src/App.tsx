import { useEffect, useState } from 'react'
import { getSession, logout } from './api'
import Login from './components/Login'
import './App.css'

type AuthState = 'checking' | 'authenticated' | 'unauthenticated' | 'error'

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking')

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
      <section className="empty-state">
        <span className="lock-icon" aria-hidden="true">✓</span>
        <h2>ログインしました</h2>
        <p>認証機能の準備ができました。音声保管機能は次の段階で追加します。</p>
      </section>
    </main>
  )
}

export default App
