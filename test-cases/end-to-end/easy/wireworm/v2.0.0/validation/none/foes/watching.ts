// foes/watching — the two readings every point in this group takes, and the
// sweeps that take them. CASE-PROVIDED.
//
// A foe changes exactly two things a check can read: one TILE of the node field,
// and the foe ROSTER. `specs/foes.md` fixes the first as an OCCUPANCY — "A foe
// acts on the tile its center occupies, and only on that tile" — and the second
// as what a level's own spawning adds to, and what a bolt takes away from.
//
// Both live here rather than in the shared harness next door because only this
// group takes them, and, like everything there, both fix ARRANGEMENT alone:
// which tile is watched, when a spawner's clock runs out, how often a sweep
// samples. Not one span, poll or count below is decided in this file — every
// one of them is the caller's, stated in the check beside the figure
// `specs/foes.md` fixes it from.

import {
  chargeAt,
  foesOfKind,
  framesFor,
  TICK_HZ,
  type FoeKind,
  type Harness,
  type UntilResult,
  type WirewormSnapshot,
} from "../harness";

/** What the first change to one tile of the field turned out to be. */
export interface TileChange {
  /** Whether the tile ever changed inside the frames allowed. */
  changed: boolean;
  /** The frame it changed on, or the whole sweep where it never did. */
  frames: number;
  /** The charge standing on it at the call, `null` for an empty tile. */
  was: number | null;
  /** The charge standing on it at that frame, `null` for an empty tile. */
  now: number | null;
  /** The board as it stood at that frame. */
  snapshot: WirewormSnapshot;
}

/**
 * Run up to `frames` frames one at a time, stopping at the FIRST frame on which
 * tile `(c, r)` holds something other than what it held at the call.
 *
 * THE FIRST CHANGE, RATHER THAN THE TILE AT THE END OF A WINDOW, IS THE READING
 * EVERY POINT ABOUT A FOE'S EFFECT ON THE FIELD TAKES. `specs/foes.md` fixes
 * that effect as an occupancy — a foe standing on a tile acts on that tile — so
 * a build acts again on every update the foe stands there, and a window of any
 * width grades the tile after several such acts. A charge raised by one on each
 * of three updates ends at `CHARGE_MAX` exactly as a slam does; the change the
 * FIRST act made is what tells those two builds apart, and so what lets a
 * failure name which model a build wrote.
 *
 * Allowing several frames costs nothing in exchange. `specs/foes.md` fixes no
 * cadence for a foe's effect, so a build that acts on its first update and one
 * that acts a few frames in are both graded on WHAT the act did rather than on
 * when it was made; the width of the sweep decides only how long a build that
 * never acts at all is waited for.
 */
export async function untilTileChanges(
  h: Harness,
  c: number,
  r: number,
  frames: number,
): Promise<TileChange> {
  const was = chargeAt(await h.snapshot(), c, r);
  const swept = await h.until((snapshot) => chargeAt(snapshot, c, r) !== was, {
    maxFrames: frames,
    poll: 1,
  });
  return {
    changed: swept.hit,
    frames: swept.frames,
    was,
    now: chargeAt(swept.snapshot, c, r),
    snapshot: swept.snapshot,
  };
}

/**
 * The seconds a spawner clock is posed at so that it runs out inside the next
 * update: half of one update's delta.
 *
 * `specs/foes.md` brings a foe in, or runs the dropper's sparse-field check,
 * when its kind's clock reaches `0` — "When a clock reaches `0` its kind's
 * entry or check happens and the clock is drawn again" — and `setSpawnTimer`
 * poses the seconds left on that clock (`specs/instrumentation.md`). A clock
 * posed at half a delta reaches `0` inside the very next update, so the entry
 * it decides is the next thing that happens, and nothing waits on the interval
 * the clock is then redrawn to.
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
 * THIS IS THE READING EVERY POINT ABOUT A SPAWNER'S LEVEL GATE OR ITS CAP
 * TAKES. The moment the spawner would bring a foe in is POSED rather than
 * waited for, so a point costs two updates instead of the interval the clock is
 * drawn to, and its cost does not follow the build's pacing. The roster is read
 * after each update, so a foe that entered and was removed inside the stretch
 * still counts toward the peak, and the foes standing before the first update
 * count too, so a cap that is already binding is read at the cap.
 */
export async function expireClock(h: Harness, kind: FoeKind): Promise<number> {
  await h.debug.setSpawnTimer(kind, DUE_SECONDS);
  let peak = foesOfKind(await h.snapshot(), kind).length;
  for (let frame = 0; frame < EXPIRY_FRAMES; frame += 1) {
    await h.advance(1);
    peak = Math.max(peak, foesOfKind(await h.snapshot(), kind).length);
  }
  return peak;
}

/**
 * Run up to `maxSeconds` of play, stopping at the first sample that finds a foe
 * of `kind` on the board.
 *
 * The sweep stops where it finds one, so the picture on the canvas afterwards is
 * the board the arrival happened on — which is what these points' stills show.
 */
export function untilFoeOfKind(
  h: Harness,
  kind: FoeKind,
  maxSeconds: number,
  pollSeconds: number,
): Promise<UntilResult> {
  return h.skipUntil((snapshot) => foesOfKind(snapshot, kind).length > 0, {
    maxFrames: framesFor(maxSeconds),
    poll: framesFor(pollSeconds),
  });
}
