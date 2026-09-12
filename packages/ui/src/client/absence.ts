// The one rule every host's resolvers answer a failed HTTP read by, so "this is
// not here" and "I could not find out" never collapse into each other.
//
// A resolver that returns `null` is telling its caller the store holds no such
// thing, and the surfaces above it print that as "No run found for …". Only the
// store's own `404` says that. Everything else — offline, a 500, a gateway page,
// a body that isn't the JSON it claims to be — is a read that FAILED, and a
// failed read must throw so the surface reports a failure instead of answering a
// question it never got an answer to. See the UI overview's "Loading, absence
// and failure".
//
// The console's transports work this way too, and through this same module: the
// HTTP transports throw the {@link HttpReadError} below — which carries the
// status as DATA, not just inside `<path>: HTTP <status>: <detail>` — and the
// live gallery's `readRun` lets a carried `404` and nothing else through as
// null. So the static site's own resolvers — which supply the gallery the same
// `readRun`, `fetchRunEvents` and `readCodeAnalysis` hooks — agree with the
// console rather than re-deriving the rule, and it can be tested once.
//
// Two shapes, one rule. A resolver holding the `Response` classifies it with
// {@link readOutcome}; a resolver that called a transport and caught what it
// threw asks {@link isAbsence}. Neither reads an error message.

/** What a completed `fetch` means for a resolver reading one entity. */
export type ReadOutcome = "found" | "absent";

/**
 * Classify a `fetch` Response for a resolver that returns `T | null`.
 *
 * - An `ok` response is `"found"` — read the body.
 * - A `404` is `"absent"` — the store answered, and it holds no such thing.
 * - Anything else THROWS: the read failed, and the caller must not turn that
 *   into an absence.
 *
 * `subject` names what was being read, for the thrown message — a path, or a
 * phrase like `run abc`. The message keeps the HTTP transports' shape,
 * `<subject>: HTTP <status>: <detail>`, so a failure reads the same wherever it
 * surfaced from, and the thrown {@link HttpReadError} carries the status as data
 * so a caller further up decides on the number rather than on the sentence.
 */
export function readOutcome(response: Response, subject: string): ReadOutcome {
  if (response.ok) return "found";
  if (response.status === 404) return "absent";
  throw new HttpReadError(subject, response.status, response.statusText);
}

/**
 * A read that reached a store and came back non-2xx, carrying the status AS DATA.
 *
 * The status is the whole of how absence is told from failure (see
 * {@link readOutcome}), so it has to survive the throw. It used to survive only
 * inside the message — the transports wrote `<subject>: HTTP <status>: <detail>`
 * and the live gallery's `readRun` read the status back out with a regular
 * expression — and that is not a channel, it is a coincidence: `detail` is the
 * backend's own envelope message, so a `500` whose message quoted a URL or an
 * upstream's own words containing "HTTP 404" was read as the store saying it
 * holds no such run, and the page printed "No run found for <id>". That is the
 * exact defect this seam exists to close, arriving through the string.
 *
 * The message keeps its shape — a failure still reads the same wherever it
 * surfaced from, and every existing surface prints it unchanged — but no caller
 * has to parse it any more.
 */
export class HttpReadError extends Error {
  /** The status the store answered with. `404` — and only `404` — is an absence. */
  readonly status: number;
  /** What was being read: a request path, or a phrase like `run abc`. */
  readonly subject: string;

  constructor(subject: string, status: number, detail?: string | null) {
    super(`${subject}: HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "HttpReadError";
    this.status = status;
    this.subject = subject;
  }
}

/**
 * The HTTP status a thrown value carries, or `null` where it carries none.
 *
 * `null` is the answer for every failure that never reached a store at all — a
 * DNS failure, a dropped connection, a CORS rejection, an abort — and a caller
 * deciding absence must treat `null` as a FAILURE. A read that never got an
 * answer cannot be the store answering "no such thing".
 *
 * The status is read structurally rather than only by `instanceof` so an error
 * thrown by a duplicate copy of this module — the console bundles this package,
 * the static site imports it — is still understood.
 */
export function httpStatusOf(cause: unknown): number | null {
  if (cause instanceof HttpReadError) return cause.status;
  if (cause instanceof Error) {
    const status = (cause as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return null;
}

/**
 * Whether a thrown read is the store saying it holds no such thing.
 *
 * The counterpart of {@link readOutcome} for a resolver that catches rather than
 * classifies — the live gallery's `readRun` calls a transport, not `fetch`, so
 * the response is long gone by the time it decides. Only a carried `404` is an
 * absence; everything else, statusless failures included, is a failure.
 */
export function isAbsence(cause: unknown): boolean {
  return httpStatusOf(cause) === 404;
}
