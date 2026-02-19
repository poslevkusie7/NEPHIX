import { getXaiApiKey, getXaiBaseUrl } from '@/lib/env';

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type XaiResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function completeWithXai(
  messages: AiMessage[],
  options: {
    model: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  const apiKey = getXaiApiKey();
  const baseUrl = getXaiBaseUrl().replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 350,
    }),
  });

  if (!response.ok) {
    throw new Error(`xAI request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as XaiResponse;
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('xAI returned an empty response.');
  }

  return content;
}

export async function tryCompleteWithXai(
  messages: AiMessage[],
  options: {
    model: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string | null> {
  try {
    return await completeWithXai(messages, options);
  } catch {
    return null;
  }
}
