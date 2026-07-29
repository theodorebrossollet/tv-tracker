// Structured logging.
//
// Everything goes out as one JSON object per line. That's what makes Vercel's
// runtime logs actually searchable later — plain sentences can't be filtered by
// event or show id, which is the whole reason you go looking at logs.
//
// Deliberately tiny: no dependency, no transport, no buffering. Vercel (and
// `next dev`) capture stdout/stderr, so writing there is enough. If logs ever
// need to outlive Vercel's retention, point a log drain at the same stream
// rather than changing call sites.

type Level = "info" | "warn" | "error";

/** Extra context. Keep it to identifiers and counts — never secrets. */
export type LogFields = Record<string, unknown>;

function emit(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...fields,
  });

  // Errors and warnings go to stderr so they can be filtered by stream alone.
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Reduces an unknown thrown value to something loggable.
 *
 * Only the message and name are kept. Stacks are noisy in aggregated logs, and
 * a thrown TMDB URL could carry the API key as a query parameter for v3 keys —
 * so nothing that might contain one is ever logged.
 */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message };
  }

  return { errorMessage: String(error) };
}

export const logger = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
