import { LocktekError, ErrorCode } from '../types/common.js';

export interface CallContext {
  readonly operation: string;
  readonly chain: string;
  readonly endpoint?: string;
}

/**
 * Run an operation under a hard deadline.
 *
 * The {@link AbortSignal} is passed through so the underlying request is actually
 * cancelled rather than abandoned to keep running in the background.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  context: CallContext,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new LocktekError(
          `${context.operation} on ${context.chain} timed out after ${timeoutMs}ms` +
            `${context.endpoint ? ` (endpoint: ${context.endpoint})` : ''}. ` +
            'Increase timeoutMs or configure a more reliable RPC endpoint.',
          ErrorCode.TIMEOUT,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
