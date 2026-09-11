export interface AppEnv {
  ASSETS: Fetcher
  LOGIN_RATE_LIMITER: RateLimit
  MASTER_PASSWORD_VERIFIER: string
  SESSION_SECRET: string
  ENCRYPTION_KEY: string
}
