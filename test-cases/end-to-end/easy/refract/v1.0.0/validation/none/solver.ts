/**
 * solver.ts — a bounded solver for Refract boards, fixed in its search order.
 *
 * Given a Board, finds one beam per channel present such that every rule in
 * specs/beams.md holds: each beam is built move-by-move under the limits
 * R1..R5, ends complete per R6..R7, and every crystal ends satisfied per R8,
 * so the final position satisfies R9.
 *
 * Method: channel-by-channel backtracking. Channels are ordered
 * most-constrained-first (most lenses first). Each channel's beam is searched
 * as a path from one of its emitters to the other by depth-first extension,
 * with constraint propagation pruning at every step:
 *   - emitter degree exactly 1 (an emitter carries at most one segment and a
 *     complete beam meets each with exactly one),
 *   - lens degree exactly 2 of its own channel (capacity + coverage),
 *   - crystal capacity (a charge spent per entry; entry refused when spent),
 *   - segment exclusivity (R3) and diagonal exclusivity (R4) shared across
 *     all channels,
 *   - degree-feasibility: every unfinished lens must retain enough unused,
 *     capacity-compatible incident segments to reach degree 2, and the target
 *     emitter at least one,
 *   - connectivity: the target emitter and every unfinished lens must remain
 *     reachable from the live end over unused segments (a superset graph, so
 *     the prune is sound),
 *   - crystal exactness: once every channel that could possibly cross a
 *     crystal has been placed, that crystal's spent count must equal its
 *     charges (R8 requires all charges spent).
 *
 * The search is capped by an explicit node-expansion budget; iteration orders
 * are fixed (row-major), so the same board always gets the same answer.
 */

import type { Board, BoardNode, Channel } from "./notation";
import { CHANNELS } from "./notation";
import type { Beams } from "./rules";

export interface SolveOptions {
  /** Maximum number of candidate-segment expansions before giving up. */
  maxExpansions?: number;
}

export type SolveResult =
  | { status: "solved"; beams: Beams; expansions: number }
  | { status: "unsolvable"; expansions: number; reason?: string }
  | { status: "limit"; expansions: number };

export const DEFAULT_MAX_EXPANSIONS = 2_000_000;

const keyOf = (col: number, row: number): string => `${col},${row}`;

function segKey(a: BoardNode, b: BoardNode): string {
  const ka = keyOf(a.col, a.row);
  const kb = keyOf(b.col, b.row);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function blockKey(a: BoardNode, b: BoardNode): string | null {
  if (Math.abs(a.col - b.col) === 1 && Math.abs(a.row - b.row) === 1) {
    return keyOf(Math.min(a.col, b.col), Math.min(a.row, b.row));
  }
  return null;
}

export function solve(board: Board, opts: SolveOptions = {}): SolveResult {
  const cap = opts.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;

  // --- static structure -----------------------------------------------------
  const nodes = [...board.nodes].sort((a, b) => a.row - b.row || a.col - b.col);
  const byKey = new Map<string, BoardNode>();
  for (const n of nodes) byKey.set(keyOf(n.col, n.row), n);

  const present = CHANNELS.filter((ch) => nodes.some((n) => n.channel === ch));
  const crystals = nodes.filter((n) => n.kind === "crystal");

  const emittersByChannel = new Map<Channel, BoardNode[]>();
  const lensesByChannel = new Map<Channel, BoardNode[]>();
  for (const ch of present) {
    emittersByChannel.set(
      ch,
      nodes.filter((n) => n.kind === "emitter" && n.channel === ch),
    );
    lensesByChannel.set(
      ch,
      nodes.filter((n) => n.kind === "lens" && n.channel === ch),
    );
  }

  let expansions = 0;

  // A channel with anything other than exactly two emitters can never satisfy
  // R6, so the board is unsolvable as posed.
  for (const ch of present) {
    if ((emittersByChannel.get(ch) ?? []).length !== 2) {
      return {
        status: "unsolvable",
        expansions,
        reason: `channel ${ch} does not carry exactly two emitters`,
      };
    }
  }

  // Per-channel adjacency over the nodes that channel's beam may meet (its own
  // emitters and lenses, and any crystal — R2 excludes the rest). Neighbor
  // lists are row-major sorted, so the search order is fixed.
  const usableBy = (ch: Channel, n: BoardNode): boolean =>
    n.kind === "crystal" || n.channel === ch;
  const adjByChannel = new Map<Channel, Map<string, BoardNode[]>>();
  for (const ch of present) {
    const adj = new Map<string, BoardNode[]>();
    for (const n of nodes) {
      if (!usableBy(ch, n)) continue;
      const nbs = nodes.filter(
        (m) =>
          usableBy(ch, m) &&
          !(m.col === n.col && m.row === n.row) &&
          Math.abs(m.col - n.col) <= 1 &&
          Math.abs(m.row - n.row) <= 1,
      );
      adj.set(keyOf(n.col, n.row), nbs);
    }
    adjByChannel.set(ch, adj);
  }

  // Which channels could possibly cross each crystal: a crossing enters by one
  // segment and leaves by another, so it needs two distinct usable neighbors.
  const possibleChannels = new Map<string, Set<Channel>>();
  for (const c of crystals) {
    const set = new Set<Channel>();
    for (const ch of present) {
      const nbs = adjByChannel.get(ch)?.get(keyOf(c.col, c.row)) ?? [];
      if (nbs.length >= 2) set.add(ch);
    }
    possibleChannels.set(keyOf(c.col, c.row), set);
    if (set.size === 0) {
      return {
        status: "unsolvable",
        expansions,
        reason: `no channel can cross the crystal at (${c.col}, ${c.row}), so its charges can never all be spent`,
      };
    }
  }

  // Most-constrained-first: channels with more lenses first; CHANNELS order
  // breaks ties, so the order is fixed.
  const order = [...present].sort(
    (a, b) =>
      (lensesByChannel.get(b)?.length ?? 0) -
        (lensesByChannel.get(a)?.length ?? 0) ||
      CHANNELS.indexOf(a) - CHANNELS.indexOf(b),
  );

  // --- shared mutable search state -------------------------------------------
  const usedSeg = new Set<string>();
  const usedBlock = new Set<string>();
  const degree = new Map<string, number>();
  const crystalUsed = new Map<string, number>();
  const solution: Beams = {};
  let limitHit = false;

  const deg = (n: BoardNode): number => degree.get(keyOf(n.col, n.row)) ?? 0;
  const crysUsed = (n: BoardNode): number =>
    crystalUsed.get(keyOf(n.col, n.row)) ?? 0;

  /**
   * Can the beam ENTER node `n` right now (dfs move target)? Entering a
   * crystal spends a charge, so it needs one unspent.
   */
  const canEnter = (n: BoardNode): boolean => {
    if (n.kind === "emitter") return deg(n) === 0;
    if (n.kind === "lens") return deg(n) < 2;
    return crysUsed(n) < (n.charges ?? 0);
  };

  /**
   * Can node `n` carry one more segment in principle (feasibility partner
   * count)? A segment meeting a crystal may be a crossing's LEAVING segment,
   * which spends nothing, so the bound is the crystal's total segment budget:
   * n charges = at most n crossings = at most 2n segments.
   */
  const canCarryMore = (n: BoardNode): boolean => {
    if (n.kind === "emitter") return deg(n) === 0;
    if (n.kind === "lens") return deg(n) < 2;
    return deg(n) < 2 * (n.charges ?? 0);
  };

  const tryChannels = (index: number): boolean => {
    if (limitHit) return false;
    if (index === order.length) {
      // Every channel placed: R8 needs every crystal's charges all spent.
      return crystals.every((c) => crysUsed(c) === (c.charges ?? 0));
    }
    const ch = order[index];
    if (ch === undefined) return false;
    const emitters = emittersByChannel.get(ch) ?? [];
    const e1 = emitters[0];
    const e2 = emitters[1];
    if (e1 === undefined || e2 === undefined) return false;
    const e2key = keyOf(e2.col, e2.row);
    const lenses = lensesByChannel.get(ch) ?? [];
    const adj = adjByChannel.get(ch) ?? new Map<string, BoardNode[]>();
    let lensesRemaining = lenses.length;
    const path: BoardNode[] = [e1];

    /** Once channels order[0..index] are placed, crystals only they could cross must be exact. */
    const crystalsStillFeasible = (): boolean => {
      const placed = new Set(order.slice(0, index + 1));
      for (const c of crystals) {
        const used = crysUsed(c);
        const charges = c.charges ?? 0;
        const possible =
          possibleChannels.get(keyOf(c.col, c.row)) ?? new Set<Channel>();
        const remainingCanCross = [...possible].some((p) => !placed.has(p));
        if (!remainingCanCross && used !== charges) return false;
      }
      return true;
    };

    /** Degree-feasibility + connectivity pruning from the live end. */
    const feasible = (cur: BoardNode): boolean => {
      // Every unfinished lens must retain enough available incident segments,
      // and the target emitter at least one.
      const availableAt = (n: BoardNode): number => {
        let avail = 0;
        for (const nb of adj.get(keyOf(n.col, n.row)) ?? []) {
          if (usedSeg.has(segKey(n, nb))) continue;
          const bk = blockKey(n, nb);
          if (bk !== null && usedBlock.has(bk)) continue;
          if (!canCarryMore(nb)) continue;
          avail++;
        }
        return avail;
      };
      for (const lens of lenses) {
        const d = deg(lens);
        if (d >= 2) continue;
        // The live end itself will supply lens capacity by onward moves, which
        // availableAt already counts through the lens's own neighbors.
        if (availableAt(lens) < 2 - d) return false;
      }
      if (deg(e2) === 0 && availableAt(e2) < 1) return false;

      // Connectivity: over unused segments (ignoring blocks and capacity — a
      // superset of what is truly available, so pruning on it is sound), the
      // target emitter and every unfinished lens must be reachable from cur.
      const seen = new Set<string>([keyOf(cur.col, cur.row)]);
      const stack: BoardNode[] = [cur];
      while (stack.length > 0) {
        const n = stack.pop();
        if (n === undefined) break;
        for (const nb of adj.get(keyOf(n.col, n.row)) ?? []) {
          if (usedSeg.has(segKey(n, nb))) continue;
          const k = keyOf(nb.col, nb.row);
          if (seen.has(k)) continue;
          seen.add(k);
          stack.push(nb);
        }
      }
      if (!seen.has(e2key)) return false;
      for (const lens of lenses) {
        if (deg(lens) < 2 && !seen.has(keyOf(lens.col, lens.row))) return false;
      }
      return true;
    };

    const apply = (a: BoardNode, b: BoardNode): void => {
      usedSeg.add(segKey(a, b));
      const bk = blockKey(a, b);
      if (bk !== null) usedBlock.add(bk);
      for (const n of [a, b]) {
        const k = keyOf(n.col, n.row);
        const d = (degree.get(k) ?? 0) + 1;
        degree.set(k, d);
        if (n.kind === "lens" && n.channel === ch && d === 2) lensesRemaining--;
      }
      if (b.kind === "crystal") {
        const k = keyOf(b.col, b.row);
        crystalUsed.set(k, (crystalUsed.get(k) ?? 0) + 1);
      }
    };

    const undo = (a: BoardNode, b: BoardNode): void => {
      usedSeg.delete(segKey(a, b));
      const bk = blockKey(a, b);
      if (bk !== null) usedBlock.delete(bk);
      for (const n of [a, b]) {
        const k = keyOf(n.col, n.row);
        const d = (degree.get(k) ?? 0) - 1;
        degree.set(k, d);
        if (n.kind === "lens" && n.channel === ch && d === 1) lensesRemaining++;
      }
      if (b.kind === "crystal") {
        const k = keyOf(b.col, b.row);
        crystalUsed.set(k, (crystalUsed.get(k) ?? 0) - 1);
      }
    };

    const dfs = (cur: BoardNode): boolean => {
      for (const nb of adj.get(keyOf(cur.col, cur.row)) ?? []) {
        if (limitHit) return false;
        expansions++;
        if (expansions > cap) {
          limitHit = true;
          return false;
        }
        // The limits, incrementally: R3, R4, R5 (R1 and R2 are baked into the
        // adjacency lists).
        if (usedSeg.has(segKey(cur, nb))) continue; // R3
        const bk = blockKey(cur, nb);
        if (bk !== null && usedBlock.has(bk)) continue; // R4
        if (cur.kind === "emitter" && deg(cur) >= 1) continue; // R5 (leaving a used emitter)
        if (cur.kind === "lens" && deg(cur) >= 2) continue; // R5 (defensive)
        if (!canEnter(nb)) continue; // R5 (entering nb)

        if (keyOf(nb.col, nb.row) === e2key) {
          // Arriving at the far emitter ends the beam (its one segment is now
          // spent). Accept only a complete beam: every lens covered — counted
          // after applying, since the final segment may itself complete the
          // lens the beam is leaving.
          apply(cur, nb);
          path.push(nb);
          const routeOk = lensesRemaining === 0 && crystalsStillFeasible();
          if (routeOk) {
            solution[ch] = path.map((n) => ({ col: n.col, row: n.row }));
            if (tryChannels(index + 1)) return true;
            delete solution[ch];
          }
          path.pop();
          undo(cur, nb);
          continue;
        }

        apply(cur, nb);
        path.push(nb);
        if (feasible(nb)) {
          if (dfs(nb)) return true;
        }
        path.pop();
        undo(cur, nb);
      }
      return false;
    };

    // A channel with no lenses and directly adjacent emitters still runs
    // through dfs (the single segment e1->e2). A path exists from e1 to e2 iff
    // it exists reversed, and every constraint is symmetric, so one direction
    // suffices; starting from the row-major-first emitter keeps the order
    // fixed.
    if (!feasible(e1)) return false;
    return dfs(e1);
  };

  // No channels at all: solved only if there are no crystals either (nothing
  // can ever spend their charges).
  if (present.length === 0) {
    if (crystals.length === 0)
      return { status: "solved", beams: {}, expansions };
    return {
      status: "unsolvable",
      expansions,
      reason:
        "the board declares no channel, so no beam can ever spend the crystals’ charges",
    };
  }

  const found = tryChannels(0);
  if (limitHit) return { status: "limit", expansions };
  if (!found) return { status: "unsolvable", expansions };
  return { status: "solved", beams: { ...solution }, expansions };
}
