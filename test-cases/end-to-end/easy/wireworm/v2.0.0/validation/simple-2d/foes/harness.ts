// foes/harness — the arrangements the `foes` group's checks share.
//
// Only this group poses these, so they live beside the checks that use them
// rather than in the shared harness next door. Like everything there, they fix
// ARRANGEMENT alone — which tile a foe stands on, which faculty is held, how
// often a roster is sampled — and never a threshold: every distance, interval
// and count a check asserts is stated in that check, derived from the figure
// specs/foes.md fixes for it.

import { tileCX, tileCY } from "../../src/constants";
import {
  chargeAt,
  lastFoe,
  poseFoe,
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

/**
 * Pose one foe of `kind` at a stage CENTER rather than on a tile, and report its
 * id.
 *
 * The shared harness's `poseFoe` centers a foe on a tile, which is what the
 * checks about a foe's effect on the field want. The checks about how a foe
 * TRAVELS want the same placement expressed as the point they measure from, so
 * that the distance covered is read against the position that was posed rather
 * than against a tile center derived twice.
 */
export function poseFoePoint(
  h: Harness,
  kind: FoeKind,
  x: number,
  y: number,
): number {
  h.debug.addFoe(kind, x, y);
  return lastFoe(h.snapshot()).id;
}

/** The center of tile `(c, r)`, which is where a foe posed on it stands. */
export function tileCenter(c: number, r: number): { x: number; y: number } {
  return { x: tileCX(c), y: tileCY(r) };
}

/**
 * The foe with that id, or `null` once the board no longer holds it.
 *
 * The shared harness's `foeOf` FAILS on an id the roster has lost, which is what
 * a check reading a foe's motion wants. The checks about how a foe DIES want the
 * absence itself as their reading, so this answers `null` for it and the check
 * asserts on that.
 */
export function heldFoe(
  snapshot: WirewormSnapshot,
  id: number,
): FoeSnapshot | null {
  return snapshot.foes.find((foe) => foe.id === id) ?? null;
}

/** Every foe of `kind` on the board, in roster order. */
export function foesOfKind(
  snapshot: WirewormSnapshot,
  kind: FoeKind,
): FoeSnapshot[] {
  return snapshot.foes.filter((foe) => foe.kind === kind);
}

/** What watching one kind's roster over a stretch of play found. */
export interface RosterWatch {
  /** The most foes of that kind the roster held at any one sample. */
  peak: number;
  /** The frame of the watch the first one was seen at, or `null` for none. */
  firstAt: number | null;
}

/**
 * Run `frames` frames, sampling the roster for foes of `kind` every `poll`
 * frames, and report the most it ever held at once and when the first appeared.
 *
 * The roster is read once before the first frame too, so a foe posed by the
 * arrangement counts toward the peak. `each` runs after every sample's frames,
 * for a check that has to hold something true for the whole stretch.
 */
export async function watchRoster(
  h: Harness,
  kind: FoeKind,
  frames: number,
  poll: number,
  each?: () => void,
): Promise<RosterWatch> {
  let peak = 0;
  let firstAt: number | null = null;

  const sample = (at: number): void => {
    const count = foesOfKind(h.snapshot(), kind).length;
    if (count > peak) peak = count;
    if (count > 0 && firstAt === null) firstAt = at;
  };

  sample(0);
  let done = 0;
  while (done < frames) {
    const step = Math.min(poll, frames - done);
    await h.advance(step);
    done += step;
    each?.();
    sample(done);
  }
  return { peak, firstAt };
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
