// foes/harness — the arrangements the `foes` group's checks share.
//
// Only this group poses these, so they live beside the checks that use them
// rather than in the shared harness next door. Like everything there, they fix
// ARRANGEMENT alone — which tile a foe stands on, which faculty is held, when a
// spawner's clock runs out — and never a threshold: every distance, interval
// and count a check asserts is stated in that check, derived from the figure
// specs/foes.md fixes for it.

import {
  chargeAt,
  poseFoe,
  TICK_HZ,
  type FoeKind,
  type FoeSnapshot,
  type Harness,
  type UntilResult,
  type WirewormSnapshot,
} from "../harness";

/**
 * A foe of `kind` standing on tile `(c, r)` with its locomotion held, and its id.
 *
 * specs/foes.md fixes a foe's effect on the field as an OCCUPANCY of the tile
 * its center is on rather than an event of crossing one, so a foe posed with
 * `setFoeTravel(id, false)` acts on exactly one known tile with no motion in the
 * scenario at all. Its mind is left on, because the acting is what these checks
 * are about; a check that wants the foe wholly inert holds `setFoeMind` off
 * itself and says why.
 */
export function poseStillFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
): number {
  const id = poseFoe(h, kind, c, r);
  h.debug.setFoeTravel(id, false);
  return id;
}

/** Every foe of `kind` on the board, in roster order. */
export function foesOfKind(
  snapshot: WirewormSnapshot,
  kind: FoeKind,
): FoeSnapshot[] {
  return snapshot.foes.filter((foe) => foe.kind === kind);
}

/**
 * The seconds a spawner clock is posed at so that it runs out inside the next
 * update: half of one update's delta.
 *
 * specs/foes.md brings a foe in, or runs the dropper's sparse-field check, when
 * its kind's clock reaches `0` — "When a clock reaches `0` its kind's entry or
 * check happens and the clock is drawn again" — and `setSpawnTimer` poses the
 * seconds left on that clock (specs/instrumentation.md). A clock posed at half
 * a delta reaches `0` inside the very next update, so the entry it decides is
 * the next thing that happens, and nothing waits on the interval the clock is
 * then redrawn to.
 */
export const DUE_SECONDS = 0.5 / TICK_HZ;

/**
 * The updates run once a clock is posed due: the one it runs out in, and one
 * more for a build that acts on the update after its clock crosses `0` rather
 * than inside the one it crosses in.
 */
export const EXPIRY_FRAMES = 2;

/**
 * Pose the level's clock for `kind` to run out inside the next update, run the
 * updates that expiry lands in, and report the most foes of `kind` the roster
 * held over them.
 *
 * This is the reading every check about a spawner's level gate or its cap
 * takes. The moment the spawner would bring a foe in is POSED rather than waited
 * for, so a check costs two updates instead of the interval the clock is drawn
 * to, and its cost does not follow the build's pacing. The roster is read after
 * each update, so a foe that entered and was removed inside the stretch still
 * counts toward the peak, and the foes standing before the first update count
 * too, so a cap that is already binding is read at the cap.
 */
export async function expireClock(h: Harness, kind: FoeKind): Promise<number> {
  h.debug.setSpawnTimer(kind, DUE_SECONDS);
  let peak = foesOfKind(h.snapshot(), kind).length;
  for (let frame = 0; frame < EXPIRY_FRAMES; frame += 1) {
    await h.advance(1);
    peak = Math.max(peak, foesOfKind(h.snapshot(), kind).length);
  }
  return peak;
}

/**
 * Advance up to `frames` frames, stopping at the first sample that finds a foe
 * of `kind` on the board.
 *
 * The sweep stops where it finds one, so the frame on the canvas afterwards is
 * the board the arrival happened on — which is what the review item's still
 * shows.
 */
export function untilFoeOfKind(
  h: Harness,
  kind: FoeKind,
  frames: number,
  poll: number,
): Promise<UntilResult> {
  return h.until((snapshot) => foesOfKind(snapshot, kind).length > 0, {
    maxFrames: frames,
    poll,
  });
}

/** What the first change to one tile of the field turned out to be. */
export interface TileChange {
  /** Whether the tile ever changed inside the frames allowed. */
  changed: boolean;
  /** The frame it changed on, or the whole sweep where it never did. */
  frame: number;
  /** The charge standing on it at the call, `null` for an empty tile. */
  was: number | null;
  /** The charge standing on it at that frame, `null` for an empty tile. */
  now: number | null;
  /** The board as it stood at that frame. */
  snapshot: WirewormSnapshot;
}

/**
 * Advance up to `frames` frames one at a time, stopping at the FIRST frame on
 * which tile `(c, r)` holds something other than what it held at the call.
 *
 * This is how every check about a foe's effect on the field reads its result,
 * and it is deliberately the first change rather than the state at the end of a
 * window. specs/foes.md fixes a foe's effect as an occupancy — a foe standing
 * on a tile acts on it — so a build acts on the tile again on every update it
 * stands there, and a window of any width would grade the tile after several
 * such actions. A charge raised by one on each of three updates ends at
 * CHARGE_MAX just as a slam does; the change the FIRST one made is what tells
 * the two apart. Allowing several frames costs nothing in exchange: a build
 * that acts on its first update and one that acts a few frames in are both
 * graded on WHAT its action did rather than on when it made it.
 */
export async function untilTileChanges(
  h: Harness,
  c: number,
  r: number,
  frames: number,
): Promise<TileChange> {
  const was = chargeAt(h.snapshot(), c, r);
  for (let frame = 1; frame <= frames; frame += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    const now = chargeAt(snapshot, c, r);
    if (now !== was) return { changed: true, frame, was, now, snapshot };
  }
  const snapshot = h.snapshot();
  return { changed: false, frame: frames, was, now: was, snapshot };
}

/**
 * Take the foe off the board and run one frame, so the still captured next
 * shows the FIELD the review item names rather than a foe sprite standing over
 * it.
 *
 * A foe is drawn on the tile it occupies, which is the same tile as the node it
 * just acted on, so a still taken with it still standing there shows the sprite
 * and not the outcome. This is called only AFTER the reading that decides the
 * point has been taken, and it changes nothing that reading rests on: charge
 * "does not change on its own" (specs/nodes.md), and the board these checks pose
 * holds nothing else.
 */
export async function clearForStill(h: Harness, id: number): Promise<void> {
  h.debug.removeFoe(id);
  await h.advance(1);
}
