// The join between what an agent was OFFERED and what it CALLED: the sentence both surface
// views hover with, and the spelling every other view of a call reads it back in.
//
// gg records every model-facing call under its own identity: a tool call under the tool, and a
// responses-as-code program's call under the OPERATION it resolved to (`views.open_file`,
// `files.read_file`), whether or not a gg tool runs underneath it. So a count is per entry, full
// stop, and this file has no arithmetic left in it — only the wording and the vocabulary.
//
// So there is no third state anywhere below: an offered entry was called some number of times,
// and that number can be zero. The vocabulary follows the recording seam — these views never
// name a tool, because a responses-as-code agent does not call one.

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
 */
export function surfaceCallPhrase(name: string, count: number): string {
  if (count === 0)
    return `${name} was offered, 0 calls. This agent was bound to it and did not use it, which is a different finding from one it was not offered.`;
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
 * A caller that misses is expected to fall back to the wire identity, which is at least what the
 * call was actually recorded under: no rule turns one vocabulary into the other, so a lookup that
 * finds nothing must not guess.
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
      if (spellings.has(fn.operation)) continue;
      spellings.set(fn.operation, `${api.path}.${fn.name}`);
    }
  }
  return spellings;
}

/**
 * What one documentation-type setting did, said plainly — the hover behind every place the
 * setting is named.
 *
 * It lives beside the surface wording rather than in a component because two views show the
 * setting and they must say the same thing about it: an instance's chip in the explorer, and
 * the profile-level surface card a reader compares two arms of a within-run A/B on. The
 * setting is the *cause* whose effect that card's documentation figures are, and a card that
 * showed the cost without the arm would be showing an effect with nothing on it.
 *
 * `subject` is who the sentence is about, because the two callers are at different grains: one
 * instance, or every instance of a profile.
 *
 * The recorded id is the enabled flags joined with `+`, in gg's own fixed order, and `none`
 * when every flag is off — so the sentence is assembled a clause per flag rather than matched
 * against a closed list of arms. A flag from a newer gg than this console is named rather than
 * explained, because a wrong explanation of a real setting is worse than none.
 */
export function docViewTypesPhrase(
  types: string,
  subject: "instance" | "profile" = "instance",
): string {
  const CLAUSES: Readonly<Record<string, string>> = {
    return: "a function's return type",
    parameters: "the types its arguments declare",
    errors: "the failures its documentation declares it throws",
  };
  const flags = types
    .split("+")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
  const unknown = flags.filter((flag) => !(flag in CLAUSES));
  const known = flags
    .filter((flag) => flag in CLAUSES)
    .map((flag) => CLAUSES[flag] as string);
  const what =
    types.trim() === "none"
      ? "opened no type documentation beside a function it looked up"
      : unknown.length > 0
        ? `ran with the documentation types \`${types}\`, some of which this console does not know`
        : known.length > 0
          ? `opened, beside a function it looked up, the documentation of ${list(known)}`
          : "ran under a documentation-type setting this console does not know";
  const who =
    subject === "profile" ? "Every instance of this agent" : "This instance";
  const whose =
    subject === "profile"
      ? "these agents' own documentation band"
      : "this agent's own documentation band";
  return `${who} ${what}. It is a per-agent setting, so another agent of the same run may have had other types switched on; what it cost is ${whose}.`;
}

/** `a`, `a and b`, `a, b and c` — the clause list [docViewTypesPhrase] reads out. */
function list(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
