function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  botToken: requireEnv('BOT_TOKEN'),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001',
} as const
