const DEFAULT_ACCESS_TTL_MINUTES = 15;
const DEFAULT_REFRESH_TTL_DAYS = 30;
const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 30;
const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_XAI_MODEL_CHAT = 'grok-3-mini';
const DEFAULT_XAI_MODEL_THESIS = 'grok-3-mini';
const DEFAULT_XAI_MODEL_HINT = 'grok-3-mini';
const DEFAULT_XAI_MODEL_PARSE = 'grok-3-mini';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export function getPasswordResetTokenTtlMinutes(): number {
  const raw = process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES;
  const value = raw ? Number(raw) : DEFAULT_PASSWORD_RESET_TTL_MINUTES;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PASSWORD_RESET_TTL_MINUTES;
}

export function getXaiApiKey(): string {
  return required('XAI_API_KEY');
}

export function getXaiBaseUrl(): string {
  return optional('XAI_BASE_URL') ?? DEFAULT_XAI_BASE_URL;
}

export function getXaiModelChat(): string {
  return optional('XAI_MODEL_CHAT') ?? DEFAULT_XAI_MODEL_CHAT;
}

export function getXaiModelThesis(): string {
  return optional('XAI_MODEL_THESIS') ?? DEFAULT_XAI_MODEL_THESIS;
}

export function getXaiModelHint(): string {
  return optional('XAI_MODEL_HINT') ?? DEFAULT_XAI_MODEL_HINT;
}

export function getXaiModelParse(): string {
  return optional('XAI_MODEL_PARSE') ?? DEFAULT_XAI_MODEL_PARSE;
}
