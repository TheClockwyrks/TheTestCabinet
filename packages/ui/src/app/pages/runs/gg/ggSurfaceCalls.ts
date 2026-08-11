// The join between what an agent was OFFERED and what it CALLED: the sentence both surface
// views hover with, and the spelling every other view of a call reads it back in.
//
// gg records every model-facing call under its own identity: a tool call under the tool, and a
// responses-as-code program's call under the OPERATION it resolved to (`views.open_file`,
// `files.read_file`), whether or not a gg tool runs underneath it. So a count is per entry, full
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
 * calls are RECORDED under: `files.read_file` → `gg.files.readFile`.
 *
 * The wire carries gg's own operation id and nothing else — an `api_call` names
 * `files.read_file` (see `GgAgentApiFunction.operation`), deliberately, so a count survives a run
 * whose programs were written in another language with other spellings, and so two arms of a
 * cross-language study can be counted together at all. But the model wrote `gg.files.readFile`,
 * and a read-out of what an agent did should say what the agent said. The surface carries both
 * halves — gg's identity and this arm's spelling of it — and it is emitted when the incarnation is
 * built, before that agent's first call, so the lookup is always populated by the time a call needs
 * it.
 *
 * A function with no `operation` (a record written before gg counted per function, or an entry
 * naming an operation gg does not have) is skipped rather than guessed at: no rule turns one
 * vocabulary into the other, and a caller that misses is expected to fall back to the wire
 * identity, which is at least what the call was actually recorded under.
 *
 * Where two spellings serve one operation — an arm that offers a method beside the free function —
 * the first wins, which is the arm's own canonical binding: the catalogue declares it first and an
 * alias after it.
 */
export function apiCallSpellings(
  apis: readonly GgAgentApi[],
): Map<string, string> {
  const spellings = new Map<string, string>();
  for (const api of apis) {
    for (const fn of api.functions) {
      if (!fn.operation || spellings.has(fn.operation)) continue;
      spellings.set(fn.operation, `${api.path}.${fn.name}`);
    }
  }
  return spellings;
}

/**
 * What one documentation mode did, said plainly — the hover behind every place the mode is
 * named.
 *
 * It lives beside the surface wording rather than in a component because two views show the
 * mode and they must say the same thing about it: an instance's chip in the explorer, and the
 * profile-level surface card a reader compares two arms of a within-run A/B on. The mode is
 * the *cause* whose effect that card's documentation figures are, and a card that showed the
 * cost without the arm would be showing an effect with nothing on it.
 *
 * `subject` is who the sentence is about, because the two callers are at different grains: one
 * instance, or every instance of a profile.
 *
 * The unknown case is a mode from a newer gg than this console: it is named rather than
 * explained, because a wrong explanation of a real setting is worse than none.
 */
export function docViewTypesPhrase(
  mode: string,
  subject: "instance" | "profile" = "instance",
): string {
  const what =
    mode === "off"
      ? "opened no type documentation beside a function it looked up"
      : mode === "return"
        ? "opened the documentation of a function's return type beside it"
        : mode === "return-and-parameters"
          ? "opened the documentation of every type a function's signature names — its return and its arguments"
          : "ran under a documentation mode this console does not know";
  const who = subject === "profile" ? "Every instance of this agent" : "This instance";
  const whose =
    subject === "profile" ? "these agents' own documentation band" : "this agent's own documentation band";
  return `${who} ${what}. It is a per-agent setting, so another agent of the same run may have been on another mode; what it cost is ${whose}.`;
}
