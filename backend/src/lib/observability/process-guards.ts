/**
 * Last-resort process guard (AUDIT5 §F1c, M-c2).
 *
 * Node 20's default action for an unhandled promise rejection is to THROW it, which ends the process.
 * That is the right default for a script and the wrong one for a long-lived server: a single stray
 * rejection anywhere (a dependency that went away, a fire-and-forget call in a background job) takes
 * the whole API down, and with `restart: unless-stopped` in front of it, down repeatedly.
 *
 * The measured case that motivated this: booting with Redis unreachable rejected inside Nest
 * bootstrap, escaped `void bootstrap()`, and killed the process before it could serve /health/live.
 * `RedisService` now handles that specific rejection at the source; this guard is the net UNDER it,
 * for the rejections nobody predicted.
 *
 * SCOPE, deliberately narrow:
 *  - `unhandledRejection` only. `uncaughtException` is NOT installed — after one, the process is in
 *    an unknown state and continuing would be worse than restarting.
 *  - The rejection is always logged to stderr as one line, and handed to the error sink the caller
 *    supplies (main.ts passes Sentry). It is never swallowed silently, and the process's own exit
 *    code is never touched.
 *
 * The Sentry SDK is deliberately NOT imported here: the caller injects the sink, which keeps this
 * module (and the unit suite that covers it) free of a multi-second SDK load.
 */
export interface ProcessGuardDeps {
  /** Where the one-line report goes. Defaults to stderr. */
  log?: (message: string) => void;
  /** Error sink (main.ts passes Sentry). Omitted → the rejection is logged only. */
  capture?: (error: unknown) => void;
  /** Process to attach to. Defaults to the real one (overridable in tests). */
  target?: Pick<NodeJS.Process, 'on'>;
}

export function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return '[unserialisable rejection reason]';
  }
}

/** Register the guard. Returns the handler so a test can drive it without faking a real rejection. */
export function installProcessGuards(deps: ProcessGuardDeps = {}): (reason: unknown) => void {
  const log = deps.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const capture = deps.capture;
  const target = deps.target ?? process;

  const onUnhandledRejection = (reason: unknown): void => {
    try {
      capture?.(reason);
    } catch {
      // A broken error sink must never be the thing that kills the process.
    }
    log(
      `[process-guard] unhandledRejection (process kept alive): ${describeRejection(reason)}`,
    );
  };

  target.on('unhandledRejection', onUnhandledRejection);
  return onUnhandledRejection;
}
