import type { Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { createExpressApp } from '../server.ts';

let cachedAppPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!cachedAppPromise) {
    cachedAppPromise = createExpressApp({
      skipVite: true,
      apiOnly: true
    }).catch((err) => {
      cachedAppPromise = null;
      throw err;
    });
  }
  return cachedAppPromise;
}

/**
 * Normalizes Vercel rewrite path query parameter (`?__vercel_path=...`) back into
 * the original `/api/...` Express route path while preserving all client query params.
 */
function normalizeVercelApiUrl(req: IncomingMessage): void {
  try {
    const rawUrl = req.url || '/';
    const parsed = new URL(rawUrl, 'http://localhost');
    const rewrittenSubpath = parsed.searchParams.get('__vercel_path');
    if (rewrittenSubpath !== null) {
      parsed.searchParams.delete('__vercel_path');
      const cleanSub = rewrittenSubpath.replace(/^\/+/, '');
      const remainingQuery = parsed.searchParams.toString();
      req.url = `/api/${cleanSub}${remainingQuery ? `?${remainingQuery}` : ''}`;
    } else if (parsed.pathname === '/api/index') {
      req.url = `/api/health${parsed.search}`;
    }
  } catch {
    // Keep original req.url if URL parsing fails
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  normalizeVercelApiUrl(req);

  try {
    const app = await getApp();
    await new Promise<void>((resolve) => {
      const done = () => {
        res.removeListener('finish', done);
        res.removeListener('close', done);
        resolve();
      };
      res.once('finish', done);
      res.once('close', done);
      (app as any)(req, res);
    });
  } catch (err: any) {
    console.error('[Vercel API] Unhandled request initialization error:', err?.message || err);
    if (!res.headersSent && !res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          code: 'SERVER_INIT_ERROR',
          error: 'Terjadi kesalahan inisialisasi backend API MoraJaws.'
        })
      );
    }
  }
}
