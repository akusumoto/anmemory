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

export interface AudioListItem extends AudioMetadata {
  id: string
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

export async function checkEncryption(): Promise<StorageCheckResponse> {
  const response = await fetch('/api/encryption-check', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  return (await response.json()) as StorageCheckResponse
}

export async function listAudio(): Promise<AudioListItem[]> {
  const response = await fetch('/api/audio', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new ApiError(response.status, await readError(response))
  const body = (await response.json()) as { items: AudioListItem[] }
  return body.items
}

export async function uploadAudio(
  audio: Blob,
  metadata: AudioMetadata,
): Promise<string> {
  const form = new FormData()
  form.set('audio', audio, 'audio.m4a')
  form.set('metadata', JSON.stringify(metadata))
  const response = await fetch('/api/audio', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    body: form,
  })
  if (!response.ok) throw new ApiError(response.status, await readError(response))
  const body = (await response.json()) as { id: string }
  return body.id
}

export async function downloadAudio(id: string): Promise<Blob> {
  const response = await fetch(`/api/audio/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
    headers: { Accept: 'audio/mp4' },
  })
  if (!response.ok) throw new ApiError(response.status, await readError(response))
  return response.blob()
}

export async function deleteAudio(id: string): Promise<void> {
  const response = await fetch(`/api/audio/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new ApiError(response.status, await readError(response))
}
import type { AudioMetadata } from './audio/metadata'
