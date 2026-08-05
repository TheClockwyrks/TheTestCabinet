// The join between what an agent was OFFERED and what it CALLED: the sentence both surface
// views hover with, and the spelling every other view of a call reads it back in.
//
// gg records every model-facing call under its own identity: a tool call under the tool, and a
// responses-as-code program's call under the API function the model wrote (`view.open_file`,
// `context.list`), whether or not a gg tool runs underneath it. So a count is per entry, full
// stop, and this file has no arithmetic left in it — only the wording and the vocabulary.
//
// It used to have plenty. When a call was recorded under the *tool* behind it, one gate backed
// several functions (`read_file` backed `fs.readFile`, `fs.readTextFile` and `view.openFile`)
// and fourteen functions had no tool at all, so a per-function figure was a claim the telemetry
// could not support and the views said so on the page. That is fixed where it was broken —
// at the recording seam — rather than papered over here, and the vocabulary went with it: these
// views never name a tool, because a responses-as-code agent does not call one.
//
// The one null that survives is a RECORD too old to carry a function's identity. It is a fact
// about the record and is said as one; reporting it as a zero would accuse the model of
// ignoring everything it was offered.

import type { GgAgentApi } from "@test-cabinet/run-record/gg";

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * How often an offered entry was called, said plainly.
 *
 * The zero says the same thing the cell does, in the same vocabulary: the cell reads `0×`
 * because a zero here is a measurement of the same kind as a three, and a sentence naming
 * the state in words would have put the finding in one register on the row and another on
 * hover — the wording the figures replaced, surviving in the tooltip. What the tooltip
 * adds is the contrast the muting cannot state on its own: a zero is a fact about
 * what the model did with something it HAD, which is a different finding from an entry it
 * was not offered at all and which therefore has no row here.
 *
 * `count` is null only for a surface record written before gg counted a call per function —
 * never for a function nothing dispatched, which is counted like any other.
 */
export function surfaceCallPhrase(name: string, count: number | null): string {
  if (count == null)
    return `${name} is bound. This record predates per-function call recording, so there is no count for it — not a count of zero.`;
  if (count === 0)
    return `${name} was offered, 0 calls — this agent was bound to it and did not use it, which is a different finding from one it was not offered.`;
  const times = `${numberFmt.format(count)} time${count === 1 ? "" : "s"}`;
  return `${name} was called ${times}.`;
}

/**
 * The SDK spelling of every function an instance's API surface binds, keyed by the identity its
 * calls are RECORDED under: `fs.read_file` → `fs.readFile`, `view.open_file` → `view.openFile`.
 *
 * The wire carries the language-independent key and nothing else — an `api_call` names
 * `(object, key)` (see `GgAgentApiFunction.key`), deliberately, so a count survives a run whose
 * programs were written in another language with other spellings. But the model wrote
 * `fs.readFile`, and a read-out of what an agent did should say what the agent said. The surface
 * carries both halves, and it is emitted when the incarnation is built — before that agent's
 * first call — so the lookup is always populated by the time a call needs it.
 *
 * A function with no `key` (a record written before gg counted per function) is skipped rather
 * than guessed at: the reverse of the snake_case convention is not a rule this console may
 * assume, and a caller that misses is expected to fall back to the wire spelling, which is at
 * least the identity the call was actually recorded under.
 */
export function apiCallSpellings(
  apis: readonly GgAgentApi[],
): Map<string, string> {
  const spellings = new Map<string, string>();
  for (const api of apis) {
    for (const fn of api.functions) {
      if (!fn.key) continue;
      spellings.set(`${api.object}.${fn.key}`, `${api.object}.${fn.name}`);
    }
  }
  return spellings;
}
