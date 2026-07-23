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
  /** For a belt, the position units an unobstructed item advances per tick — the
   * tier's `SPEED`, resolved by the engine. Absent for other entities. */
  speed?: number;
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
  | { splitter: { out_pref: number; in_first: number } }
  | {
      inserter: {
        // idle = empty at the pickup; swing = loaded, going out; return = empty,
        // swinging back after a drop (a real timed phase, not instant).
        phase: "idle" | "swing" | "return";
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
 * Every belt now runs the one uniform speed — 64 of 256 units per tick, a quarter
 * of a tile — so at a 32 px cell that is 8 px. The cap sits comfortably above that;
 * its job is to stop the matcher pairing items across a gap between two separate
 * belt runs that happen to share a lane line.
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
  /**
   * How far, in pixels, an unobstructed item on this belt advances in one tick —
   * the belt tier's `SPEED`, converted to pixels by the engine-supplied value.
   * The matcher uses it as the motion each item is *expected* to make, which is
   * what lets it tell a real item's step apart from a coincidental alignment.
   */
  step: number;
  /**
   * The same one-tick forward motion as `step`, but as a screen-space vector: the
   * belt's facing turned into a unit screen direction times `step`, so
   * `(stepX, stepY)` is where the item's centre would move in one tick if
   * unobstructed. `step` is the scalar magnitude of this. It exists so an item
   * that *leaves* the world at a sink (matched with no `to`) can glide forward
   * into the sink over the tween instead of freezing one belt step short of it
   * (see `tweenItems`).
   */
  stepX: number;
  stepY: number;
  /**
   * True if this item's belt drains directly into a sink (the tile one step downstream
   * in the belt's facing is a sink). Such a line always *flows* — a sink never blocks,
   * so its front item genuinely leaves every tick — which is why the matcher prefers
   * letting the front item leave (and glide into the sink) over pinning it to a
   * same-position slot and freezing the packed run behind it. Absent (falsy) for every
   * other belt, where the matcher keeps its count-first bias so a genuinely blocked
   * belt stays frozen rather than being animated as if it were flowing.
   */
  toSink?: boolean;
  /**
   * True if this item is on a belt fed directly by a splitter (the tile immediately
   * upstream of its belt is a splitter). A *just-appeared* such item is one emerging
   * from the splitter that tick; the renderer keeps it hidden during its first tween
   * (see `tweenItems`) so the same item is not drawn at the splitter's input edge and
   * its output entry at the same time — it "goes into" the splitter and reappears on
   * the far side.
   */
  fromSplitter?: boolean;
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
  // Tiles covered by any splitter, so an item on a belt fed directly by one can be
  // told apart (its upstream tile is in this set) and hidden while transiting. Sink
  // tiles are gathered the same way, so a belt draining into one can be told apart (its
  // downstream tile is in this set) and matched as a genuinely flowing line.
  const splitterTiles = new Set<string>();
  const sinkTiles = new Set<string>();
  for (const e of board.entities) {
    if (e.type === "splitter") for (const [tx, ty] of e.tiles) splitterTiles.add(`${tx},${ty}`);
    if (e.type === "sink") for (const [tx, ty] of e.tiles) sinkTiles.add(`${tx},${ty}`);
  }

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
    // The tile immediately upstream (behind the belt's input edge); if it is a
    // splitter, this belt is a splitter output and its just-appeared items are ones
    // emerging from the splitter.
    const fromSplitter = splitterTiles.has(`${entity.x - axis.fx},${entity.y - axis.fy}`);
    // The tile immediately downstream (one step in the belt's facing); if it is a sink,
    // this belt drains into it and its front item leaves the line each tick.
    const toSink = sinkTiles.has(`${entity.x + axis.fx},${entity.y + axis.fy}`);

    // `speed` is in the same fixed-point units as `pos`, so it scales to pixels by
    // the same tile factor. The facing's forward vector (`fx`,`fy` — the same one
    // that advances `x`/`y` and `along`) times that magnitude is the item's
    // per-tick motion in screen space.
    const step = ((entity.speed ?? 0) / TILE) * cell;
    const stepX = axis.fx * step;
    const stepY = axis.fy * step;

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
          step,
          stepX,
          stepY,
          toSink,
          fromSplitter,
        });
      }
    }
  });
  return out;
}

/**
 * Pair each item in `prev` with the same item's position in `next`.
 *
 * Within a lane line items keep their order and never pass each other, so the
 * pairing is an **order-preserving** matching: if `a[i]` pairs with `b[j]`, then
 * `a[i+1]` can only pair with some `b[j']` where `j' > j`. Items may enter the
 * line (a source emitting, an inserter dropping, a belt side-loading, or a run
 * appearing from an unrelated belt that shares the line key) and leave it (a sink
 * draining, an inserter lifting), so either side may hold unmatched items — and
 * crucially, an item can enter *anywhere* along the line, not just at its
 * upstream end.
 *
 * That last point is why this is a search rather than arithmetic. It used to be
 * modelled as ONE number — how many items entered at the upstream end — which is
 * wrong the moment anything is inserted mid-line. The wrong model would pair
 * every upstream item with its NEIGHBOUR's next-tick position, drawing each item
 * gliding one whole slot too far and then snapping back at the tick boundary
 * (a visible forward-then-back stutter), or, when the shifted pairing could not
 * be made to fit at all, freeze and double-draw the entire line for a tick.
 *
 * Ties are broken by how closely each pairing matches the motion the engine
 * would actually have produced — an item's own belt `step`. Total motion is NOT
 * a usable tie-break: when an item is inserted mid-run, "every item advances one
 * speed" and "one item barely moves and the rest sit still" explain the same
 * number of items, and the second has less total motion while being exactly the
 * artifact we are trying to remove.
 *
 * A pairing is only admissible if it moves forward (never backward) by no more
 * than `maxStep` and keeps the item's identity — which is what stops the matcher
 * pairing across the gap between two unrelated belt runs on the same line.
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
    // A line that drains into a sink always flows (a sink never blocks), so its front
    // item genuinely leaves every tick. Telling matchLine lets it prefer that over
    // freezing a packed run at the sink — while every other line keeps the count-first
    // bias that holds a genuinely blocked belt still.
    const sinkBound = a.some((p) => p.toSink) || b.some((p) => p.toSink);
    pairs.push(...matchLine(a, b, maxStep, sinkBound));
  }

  return pairs;
}

/**
 * The order-preserving matching for ONE lane line.
 *
 * A textbook alignment DP over the two sorted sequences. `cost[i][j]` is the least
 * total cost of aligning the first `i` items of `a` with the first `j` of `b`, and
 * each cell takes the cheapest of three moves: leave `a[i-1]` unmatched (it left the
 * line), leave `b[j-1]` unmatched (it entered), or pair them if admissible. A pairing
 * costs how far its motion strays from the belt's expected `step`; an unmatched item
 * costs a `skip` penalty.
 *
 * The `skip` penalty is what makes this both correct at a sink and safe everywhere
 * else, from the SAME code:
 *
 * - **On a sink-bound line** skipping is CHEAP — set below the cost of a frozen
 *   (zero-motion) pairing — so the packed run is seen shifting forward with its front
 *   item leaving into the sink, instead of every item pinned to a same-position slot
 *   and frozen. Correct because a belt draining into a sink always flows (the sink
 *   never blocks), so the front item really does leave each tick.
 * - **Everywhere else** skipping is effectively barred (a cost larger than any
 *   deviation sum), so the DP minimises skips first — i.e. maximises matches, then
 *   minimises deviation, exactly the old count-first rule. That keeps a genuinely
 *   blocked, stationary belt frozen (every item paired in place) rather than animated
 *   as if it were flowing, since the two snapshots are indistinguishable by position.
 *
 * Cost is `O(n * m)` per line, but `maxStep` keeps the admissible window a
 * couple of items wide, so in practice the pairing move is only ever evaluated
 * on a narrow band around the diagonal.
 */
function matchLine(
  a: ItemPoint[],
  b: ItemPoint[],
  maxStep: number,
  sinkBound: boolean,
): ItemPair[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((to) => ({ from: null, to }));
  if (m === 0) return a.map((from) => ({ from, to: null }));

  // Flattened (n+1) x (m+1) grids: the least total cost to reach the cell and which
  // move produced it. 0 = skip a[i-1], 1 = skip b[j-1], 2 = pair them.
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width);

  // Cost of leaving one item unmatched. On a sink-bound line, just under a frozen
  // pairing's cost (a frozen pair strays by a whole `step`), so the front item leaves
  // rather than freezing the run; a per-item value keeps it correct if belts ever
  // differ in speed. Off a sink, larger than any achievable deviation sum, so matches
  // are always preferred (count-first) and a blocked belt stays frozen.
  const barred = (n + m) * maxStep + 1;
  const skip = (p: ItemPoint) => (sinkBound ? 0.75 * p.step : barred);

  for (let i = 1; i <= n; i++) {
    cost[i * width] = cost[(i - 1) * width]! + skip(a[i - 1]!);
    move[i * width] = 0;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = cost[j - 1]! + skip(b[j - 1]!);
    move[j] = 1;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const here = i * width + j;
      const from = a[i - 1]!;
      const to = b[j - 1]!;

      // Default: skip a[i-1] (it left the line). Then skip b[j-1] (it entered) if
      // cheaper, then pair them if that is cheaper still.
      let bestCost = cost[(i - 1) * width + j]! + skip(from);
      let bestMove = 0;
      const skipBCost = cost[i * width + (j - 1)]! + skip(to);
      if (skipBCost < bestCost) {
        bestCost = skipBCost;
        bestMove = 1;
      }

      const delta = to.along - from.along;
      // Forward-only, bounded, and identity-preserving.
      if (delta >= -1e-6 && delta <= maxStep && from.item === to.item) {
        // How far this step strays from the motion the belt would have produced.
        const pairedCost = cost[(i - 1) * width + (j - 1)]! + Math.abs(delta - from.step);
        if (pairedCost < bestCost) {
          bestCost = pairedCost;
          bestMove = 2;
        }
      }

      cost[here] = bestCost;
      move[here] = bestMove;
    }
  }

  // Walk the moves back to recover the pairing, then restore upstream-first order.
  const out: ItemPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const mv = move[i * width + j]!;
      if (mv === 2) {
        out.push({ from: a[--i]!, to: b[--j]! });
        continue;
      }
      if (mv === 1) {
        out.push({ from: null, to: b[--j]! });
        continue;
      }
      out.push({ from: a[--i]!, to: null });
      continue;
    }
    if (i > 0) out.push({ from: a[--i]!, to: null });
    else out.push({ from: null, to: b[--j]! });
  }
  out.reverse();
  return out;
}

/**
 * Resolve matched items to their drawable positions `alpha` of the way from the
 * previous tick to the next (`alpha` in `0..1`).
 *
 * A matched item glides between its two positions. A one-sided item is at a lane's
 * end and the two ends are handled differently:
 *
 * - **`to`-only** (just entered — a source emitting, an inserter dropping, a
 *   side-load): it has no earlier position to glide *from*, so it holds where it is
 *   rather than sliding in from somewhere it never was.
 * - **`from`-only** (just left — consumed at a sink, or lifted off a belt by an
 *   inserter): `from` is its last belt position, one belt step short of what
 *   consumes it. It glides *forward* along its own travel vector (`stepX`/`stepY`)
 *   over the tween, so it slides on into the sink and vanishes at the next
 *   snapshot instead of freezing short and popping.
 *
 * The one exception is an item **emerging from a splitter** (a to-only item on a
 * splitter-fed belt): the splitter moves it across lane lines in a single tick, so
 * its input-side copy is a *different* from-only item this same tween. Drawing both
 * would show the item at the input edge and the output entry at once. Instead the
 * emerging copy is held back for this tween — the item "goes into" the splitter —
 * and appears on the far side next tick, when it is a matched item on the output
 * belt. The leaving (from-only) copy still shows going in, so exactly one is visible.
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
      // A just-emerged splitter item stays hidden "inside" the splitter this tween.
      if (to.fromSplitter) continue;
      out.push({ x: to.x, y: to.y, item: to.item });
    } else if (from) {
      // A from-only item is leaving the world this tween — consumed at a sink, or
      // (rarer) lifted off a belt by an inserter. `from` is its last *belt*
      // position, one belt step short of whatever consumes it, so holding it there
      // would freeze it and then pop it out of existence at the next snapshot — the
      // "hit". Glide it forward along its travel vector instead so it visibly
      // slides on into the sink and disappears as the next tick arrives.
      out.push({
        x: from.x + from.stepX * t,
        y: from.y + from.stepY * t,
        item: from.item,
      });
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
