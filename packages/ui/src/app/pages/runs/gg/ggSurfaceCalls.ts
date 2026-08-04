// Joining a thing an agent was OFFERED to how often it was actually called.
//
// gg records a call under the **tool** behind it and at no finer grain. That is invisible for
// a tool-calling agent, where every offered thing is its own tool, and load-bearing for a
// responses-as-code one, where several functions a program may write share one gate: `read_file`
// backs `fs.readFile`, `fs.readTextFile` *and* `view.openFile`, and all three arrive on the
// stream as a `read_file` call with nothing distinguishing which of them the program wrote.
//
// So a per-function figure read straight off that join is a claim the telemetry cannot support.
// An agent that only ever opened files would be reported as having called `fs.readFile` too,
// and — worse for the surface views, whose entire job is the offered-versus-called contrast —
// two functions it genuinely ignored would never dim. That is a false positive in exactly the
// direction the feature exists to rule out.
//
// The fix is attribution, not arithmetic. Where one gate backs several of the entries an agent
// was offered, the count belongs to the **gate** and is shown as the gate's, named, alongside
// the functions sharing it. Nothing is invented and nothing is hidden: the reader is told the
// figure covers the group, which is precisely what was measured.
//
// Zero needs no such care and keeps its per-entry reading exactly. Nothing recorded under the
// gate means none of the functions behind it ran, so "offered and never called" stays true of
// each of them individually — which is why the never-called half of the contrast, the half an
// ablation is read for, is unaffected by any of this.

const numberFmt = new Intl.NumberFormat("en-US");

/** An offered thing, as either surface view names it, reduced to what the join needs. */
export interface SurfaceGateEntry {
  /**
   * The name the entry reads by, qualified where the view qualifies it (`fs.readFile`). Bare
   * function names are ambiguous across objects — every object binds a `list` — so a caller
   * that shows shared attribution must name entries the way it displays them.
   */
  name: string;
  /** The gg tool its calls are recorded under; null where no tool backs it at all. */
  tool: string | null;
}

/** What an offered entry's call count is, and whose count it actually is. */
export interface SurfaceCallCount {
  /**
   * Calls recorded under the entry's gate, or null where nothing counts it — a view call, an
   * ending call, a program-library call. Null is not zero: zero accuses the agent of ignoring
   * something, and null says there was never a figure to have.
   */
  count: number | null;
  /**
   * The gate that OWNS this count, set only where it backs more than one offered entry and the
   * figure therefore cannot be attributed to this entry alone. Null in the ordinary case, where
   * the entry is the only thing behind its gate and the count is its own.
   */
  sharedGate: string | null;
  /** Every offered entry that gate backs, this one included. Empty unless {@link sharedGate}. */
  sharedWith: readonly string[];
}

/**
 * The gates that back more than one of the entries offered here, each mapped to every entry it
 * backs, in offer order.
 *
 * Computed over a whole surface rather than per object: `fs.readFile` and `view.openFile` sit on
 * different objects and share a gate, so an object-at-a-time pass would find no sharing at all
 * and report both counts as each function's own.
 */
export function sharedSurfaceGates(
  entries: Iterable<SurfaceGateEntry>,
): Map<string, string[]> {
  const byGate = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.tool == null) continue;
    const at = byGate.get(entry.tool);
    if (at) at.push(entry.name);
    else byGate.set(entry.tool, [entry.name]);
  }
  for (const [gate, names] of byGate) if (names.length < 2) byGate.delete(gate);
  return byGate;
}

/** How often an offered entry was called, and whether that figure is the entry's own. */
export function surfaceCallCount(
  entry: SurfaceGateEntry,
  calls: ReadonlyMap<string, number>,
  shared: ReadonlyMap<string, readonly string[]>,
): SurfaceCallCount {
  if (entry.tool == null)
    return { count: null, sharedGate: null, sharedWith: [] };
  const count = calls.get(entry.tool) ?? 0;
  const sharing = shared.get(entry.tool);
  // A shared gate with nothing under it is not shared as far as a reader is concerned: none of
  // the entries behind it ran, which is a true statement about each one on its own.
  if (!sharing || count === 0)
    return { count, sharedGate: null, sharedWith: [] };
  return { count, sharedGate: entry.tool, sharedWith: sharing };
}

/**
 * What became of one offered entry, in words — the sentence both surface views hover with.
 *
 * The shared case is spelled out rather than softened: the reader is told the figure is the
 * tool's, which functions it covers, and that gg does not record which of them the program
 * wrote. Anything vaguer would leave the count reading as this function's.
 */
export function surfaceCallPhrase(
  name: string,
  calls: SurfaceCallCount,
): string {
  if (calls.count == null)
    return `${name} is bound, but nothing behind it is recorded as a tool call, so it has no count.`;
  if (calls.count === 0) return `${name} was offered and never called.`;
  const times = `${numberFmt.format(calls.count)} time${calls.count === 1 ? "" : "s"}`;
  if (calls.sharedGate == null) return `${name} was called ${times}.`;
  return `${calls.sharedGate} — the tool behind ${calls.sharedWith.join(", ")} — was called ${times}. gg records a call under the tool, not the function, so this figure covers all of them and which of them was written is not recorded.`;
}
