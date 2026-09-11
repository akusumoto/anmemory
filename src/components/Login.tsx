import { type FormEvent, useState } from 'react'
import { ApiError, login } from '../api'

interface LoginProps {
  onAuthenticated: () => void
}

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'パスワードが正しくありません。'
    }
    if (error.status === 429) {
      return '試行回数が上限を超えました。1分ほど待ってから再度お試しください。'
    }
    if (error.status === 500) {
      return '認証が設定されていません。管理者設定を確認してください。'
    }
  }
  return 'ログインできませんでした。通信状態を確認して再度お試しください。'
}

export default function Login({ onAuthenticated }: LoginProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || isSubmitting) {
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await login(password)
      setPassword('')
      onAuthenticated()
    } catch (caughtError) {
      setError(messageForError(caughtError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <p className="eyebrow">Private audio archive</p>
        <h1 id="login-title">AnMemory</h1>
        <p className="description">
          保存した音声を見るには、マスターパスワードを入力してください。
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="password">マスターパスワード</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            required
            autoFocus
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={!password || isSubmitting}>
            {isSubmitting ? '確認中…' : 'ログイン'}
          </button>
        </form>

        <p className="security-note">セッションは1時間で自動的に終了します。</p>
      </section>
    </main>
  )
}
