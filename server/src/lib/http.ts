import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/**
 * An upstream AI provider answered with an error (or not at all). `status` is the
 * provider's HTTP status: it is only for logs and retry decisions and must never
 * reach our clients (an OpenRouter 401 would otherwise sign the app out).
 */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Express 5 forwards rejected promises, this only narrows the handler type. */
export const route =
  (handler: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

/** A request that never got an answer: network failure or our own timeout. */
export function isUnreachable(error: unknown) {
  const name = (error as Error | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError' || (error instanceof TypeError && /fetch failed|network/i.test(error.message));
}

/**
 * Maps any error to the status, code and message a client may see. Only our own
 * HttpErrors (and body-parser's client errors) keep their status; everything that
 * came from a provider becomes 502/503 with a generic message, logged here instead.
 */
export function toClientError(error: any): { status: number; code?: string; message: string } {
  if (error?.name === 'ZodError') return { status: 400, code: 'VALIDATION', message: 'Invalid request' };
  if (error instanceof HttpError) {
    if (error.status < 500) return { status: error.status, code: error.code, message: error.message };
    const provider = error.code?.startsWith('PROVIDER_');
    return { status: error.status, code: error.code, message: provider ? 'AI provider unavailable' : 'Internal error' };
  }
  // body-parser / http-errors: malformed JSON, payload too large.
  if (error?.expose === true && Number(error.status) >= 400 && Number(error.status) < 500) {
    return { status: Number(error.status), message: String(error.message) };
  }
  if (error instanceof ProviderError) {
    return error.status === 503
      ? { status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'AI provider unavailable' }
      : { status: 502, code: 'PROVIDER_ERROR', message: 'AI provider error' };
  }
  if (isUnreachable(error)) return { status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'AI provider unavailable' };
  // Anything else carrying an HTTP status (e.g. a provider SDK's ApiError) is an upstream failure.
  if (Number.isInteger(error?.status)) return { status: 502, code: 'PROVIDER_ERROR', message: 'AI provider error' };
  return { status: 500, code: 'INTERNAL', message: 'Internal error' };
}

export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  const mapped = toClientError(error);
  if (mapped.status >= 500) {
    const upstream = error instanceof ProviderError ? ` (${error.provider} ${error.status})` : '';
    console.error(`[mirobe] ${mapped.code ?? 'error'}${upstream}:`, error);
  }
  res.status(mapped.status).json({
    error: mapped.message,
    code: mapped.code,
    ...(error?.name === 'ZodError' ? { issues: error.issues } : {}),
  });
}
