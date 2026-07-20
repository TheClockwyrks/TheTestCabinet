// Turning the engine's per-tick canonical state into smoothly moving pixels.
//
// This module is pure — no canvas, no wasm — so the part of playback that is
// genuinely subtle can be unit-tested. It holds NO simulation rules: every
// position it computes is read out of a state the engine produced, and the
// interpolation is presentation over those states.
//
// ## Why belt items need matching at all
//
// Playback must not draw one simulation tick per displayed frame. For most things
// that would merely stutter; for a belt it can look *stationary*. An item's
// position is fixed-point distance from its lane's output end, and every
// unobstructed item advances by the same speed each tick — so on a packed lane the
// item sitting at position `p` this tick is a DIFFERENT item from the one that sat
// at `p` last tick. Redrawing "whatever is at each slot" therefore shows a frozen
// belt whose only motion is at the two ends.
//
// The fix is to follow each item individually: place every item in world space,
// match it to its OWN next-tick position, and tween that. See
// `testing/performance/lattice/architecture.md` -> "Interpolated playback".
//
// ## Why world space, not per-tile
//
// A belt tile only knows about the items on it, and an item crossing a tile
// boundary leaves one tile's list and appears in the next. Placing items in world
// pixels makes that a non-event: a tile's output edge and its neighbour's input
// edge are the same world point, so an item handing off between tiles is an
// ordinary small forward step and matches like any other. Grouping by *lane line*
// rather than by tile is what buys that.

/** The four facings a scenario can place an entity with. */
export type Dir = "N" | "E" | "S" | "W";

/** One placed entity from the static board, with its resolved footprint. */
export interface BoardEntity {
  type: "belt" | "splitter" | "inserter" | "assembler" | "source" | "sink";
  x: number;
  y: number;
  dir?: Dir;
  tier?: string;
  recipe?: string;
  item?: string;
  lane?: string;
  period?: number;
  /** Every tile this entity covers, resolved by the engine. */
  tiles: [number, number][];
  /** For an inserter, the ticks its arm is held between pickup and drop — the
   * total its state's `swing_left` counts down from. Absent for other entities. */
  swing?: number;
}

/** The static layout the engine reports once, before any tick. */
export interface Board {
  version: number;
  grid: { width: number; height: number };
  ticks: number;
  snapshots: number[];
  entities: BoardEntity[];
}

/** One item riding a lane: `pos` is fixed-point distance from the output end. */
export interface BeltItem {
  pos: number;
  item: string;
}

/** Per-entity canonical state, externally tagged, parallel to `Board.entities`. */
export type EntityState =
  | { belt: { left: BeltItem[]; right: BeltItem[] } }
  | { splitter: { rr_in: number; rr_out: number } }
  | {
      inserter: {
        phase: "idle" | "swing";
        held: string | null;
        swing_left: number;
      };
    }
  | {
      assembler: {
        inputs: Record<string, number>;
        output: Record<string, number>;
        craft_left: number;
      };
    }
  | { source: { emit_phase: number } }
  | { sink: { consumed: Record<string, number> } };

/** One reconstructed tick. */
export interface Snapshot {
  tick: number;
  checksum: string;
  entities: EntityState[];
}

/**
 * Fixed-point units per tile — the scale `BeltItem.pos` is expressed in. A
 * position lives in `0..TILE`, measured from the lane's output end, and moving
 * forward *decreases* it.
 */
export const TILE = 256;

/**
 * The largest forward step, in pixels, that can be one item's motion in one tick.
 * The quickest belt advances 128 of 256 units per tick — half a tile — so at a
 * 32 px cell that is 16 px. The cap is what stops the matcher pairing items across
 * a gap between two separate belt runs that happen to share a lane line.
 */
export const MAX_STEP_PX = 24;

/** An item placed in world space, ready to be matched and drawn. */
export interface ItemPoint {
  /** Items are only ever matched against others on the same lane line. */
  line: string;
  /** Distance along the line in pixels, increasing in the direction of travel. */
  along: number;
  /** Screen position of the item's centre, in pixels. */
  x: number;
  y: number;
  /** The engine's item id. */
  item: string;
}

/** A matched item across two ticks. A null side means it entered or left. */
export interface ItemPair {
  from: ItemPoint | null;
  to: ItemPoint | null;
}

/** An item resolved to a drawable position at some point between two ticks. */
export interface DrawItem {
  x: number;
  y: number;
  item: string;
}

// The geometry of one facing: which way travel runs, and which way "left of
// travel" points. Both are unit vectors in screen space (y grows downward).
const AXES: Record<Dir, { fx: number; fy: number; lx: number; ly: number }> = {
  E: { fx: 1, fy: 0, lx: 0, ly: -1 },
  W: { fx: -1, fy: 0, lx: 0, ly: 1 },
  S: { fx: 0, fy: 1, lx: 1, ly: 0 },
  N: { fx: 0, fy: -1, lx: -1, ly: 0 },
};

/**
 * Place every belt item in the snapshot into world pixels.
 *
 * A lane's items are read straight from the state; the only arithmetic here is
 * converting a fixed-point offset into a pixel offset and picking the lane's
 * lateral side. Entities that carry no belt items contribute nothing.
 */
export function placeItems(
  board: Board,
  snapshot: Snapshot,
  cell: number,
): ItemPoint[] {
  const out: ItemPoint[] = [];
  board.entities.forEach((entity, index) => {
    const state = snapshot.entities[index];
    if (!state || !("belt" in state) || entity.type !== "belt") return;
    const dir = entity.dir ?? "E";
    const axis = AXES[dir];
    // Two belts on the same row but facing opposite ways are different lines, so
    // the facing is part of the key. The perpendicular coordinate pins the row (or
    // column) the line runs along.
    const perp = axis.fx !== 0 ? entity.y : entity.x;

    for (const side of ["left", "right"] as const) {
      // Lanes sit a quarter-cell either side of the tile's centre line. This is a
      // signed distance ALONG the axis's "left of travel" vector, so the sign
      // belongs here only once — the vector supplies the direction.
      const lateral = (side === "left" ? 1 : -1) * (cell / 4);
      const key = `${dir}|${perp}|${side}`;
      for (const it of state.belt[side]) {
        // `pos` counts back from the output edge, so the travelled fraction of the
        // tile is its complement.
        const travelled = (1 - it.pos / TILE) * cell;
        // The tile's upstream edge, from which the item has travelled.
        const originX = entity.x * cell + (axis.fx < 0 ? cell : 0);
        const originY = entity.y * cell + (axis.fy < 0 ? cell : 0);
        const x =
          originX + axis.fx * travelled + axis.lx * lateral + (axis.fx === 0 ? cell / 2 : 0);
        const y =
          originY + axis.fy * travelled + axis.ly * lateral + (axis.fy === 0 ? cell / 2 : 0);
        out.push({
          line: key,
          along: axis.fx !== 0 ? axis.fx * x : axis.fy * y,
          x,
          y,
          item: it.item,
        });
      }
    }
  });
  return out;
}

/**
 * Pair each item in `prev` with the same item's position in `next`.
 *
 * Within a lane line items keep their order and never pass each other, so an
 * alignment is fully described by ONE number: how many items entered at the
 * upstream end since the previous tick. Items leave from the downstream end, so
 * the rest follow. We try each possible entry count and keep the alignment that
 * explains the most items, breaking ties by the smallest total motion.
 *
 * A candidate is only valid if every pairing moves forward (never backward) by no
 * more than `maxStep`, and keeps the item's identity — which is what prevents
 * pairing across a gap between two unrelated belt runs on the same line.
 */
export function matchItems(
  prev: ItemPoint[],
  next: ItemPoint[],
  maxStep: number = MAX_STEP_PX,
): ItemPair[] {
  const lines = new Set([...prev.map((p) => p.line), ...next.map((p) => p.line)]);
  const pairs: ItemPair[] = [];

  for (const line of lines) {
    // Ascending `along` = upstream first, so index 0 is the item furthest back.
    const a = prev.filter((p) => p.line === line).sort((p, q) => p.along - q.along);
    const b = next.filter((p) => p.line === line).sort((p, q) => p.along - q.along);

    let bestEntered: number | null = null;
    let bestCount = -1;
    let bestMotion = Infinity;

    for (let entered = 0; entered <= b.length; entered++) {
      const count = Math.min(a.length, b.length - entered);
      if (count < 0) continue;
      let motion = 0;
      let valid = true;
      for (let i = 0; i < count; i++) {
        const from = a[i]!;
        const to = b[i + entered]!;
        const step = to.along - from.along;
        if (step < -1e-6 || step > maxStep || from.item !== to.item) {
          valid = false;
          break;
        }
        motion += step;
      }
      if (!valid) continue;
      if (count > bestCount || (count === bestCount && motion < bestMotion)) {
        bestCount = count;
        bestMotion = motion;
        bestEntered = entered;
      }
    }

    if (bestEntered === null) {
      // No alignment explains this line (a teleport, or a lane replaced wholesale).
      // Better to snap than to invent motion, so everything reads as its own end.
      for (const p of a) pairs.push({ from: p, to: null });
      for (const p of b) pairs.push({ from: null, to: p });
      continue;
    }

    const matched = Math.min(a.length, b.length - bestEntered);
    for (let i = 0; i < bestEntered; i++) pairs.push({ from: null, to: b[i]! });
    for (let i = 0; i < matched; i++) {
      pairs.push({ from: a[i]!, to: b[i + bestEntered]! });
    }
    // Anything left over on either side entered or left at the far end.
    for (let i = matched; i < a.length; i++) pairs.push({ from: a[i]!, to: null });
    for (let i = matched + bestEntered; i < b.length; i++) {
      pairs.push({ from: null, to: b[i]! });
    }
  }

  return pairs;
}

/**
 * Resolve matched items to their drawable positions `alpha` of the way from the
 * previous tick to the next (`alpha` in `0..1`).
 *
 * A matched item glides. An item with only one side is at a lane's end — newly
 * placed by a source, inserter, or side-load, or just consumed — and there is no
 * second position to glide to, so it holds the position it does have rather than
 * sliding in from somewhere it never was.
 */
export function tweenItems(pairs: ItemPair[], alpha: number): DrawItem[] {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const out: DrawItem[] = [];
  for (const { from, to } of pairs) {
    if (from && to) {
      out.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        item: to.item,
      });
    } else if (to) {
      out.push({ x: to.x, y: to.y, item: to.item });
    } else if (from) {
      out.push({ x: from.x, y: from.y, item: from.item });
    }
  }
  return out;
}

/**
 * The atlas frame index for an engine item id, or `-1` if the atlas does not
 * carry it. The item sheet is packed in the engine's canonical item order, so this
 * is a plain lookup — but going through `ids` keeps a reordered sheet from
 * silently drawing the wrong icon.
 */
export function itemFrame(ids: readonly string[], id: string): number {
  return ids.indexOf(id);
}
