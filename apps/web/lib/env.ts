const DEFAULT_ACCESS_TTL_MINUTES = 15;
const DEFAULT_REFRESH_TTL_DAYS = 30;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getJwtSecret(): string {
  return required('JWT_SECRET');
}

export function getAccessTokenTtlMinutes(): number {
  const raw = process.env.ACCESS_TOKEN_TTL_MINUTES;
  const value = raw ? Number(raw) : DEFAULT_ACCESS_TTL_MINUTES;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ACCESS_TTL_MINUTES;
}

export function getRefreshTokenTtlDays(): number {
  const raw = process.env.REFRESH_TOKEN_TTL_DAYS;
  const value = raw ? Number(raw) : DEFAULT_REFRESH_TTL_DAYS;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_REFRESH_TTL_DAYS;
}
