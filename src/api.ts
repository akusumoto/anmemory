interface SessionResponse {
  authenticated: boolean
}

interface ErrorResponse {
  error?: string
}

interface StorageCheckResponse {
  ok: boolean
  checkedAt: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponse
    return body.error ?? 'Request failed'
  } catch {
    return 'Request failed'
  }
}

export async function getSession(): Promise<boolean> {
  const response = await fetch('/api/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  const body = (await response.json()) as SessionResponse
  return body.authenticated
}

export async function login(password: string): Promise<void> {
  const response = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }
}

export async function checkStorage(): Promise<StorageCheckResponse> {
  const response = await fetch('/api/storage-check', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  return (await response.json()) as StorageCheckResponse
}
