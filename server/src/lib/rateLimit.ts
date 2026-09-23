import type { Request } from 'express';

/**
 * In-process sliding-window limiter (the API runs as a single instance). Each
 * key keeps the timestamps of its recent attempts; stale keys are swept lazily.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(
    private limit: number,
    private windowMs: number
  ) {}

  /** Records an attempt; false when the key already used up its window. */
  attempt(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/**
 * Client IP for rate limiting. In production Caddy only accepts traffic from
 * Cloudflare, so CF-Connecting-IP is set by Cloudflare and a client cannot pick
 * its own bucket. Without the header (local/dev) use the socket peer.
 * Caveat: deploy/Caddyfile itself does not allowlist Cloudflare ranges (the :80
 * site answers any host); if the origin is reachable directly, this header can be
 * forged, and only the per-email limit still holds. Enforce it at the firewall.
 */
export function clientIp(req: Request): string {
  const cf = req.header('cf-connecting-ip');
  return cf?.trim() || req.socket.remoteAddress || 'unknown';
}
