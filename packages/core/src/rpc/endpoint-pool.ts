/**
 * Ordered set of RPC endpoints for one chain, with a cooldown on recent failures.
 *
 * Endpoints are never removed — a cooled-down endpoint is only deprioritised, so a
 * transient outage does not permanently shrink the pool.
 */
export class EndpointPool {
  private readonly urls: readonly string[];
  private readonly failedAt = new Map<string, number>();
  private readonly cooldownMs: number;

  constructor(urls: readonly string[], cooldownMs: number) {
    if (urls.length === 0) {
      throw new Error('EndpointPool requires at least one URL');
    }
    this.urls = urls;
    this.cooldownMs = cooldownMs;
  }

  /** Every endpoint, healthy ones first, in the order they should be tried. */
  ordered(now: number = Date.now()): readonly string[] {
    const healthy: string[] = [];
    const cooling: string[] = [];

    for (const url of this.urls) {
      const failed = this.failedAt.get(url);
      if (failed !== undefined && now - failed < this.cooldownMs) {
        cooling.push(url);
      } else {
        healthy.push(url);
      }
    }

    return healthy.length > 0 ? [...healthy, ...cooling] : [...cooling];
  }

  /** The endpoint that should be tried first. */
  primary(now: number = Date.now()): string {
    return this.ordered(now)[0];
  }

  markFailure(url: string, now: number = Date.now()): void {
    this.failedAt.set(url, now);
  }

  markSuccess(url: string): void {
    this.failedAt.delete(url);
  }

  get size(): number {
    return this.urls.length;
  }
}

/**
 * An endpoint as it may be shown to a person, a log, or an AI agent.
 *
 * Hosted RPC URLs usually carry the API key in the path or query string, so only
 * the scheme and host survive.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hasSecretParts =
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      parsed.search !== '' ||
      parsed.username !== '' ||
      parsed.password !== '';
    return `${parsed.protocol}//${parsed.host}${hasSecretParts ? '/…' : ''}`;
  } catch {
    return '[unparseable url]';
  }
}

const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>)\]}]+/gi;

/** Redact every URL embedded in free text, such as an upstream error message. */
export function scrubUrls(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => redactUrl(match));
}
