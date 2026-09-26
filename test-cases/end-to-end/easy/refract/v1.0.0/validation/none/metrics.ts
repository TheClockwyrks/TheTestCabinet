/**
 * metrics.ts — the difficulty floor's five measures, recomputed independently.
 *
 * Derived from the specs alone: specs/modes/cascade.md "The difficulty floor"
 * defines the five measures over the rules in specs/beams.md, and this module
 * is that definition made executable against the oracle's own Board — no DOM,
 * no engine, no reference implementation. The measures are defined over a
 * board's SOLUTIONS (one complete beam per channel present satisfying R9, two
 * being the same when every channel carries the same segment set), so the
 * heart of the module is a bounded enumeration of them.
 *
 * TWO STOPS, REPORTED SEPARATELY, because they mean opposite things. The
 * ladder caps `solutions` from above, so a caller passes one past the bound it
 * is reading against and the enumeration stops there: `capped` is then a
 * MEASUREMENT — the board really does carry more solutions than its tier
 * permits, and `solutions` is the honest `bound + 1` that says so. The
 * expansion budget (`DIFFICULTY_MAX_EXPANSIONS`) is a runaway stop for a board
 * this search cannot crack, and `budget` is the ORACLE admitting it could not
 * measure: it is a fact about this module, never a verdict on the board, so a
 * caller must not read it as a failure. BOTH walks raise it — the solution
 * enumeration and the per-channel route count — because a route walk that runs
 * out of expansions can only do so before it has found the routes asked for,
 * so the count it returns is a floor and reading it as a measurement fails the
 * board for this module's own limit.
 *
 * Reading order — rows top to bottom, cells left to right within a row — is
 * the spec's tie-break, and it appears twice: the emitter a replayed beam is
 * drawn from, and the trail its segments are replayed along.
 */

import {
  CHANNELS,
  TIERS,
  type Board,
  type Channel,
  type TierSpec,
} from "./notation";

/** The five measures, read off one board. */
export interface Difficulty {
  /** Distinct solutions found, up to the enumeration's cap. */
  readonly solutions: number;
  /** Whether enumeration stopped at the solutions cap: the board is over it. */
  readonly capped: boolean;
  /** Whether the expansion budget stopped either walk: the board went UNMEASURED. */
  readonly budget: boolean;
  /** Segments of one solution (identical across solutions), 0 if none. */
  readonly segmentCount: number;
  /** Channel-and-segment pairs in every solution, as a share of segmentCount. */
  readonly determinedShare: number;
  /** Mean legal continuations per drawn segment over every solution's replay. */
  readonly branching: number;
  /** Max crystals crossed by 2+ channels within a single solution. */
  readonly sharedCrystals: number;
  /** Routes per channel present, in CHANNELS order, each counted to a cap. */
  readonly routes: readonly number[];
}

/** Expansion budget for one enumeration; a runaway stop, not a tuning knob. */
export const DIFFICULTY_MAX_EXPANSIONS = 4_000_000;

// ---- The board, indexed for search ---------------------------------------

interface Indexed {
  /** Nodes in reading order; all arrays below are parallel to this one. */
  readonly kind: readonly ("emitter" | "lens" | "crystal")[];
  readonly channel: readonly (Channel | null)[];
  readonly charges: readonly number[];
  readonly cols: readonly number[];
  readonly rows: readonly number[];
  readonly count: number;
  /** Segment endpoints, each a pair of node indices with a < b. */
  readonly segA: readonly number[];
  readonly segB: readonly number[];
  /** The 2x2 block a diagonal segment crosses, or -1; crossing pairs share one. */
  readonly segBlock: readonly number[];
  readonly blockCount: number;
  /** Per channel present: per node, [neighbor, segment, block] triples. */
  readonly adjacency: ReadonlyMap<Channel, readonly (readonly number[])[]>;
  readonly present: readonly Channel[];
  readonly emitters: ReadonlyMap<Channel, readonly [number, number]>;
  readonly lenses: ReadonlyMap<Channel, readonly number[]>;
  readonly crystals: readonly number[];
}

/** Index a board for the searches below, or null when a channel present does
 * not carry exactly two emitters (no solution exists to measure). */
function index(board: Board): Indexed | null {
  const nodes = [...board.nodes].sort((a, b) => a.row - b.row || a.col - b.col);
  const kind = nodes.map((n) => n.kind);
  const channel = nodes.map((n) => n.channel);
  const charges = nodes.map((n) => n.charges ?? 0);
  const cols = nodes.map((n) => n.col);
  const rows = nodes.map((n) => n.row);
  const count = nodes.length;

  const present = CHANNELS.filter((ch) => channel.includes(ch));
  const emitters = new Map<Channel, readonly [number, number]>();
  const lenses = new Map<Channel, readonly number[]>();
  for (const ch of present) {
    const es: number[] = [];
    const ls: number[] = [];
    for (let i = 0; i < count; i++) {
      if (channel[i] !== ch) continue;
      (kind[i] === "emitter" ? es : ls).push(i);
    }
    if (es.length !== 2) return null;
    emitters.set(ch, [es[0], es[1]]);
    lenses.set(ch, ls);
  }

  const segA: number[] = [];
  const segB: number[] = [];
  const segBlock: number[] = [];
  const blocks = new Map<string, number>();
  const segChannels: Channel[][] = [];
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      if (Math.abs(cols[a] - cols[b]) > 1 || Math.abs(rows[a] - rows[b]) > 1) {
        continue;
      }
      const usable = present.filter(
        (ch) =>
          (channel[a] === null || channel[a] === ch) &&
          (channel[b] === null || channel[b] === ch),
      );
      if (usable.length === 0) continue;
      segA.push(a);
      segB.push(b);
      segChannels.push(usable);
      if (cols[a] !== cols[b] && rows[a] !== rows[b]) {
        const key = `${Math.min(cols[a], cols[b])},${Math.min(rows[a], rows[b])}`;
        let block = blocks.get(key);
        if (block === undefined) {
          block = blocks.size;
          blocks.set(key, block);
        }
        segBlock.push(block);
      } else {
        segBlock.push(-1);
      }
    }
  }

  const adjacency = new Map<Channel, (readonly number[])[]>();
  for (const ch of present) {
    const lists: number[][] = Array.from({ length: count }, () => []);
    for (let s = 0; s < segA.length; s++) {
      if (!segChannels[s].includes(ch)) continue;
      lists[segA[s]].push(segB[s], s, segBlock[s]);
      lists[segB[s]].push(segA[s], s, segBlock[s]);
    }
    // Neighbors in reading order; node indices are already reading-ordered.
    const sorted = lists.map((flat) => {
      const triples: number[][] = [];
      for (let i = 0; i < flat.length; i += 3) {
        triples.push([flat[i], flat[i + 1], flat[i + 2]]);
      }
      triples.sort((x, y) => x[0] - y[0]);
      return triples.flat();
    });
    adjacency.set(ch, sorted);
  }

  const crystals: number[] = [];
  for (let i = 0; i < count; i++) {
    if (kind[i] === "crystal") crystals.push(i);
  }

  return {
    kind,
    channel,
    charges,
    cols,
    rows,
    count,
    segA,
    segB,
    segBlock,
    blockCount: blocks.size,
    adjacency,
    present,
    emitters,
    lenses,
    crystals,
  };
}

// ---- Solution enumeration -------------------------------------------------

interface Search {
  readonly ix: Indexed;
  readonly usedSeg: Uint8Array;
  readonly usedBlock: Int32Array;
  readonly degree: Int32Array;
  readonly spent: Int32Array;
  expansions: number;
  stopped: boolean;
  /** Set when the stop above was the expansion budget rather than a cap. */
  budget: boolean;
}

function searchOver(ix: Indexed): Search {
  return {
    ix,
    usedSeg: new Uint8Array(ix.segA.length),
    usedBlock: new Int32Array(Math.max(1, ix.blockCount)),
    degree: new Int32Array(ix.count),
    spent: new Int32Array(ix.count),
    expansions: 0,
    stopped: false,
    budget: false,
  };
}

/** Whether the beam may take the segment `cur -> nb` now (limits R1-R5). */
function mayTake(
  s: Search,
  cur: number,
  nb: number,
  seg: number,
  block: number,
): boolean {
  const { kind, charges } = s.ix;
  if (s.usedSeg[seg] !== 0) return false;
  if (block >= 0 && s.usedBlock[block] !== 0) return false;
  if (kind[cur] === "emitter" && s.degree[cur] >= 1) return false;
  const k = kind[nb];
  if (k === "emitter") return s.degree[nb] === 0;
  if (k === "lens") return s.degree[nb] < 2;
  return s.spent[nb] < charges[nb];
}

function take(
  s: Search,
  cur: number,
  nb: number,
  seg: number,
  block: number,
): void {
  s.usedSeg[seg] = 1;
  if (block >= 0) s.usedBlock[block] += 1;
  s.degree[cur] += 1;
  s.degree[nb] += 1;
  if (s.ix.kind[nb] === "crystal") s.spent[nb] += 1;
}

function untake(
  s: Search,
  cur: number,
  nb: number,
  seg: number,
  block: number,
): void {
  s.usedSeg[seg] = 0;
  if (block >= 0) s.usedBlock[block] -= 1;
  s.degree[cur] -= 1;
  s.degree[nb] -= 1;
  if (s.ix.kind[nb] === "crystal") s.spent[nb] -= 1;
}

/**
 * Sound pruning for the enumeration: from `cur`, the far emitter and every
 * unfinished lens must stay reachable over unused segments, and each must
 * retain enough unused, capacity-compatible incident segments to finish. The
 * reachability graph ignores blocks and capacity — a superset of what is
 * truly available — so nothing real is ever pruned.
 */
function feasible(s: Search, ch: Channel, cur: number, far: number): boolean {
  const { ix } = s;
  const adjacency = ix.adjacency.get(ch) ?? [];
  const lenses = ix.lenses.get(ch) ?? [];
  const carries = (i: number): boolean => {
    const k = ix.kind[i];
    if (k === "emitter") return s.degree[i] === 0;
    if (k === "lens") return s.degree[i] < 2;
    return s.degree[i] < 2 * ix.charges[i];
  };
  const available = (i: number, need: number): boolean => {
    const flat = adjacency[i];
    let found = 0;
    for (let t = 0; t < flat.length; t += 3) {
      if (s.usedSeg[flat[t + 1]] !== 0) continue;
      const block = flat[t + 2];
      if (block >= 0 && s.usedBlock[block] !== 0) continue;
      if (!carries(flat[t])) continue;
      found += 1;
      if (found >= need) return true;
    }
    return false;
  };
  for (const lens of lenses) {
    const need = 2 - s.degree[lens];
    if (need > 0 && !available(lens, need)) return false;
  }
  if (s.degree[far] === 0 && !available(far, 1)) return false;

  const seen = new Uint8Array(ix.count);
  seen[cur] = 1;
  const stack = [cur];
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const flat = adjacency[at];
    for (let t = 0; t < flat.length; t += 3) {
      const to = flat[t];
      if (seen[to] !== 0 || s.usedSeg[flat[t + 1]] !== 0) continue;
      seen[to] = 1;
      stack.push(to);
    }
  }
  if (s.degree[far] === 0 && seen[far] === 0) return false;
  for (const lens of lenses) {
    if (s.degree[lens] < 2 && seen[lens] === 0) return false;
  }
  return true;
}

/** A solution: per channel present (CHANNELS order), the set of its segments. */
type Solution = readonly (readonly number[])[];

/**
 * Every solution of the board, stopping at `maxSolutions` found or at the
 * expansion budget. The two stops are reported apart: `capped` says the walk
 * reached the solutions cap — a reading of the board — and `budget` says the
 * expansion budget ran out, which is this module's own limit and no reading at
 * all.
 */
function enumerateSolutions(
  ix: Indexed,
  maxSolutions: number,
): { solutions: Solution[]; capped: boolean; budget: boolean } {
  const s = searchOver(ix);
  const solutions: Solution[] = [];
  const chosen: number[][] = ix.present.map(() => []);

  const stage = (at: number): void => {
    if (s.stopped) return;
    if (at === ix.present.length) {
      for (const crystal of ix.crystals) {
        if (s.spent[crystal] !== ix.charges[crystal]) return;
      }
      solutions.push(chosen.map((segs) => [...segs].sort((a, b) => a - b)));
      if (solutions.length >= maxSolutions) s.stopped = true;
      return;
    }
    const ch = ix.present[at];
    const [from, far] = ix.emitters.get(ch) ?? [0, 0];
    const lenses = ix.lenses.get(ch) ?? [];
    const adjacency = ix.adjacency.get(ch) ?? [];
    const seen = new Set<string>();
    const segs = chosen[at];

    const walk = (cur: number): void => {
      if (s.stopped) return;
      const flat = adjacency[cur];
      for (let t = 0; t < flat.length; t += 3) {
        s.expansions += 1;
        if (s.expansions > DIFFICULTY_MAX_EXPANSIONS) {
          s.stopped = true;
          s.budget = true;
          return;
        }
        const nb = flat[t];
        const seg = flat[t + 1];
        const block = flat[t + 2];
        if (!mayTake(s, cur, nb, seg, block)) continue;
        take(s, cur, nb, seg, block);
        segs.push(seg);
        if (nb === far) {
          if (lenses.every((lens) => s.degree[lens] === 2)) {
            // The same segment set can be walked in more than one order
            // across a twice-crossed crystal; one board position, one count.
            const signature = [...segs].sort((a, b) => a - b).join(",");
            if (!seen.has(signature)) {
              seen.add(signature);
              stage(at + 1);
            }
          }
        } else if (feasible(s, ch, nb, far)) {
          walk(nb);
        }
        segs.pop();
        untake(s, cur, nb, seg, block);
        if (s.stopped) return;
      }
    };
    if (feasible(s, ch, from, far)) walk(from);
  };

  stage(0);
  return { solutions, capped: s.stopped && !s.budget, budget: s.budget };
}

// ---- The five measures ----------------------------------------------------

/**
 * The reading-order-first trail over one beam's segments from `from`: the
 * node sequence that visits every segment once and compares first, node by
 * node, among the trails that do.
 */
function firstTrail(
  ix: Indexed,
  segs: readonly number[],
  from: number,
): number[] {
  const incident = new Map<number, number[]>();
  for (const seg of segs) {
    const a = ix.segA[seg];
    const b = ix.segB[seg];
    for (const end of [a, b]) {
      const list = incident.get(end) ?? [];
      list.push(seg);
      incident.set(end, list);
    }
  }
  // Each node's incident segments by the reading order of their far end.
  for (const [node, list] of incident) {
    list.sort((x, y) => {
      const farOf = (seg: number): number =>
        ix.segA[seg] === node ? ix.segB[seg] : ix.segA[seg];
      return farOf(x) - farOf(y);
    });
  }
  const used = new Set<number>();
  const trail = [from];
  const extend = (cur: number): boolean => {
    if (used.size === segs.length) return true;
    for (const seg of incident.get(cur) ?? []) {
      if (used.has(seg)) continue;
      const next = ix.segA[seg] === cur ? ix.segB[seg] : ix.segA[seg];
      used.add(seg);
      trail.push(next);
      if (extend(next)) return true;
      used.delete(seg);
      trail.pop();
    }
    return false;
  };
  extend(from);
  return trail;
}

/** Mean legal continuations (R1-R5) per drawn segment over every replay. */
function branchingOver(ix: Indexed, solutions: readonly Solution[]): number {
  let total = 0;
  let steps = 0;
  const segOf = new Map<string, number>();
  for (let s = 0; s < ix.segA.length; s++) {
    segOf.set(`${ix.segA[s]},${ix.segB[s]}`, s);
  }
  for (const solution of solutions) {
    const s = searchOver(ix);
    for (let at = 0; at < ix.present.length; at++) {
      const ch = ix.present[at];
      const [from] = ix.emitters.get(ch) ?? [0];
      const adjacency = ix.adjacency.get(ch) ?? [];
      const trail = firstTrail(ix, solution[at], from);
      for (let step = 0; step + 1 < trail.length; step++) {
        const cur = trail[step];
        const next = trail[step + 1];
        const flat = adjacency[cur];
        let moves = 0;
        for (let t = 0; t < flat.length; t += 3) {
          if (mayTake(s, cur, flat[t], flat[t + 1], flat[t + 2])) moves += 1;
        }
        total += moves;
        steps += 1;
        const seg = segOf.get(
          cur < next ? `${cur},${next}` : `${next},${cur}`,
        ) as number;
        take(s, cur, next, seg, ix.segBlock[seg]);
      }
    }
  }
  return steps === 0 ? 0 : total / steps;
}

/** Channel-and-segment pairs present in every solution, as a share of L. */
function determinedOver(
  solutions: readonly Solution[],
  segmentCount: number,
): number {
  if (solutions.length === 0 || segmentCount === 0) return 0;
  const first = solutions[0];
  let determined = 0;
  for (let at = 0; at < first.length; at++) {
    for (const seg of first[at]) {
      if (solutions.every((solution) => solution[at].includes(seg))) {
        determined += 1;
      }
    }
  }
  return determined / segmentCount;
}

/** Max crystals crossed by beams of 2+ channels within a single solution. */
function sharedOver(ix: Indexed, solutions: readonly Solution[]): number {
  let best = 0;
  for (const solution of solutions) {
    const channelsAt = new Map<number, Set<number>>();
    for (let at = 0; at < solution.length; at++) {
      for (const seg of solution[at]) {
        for (const end of [ix.segA[seg], ix.segB[seg]]) {
          if (ix.kind[end] !== "crystal") continue;
          const set = channelsAt.get(end) ?? new Set<number>();
          set.add(at);
          channelsAt.set(end, set);
        }
      }
    }
    let shared = 0;
    for (const set of channelsAt.values()) {
      if (set.size >= 2) shared += 1;
    }
    best = Math.max(best, shared);
  }
  return best;
}

/**
 * Complete beams one channel admits with the other channels' beams undrawn
 * (their nodes still standing and excluded by R2, crystal capacity still
 * limiting crossings), counted up to `cap` distinct segment sets.
 *
 * The count comes back with the SAME two-stop distinction the enumeration
 * makes, because the two mean opposite things here too. Reaching `cap` is a
 * measurement: the caller asked for no more than `cap` routes and got them.
 * Exhausting `DIFFICULTY_MAX_EXPANSIONS` is this module admitting it could not
 * measure, and it can only happen BELOW the cap — the walk stops the moment
 * `cap` routes are seen — so the count it comes back with is a floor and not a
 * reading. Handing that floor to {@link meetsFloor} as if it were a reading
 * would fail the board for the oracle's own limit, so `budget` travels with it
 * and {@link measureDifficulty} folds it into `Difficulty.budget`.
 */
function routesFor(
  ix: Indexed,
  ch: Channel,
  cap: number,
): { count: number; budget: boolean } {
  const s = searchOver(ix);
  const [from, far] = ix.emitters.get(ch) ?? [0, 0];
  const lenses = ix.lenses.get(ch) ?? [];
  const adjacency = ix.adjacency.get(ch) ?? [];
  const seen = new Set<string>();
  const segs: number[] = [];
  const walk = (cur: number): void => {
    const flat = adjacency[cur];
    for (let t = 0; t < flat.length; t += 3) {
      s.expansions += 1;
      if (s.expansions > DIFFICULTY_MAX_EXPANSIONS) {
        s.stopped = true;
        s.budget = true;
        return;
      }
      const nb = flat[t];
      const seg = flat[t + 1];
      const block = flat[t + 2];
      if (!mayTake(s, cur, nb, seg, block)) continue;
      take(s, cur, nb, seg, block);
      segs.push(seg);
      if (nb === far) {
        if (lenses.every((lens) => s.degree[lens] === 2)) {
          seen.add([...segs].sort((a, b) => a - b).join(","));
          if (seen.size >= cap) s.stopped = true;
        }
      } else if (feasible(s, ch, nb, far)) {
        walk(nb);
      }
      segs.pop();
      untake(s, cur, nb, seg, block);
      if (s.stopped) return;
    }
  };
  walk(from);
  return { count: seen.size, budget: s.budget };
}

// ---- Reading the floor ----------------------------------------------------

/**
 * The five measures of one board. `maxSolutions` bounds the enumeration; pass
 * one past the largest `solutions` bound being read against, so an
 * over-the-cap board reports `capped` with the cap-full count — which
 * {@link meetsFloor}'s upper-bound test then rejects on the number itself,
 * needing no special case. A board the expansion budget abandoned instead
 * reports `budget`, and its measures were never read. `routeCap` bounds the
 * per-channel route count the same way; a walk that hit the expansion budget
 * instead of that cap raises `budget` too.
 */
export function measureDifficulty(
  board: Board,
  maxSolutions: number,
  routeCap = 100_000,
): Difficulty | null {
  const ix = index(board);
  if (ix === null) return null;
  const { solutions, capped, budget } = enumerateSolutions(ix, maxSolutions);
  if (solutions.length === 0) {
    return {
      solutions: 0,
      capped,
      budget,
      segmentCount: 0,
      determinedShare: 0,
      branching: 0,
      sharedCrystals: 0,
      routes: ix.present.map(() => 0),
    };
  }
  const segmentCount = solutions[0].reduce((sum, segs) => sum + segs.length, 0);
  const counted = ix.present.map((ch) => routesFor(ix, ch, routeCap));
  return {
    solutions: solutions.length,
    capped,
    // Either walk may have run out of expansions; either way the board went
    // unmeasured, and `routes` below is then a floor rather than a reading.
    budget: budget || counted.some((route) => route.budget),
    segmentCount,
    determinedShare: determinedOver(solutions, segmentCount),
    branching: branchingOver(ix, solutions),
    sharedCrystals: sharedOver(ix, solutions),
    routes: counted.map((route) => route.count),
  };
}

/**
 * Whether a measured board satisfies a tier's floor
 * (specs/modes/cascade.md "The floor, by tier"). Routes need counting only to
 * the floor's own bound, so a caller may cap them there.
 */
export function meetsFloor(measured: Difficulty, tier: TierSpec): boolean {
  if (measured.solutions < tier.solutions[0]) return false;
  if (measured.solutions > tier.solutions[1]) return false;
  if (measured.determinedShare > tier.maxDeterminedShare + 1e-9) return false;
  if (measured.branching < tier.minBranching - 1e-9) return false;
  if (measured.sharedCrystals < tier.minSharedCrystals) return false;
  return measured.routes.every((count) => count >= tier.minRoutes);
}

/**
 * The tier's floor, measured and judged in one call.
 *
 * `budget` alone withholds the verdict, because it is the oracle saying it
 * could not measure. A `capped` board needs no special case: `solutions` is
 * then `tier.solutions[1] + 1` and {@link meetsFloor}'s upper bound rejects it
 * on the honest count. Callers decide separately what an unmeasured board
 * means for them — it is not a build defect.
 */
export function measuresUpToTier(
  board: Board,
  tierNumber: number,
): {
  measured: Difficulty | null;
  ok: boolean;
} {
  const tier = TIERS[tierNumber - 1];
  const measured = measureDifficulty(
    board,
    tier.solutions[1] + 1,
    tier.minRoutes,
  );
  const ok =
    measured !== null && !measured.budget && meetsFloor(measured, tier);
  return { measured, ok };
}
