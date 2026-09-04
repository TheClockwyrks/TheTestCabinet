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
// which tile is watched, how long the watch runs, how often it samples. Not one
// span, poll or count below is decided in this file — every one of them is the
// caller's, stated in the check beside the figure `specs/foes.md` fixes it from.

import {
  chargeAt,
  foesOfKind,
  framesFor,
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

/** What watching one kind's roster over a stretch of play found. */
export interface RosterWatch {
  /** The most foes of that kind the roster held at any one sample. */
  peak: number;
  /** The seconds of the watch the first one was seen at, or `null` for none. */
  firstAt: number | null;
  /** The board as it stood at the last sample. */
  snapshot: WirewormSnapshot;
}

/**
 * Run `seconds` of play, sampling the roster for foes of `kind` every
 * `pollSeconds`, and report the most it ever held at once and when the first
 * appeared.
 *
 * The stretch is run through {@link Harness.skip} rather than frame by frame,
 * because what these points wait on is a SPAWNER'S PACING — seven to twelve
 * seconds of it, or a minute — and a skip runs the same real update off camera.
 * The roster is read once before the first frame too, so a foe the arrangement
 * posed counts toward the peak. `each` runs after every sample's play, for a
 * check that has to hold something true for the whole stretch.
 */
export async function watchRoster(
  h: Harness,
  kind: FoeKind,
  seconds: number,
  pollSeconds: number,
  each?: () => Promise<void>,
): Promise<RosterWatch> {
  let peak = 0;
  let firstAt: number | null = null;
  let snapshot = await h.snapshot();

  const sample = (at: number): void => {
    const held = foesOfKind(snapshot, kind).length;
    if (held > peak) peak = held;
    if (held > 0 && firstAt === null) firstAt = at;
  };

  sample(0);
  for (let elapsed = 0; elapsed < seconds; ) {
    const step = Math.min(pollSeconds, seconds - elapsed);
    await h.skip(framesFor(step));
    elapsed += step;
    if (each !== undefined) await each();
    snapshot = await h.snapshot();
    sample(elapsed);
  }
  return { peak, firstAt, snapshot };
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
