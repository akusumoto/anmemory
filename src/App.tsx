import { useEffect, useState } from 'react'
import { checkStorage, getSession, logout } from './api'
import Login from './components/Login'
import './App.css'

type AuthState = 'checking' | 'authenticated' | 'unauthenticated' | 'error'
type StorageState = 'idle' | 'checking' | 'available' | 'error'

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [storageState, setStorageState] = useState<StorageState>('idle')

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

  async function handleStorageCheck() {
    if (storageState === 'checking') {
      return
    }

    setStorageState('checking')
    try {
      await checkStorage()
      setStorageState('available')
    } catch {
      setStorageState('error')
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
        <span className="lock-icon" aria-hidden="true">R2</span>
        <h2>ストレージ接続</h2>
        <p>
          ランダムなテストデータを保存・取得・削除して、Private R2への接続を確認します。
        </p>
        <button
          className="storage-check-button"
          type="button"
          onClick={handleStorageCheck}
          disabled={storageState === 'checking'}
        >
          {storageState === 'checking' ? '確認中…' : 'R2接続を確認'}
        </button>
        <div className="storage-result" aria-live="polite">
          {storageState === 'available' ? (
            <p className="success-message">保存・取得・削除に成功しました。</p>
          ) : null}
          {storageState === 'error' ? (
            <p className="form-error">
              R2へ接続できませんでした。Bindingとバケット設定を確認してください。
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default App
