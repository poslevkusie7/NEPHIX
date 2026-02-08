import { NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';

export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const raw = await request.json();
  return schema.parse(raw);
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
