// What became of one thing an agent was OFFERED, in words — the sentence both surface views
// hover with.
//
// gg records every model-facing call under its own identity: a tool call under the tool, and a
// responses-as-code program's call under the API function the model wrote (`view.open_file`,
// `context.list`), whether or not a gg tool runs underneath it. So a count is per entry, full
// stop, and this file has no arithmetic left in it — only the wording.
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

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * How often an offered entry was called, said plainly.
 *
 * The zero says the same thing the cell does, in the same vocabulary: the cell reads `0×`
 * because a zero here is a measurement of the same kind as a three, and a sentence that
 * called it *never called* would have put the finding in one register on the row and
 * another on hover — the wording the figures replaced, surviving in the tooltip. What the
 * tooltip adds is the contrast the muting cannot state on its own: a zero is a fact about
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
