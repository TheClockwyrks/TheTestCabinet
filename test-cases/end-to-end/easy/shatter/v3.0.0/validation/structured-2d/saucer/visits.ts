// Shatter — driving a game long enough to watch saucers come and go, for the
// `saucer/*` points about the CADENCE.
//
// Six points in this directory are about when a saucer turns up rather than about
// what it does once it has: the first arrival at `SAUCER_FIRST_DELAY` (`18` s),
// the `SAUCER_GAP_MIN`–`SAUCER_GAP_MAX` (`25`–`35` s) gap after each one leaves,
// the edge and the row each enters at, that only one is ever up, and — through the
// avoidance sweep — fifty-four whole crossings. Every one of them needs MINUTES of
// game time, and this module is the one reading they share: the game opened the
// way a player opens it, emptied of everything the point is not about, and then
// watched arrival by arrival.
//
// WHY A FRAME IS WORTH SEVERAL TICKS HERE. `specs/simulation.md` fixes the game's
// timestep at `TICK_HZ` and has the game convert whatever delta a frame brings
// into whole ticks, carrying the remainder — so an interval of game time reaches
// the same state however it was divided into frames, which
// `specs/instrumentation.md` states outright as the property the whole surface
// rests on. A frame worth {@link MARCH_TICKS} ticks is therefore exactly as much
// game as {@link MARCH_TICKS} frames worth one, and it is what makes these points
// affordable: sixteen arrivals under four seeds is eleven minutes of game time,
// which is eighty thousand ticks, and the engine renders once per FRAME rather
// than once per tick.
//
// WHAT THE COARSER FRAME COSTS, AND WHERE IT IS PAID. A reading can only be taken
// on a frame boundary, so a sample lands up to {@link MARCH_TICKS} ticks after the
// event it reports. Every point that marches states what that is worth in its own
// units — a saucer at `SAUCER_SPEED` (`140`) covers `9.3` units in eight ticks,
// which is why `enters-at-an-edge` reads a `40`-unit band and not a tighter one —
// and no point marches where it needs a tick-exact reading. `at-most-one-at-a-time`
// samples every tick and so builds its own harness at the default clock; nothing
// here forces a stride on a check that does not want one.
//
// THE DRAW CALLS ARE DROPPED AS THE MARCH GOES. The harness records every call the
// render makes so the presentation points can read them, and a two-minute march
// draws hundreds of thousands. None of these points reads a call, so the record is
// emptied as the march runs: what a point reads is the snapshot and the canvas,
// and both are unaffected.
//
// WHY THIS IS LOCAL TO THIS DIRECTORY. Nothing here is a threshold — every figure
// these points assert is stated in the point that asserts it, derived from
// `specs/saucer.md`. What lives here is the one SCENARIO they share, and no other
// group in this suite marches minutes of game time.

import { ConstantClock } from "@test-cabinet/structured-2d";
import { FACE_UP, SAFE_X, SAFE_Y, TICK_HZ } from "../constants";
import {
  clearCalls,
  clearWorld,
  createHarness,
  startRun,
  TICK_MS,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/**
 * The whole simulation ticks one marched FRAME is worth.
 *
 * Eight, which is a fifteenth of a second of game time. It is the same stride the
 * avoidance sweep samples a crossing at, so a marched frame and a sample are the
 * same thing and a crossing costs one render per sample rather than eight.
 */
export const MARCH_TICKS = 8;

/** The game time one marched frame covers, in seconds. */
export const MARCH_STEP = MARCH_TICKS / TICK_HZ;

/** A harness whose every frame hands the game {@link MARCH_TICKS} whole ticks. */
export function createMarchHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock(TICK_MS * MARCH_TICKS) });
}

/** The whole marched frames covering `seconds` of game time. */
export function marchFrames(seconds: number): number {
  return Math.round((seconds * TICK_HZ) / MARCH_TICKS);
}

/**
 * How many frames the harness may run between two emptyings of the render record.
 *
 * Small enough that a march of any length holds a bounded number of recorded
 * calls, large enough that the emptying itself costs nothing.
 */
const RECORD_CHUNK = 120;

/**
 * Run `frames` frames, dropping the render record as it goes.
 *
 * The frames are the harness's own — whatever clock the caller stood the harness
 * up with — so this is `advance` for a stretch too long to keep the drawing of.
 */
export async function march(h: Harness, frames: number): Promise<void> {
  let run = 0;
  while (run < frames) {
    const step = Math.min(RECORD_CHUNK, frames - run);
    await h.advance(step);
    run += step;
    clearCalls(h);
  }
}

/**
 * A REAL GAME, opened the way a player opens one, on a field holding nothing but
 * the ship — with the game's own saucer arrival left running.
 *
 * `specs/saucer.md` times the first arrival "`SAUCER_FIRST_DELAY` (`18` seconds)
 * of game time after the game begins", so the game has to BEGIN rather than be
 * posed: `reset` for the title and a seeded generator, then `confirm` on `PLAY`
 * (`specs/ui.md`). One frame runs, the frame that carries the key's edge, and its
 * ticks are the first ticks of the game — which is the count answered here, so a
 * point that marches to a stated moment of game time knows where it is starting
 * from.
 *
 * EVERYTHING THE CADENCE IS NOT ABOUT IS THEN SHUT. The wave loop is gated off
 * BEFORE the opening wave is taken off the field, so no tick ever sees an emptied
 * field and no wave can clear or arrive under a march; the banner is run out; and
 * the ship is put back at the safe point at rest with its lethal contact test
 * shut, so nothing the saucer does costs a life and interrupts the run. Taking the
 * rocks off with `clearRocks` destroys nothing and clears no wave
 * (`specs/instrumentation.md`), which is exactly why it is safe here.
 *
 * `saucerSpawning` is left ON. It is the faculty every point that calls this is
 * about, and `reset` restores it on.
 */
export async function openQuietGame(h: Harness, seed: number): Promise<number> {
  await startRun(h, seed);

  h.debug.setWaveSpawning(false);
  clearWorld(h);
  h.debug.setWaveBanner(0);

  h.debug.setShipCollision(false);
  h.debug.setShipPosition(SAFE_X, SAFE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACE_UP);

  // The one frame `confirm` cost, which is game the caller has already spent.
  return 1;
}

/** One saucer's visit, as a watch saw it. */
export interface Visit {
  /** The `saucer.id` the arrival took. */
  id: number;
  /** The game time of the first sample that reported it, in seconds. */
  seenAt: number;
  /** Its centre on that sample. */
  x: number;
  y: number;
  /** The game time of the first sample that reported the field clear of it. */
  goneAt: number | null;
}

/** What a watch saw over the frames it ran. */
export interface VisitWatch {
  /** Every visit seen, in the order they arrived. */
  visits: Visit[];
  /**
   * Every sample on which one live `saucer.id` was followed directly by another
   * with NO sample between them reporting the field clear — a second visit
   * started over a live one. Each entry names the two ids and the moment.
   */
  overlaps: string[];
  /** The reading the watch ended on. */
  snapshot: ShatterSnapshot;
}

/** What a watch is told to do beyond running its frames. */
export interface WatchOptions {
  /** Stop early, once the visits so far satisfy this. */
  done?: (visits: readonly Visit[]) => boolean;
  /** Called on the sample a visit is first seen on, with that frame on canvas. */
  onArrival?: (visit: Visit, snapshot: ShatterSnapshot) => void;
}

/**
 * Watch the saucer slot for `frames` frames, and answer every visit it held.
 *
 * The slot is single by construction (`specs/instrumentation.md`: "the saucer is a
 * single slot rather than a roster"), so there is no roster to count and the
 * continuity of `saucer.id` is what says whether two visits overlapped. That is
 * the whole of {@link VisitWatch.overlaps}: a fresh id where the previous sample
 * still held a live one is a second visit begun over the first, and
 * `specs/saucer.md` states that "A saucer already on the field is never joined by
 * a second."
 *
 * A visit's `seenAt`, `x` and `y` are read on the FIRST sample that reported it,
 * which is where a point about the entry edge or the entry row reads its figure.
 * The reading is therefore up to one frame late, and each such point states what
 * that is worth.
 */
export async function watchVisits(
  h: Harness,
  frames: number,
  options: WatchOptions = {},
): Promise<VisitWatch> {
  const visits: Visit[] = [];
  const overlaps: string[] = [];
  let live: Visit | null = null;

  const sample = (snapshot: ShatterSnapshot): void => {
    const saucer = snapshot.saucer;
    if (saucer === null) {
      if (live !== null) {
        live.goneAt = snapshot.simTime;
        live = null;
      }
      return;
    }
    if (live !== null) {
      if (live.id === saucer.id) return;
      overlaps.push(
        `saucer ${live.id} was still up when saucer ${saucer.id} arrived, ` +
          `at simTime ${snapshot.simTime.toFixed(3)}`,
      );
      live.goneAt = snapshot.simTime;
    }
    const visit: Visit = {
      id: saucer.id,
      seenAt: snapshot.simTime,
      x: saucer.x,
      y: saucer.y,
      goneAt: null,
    };
    visits.push(visit);
    live = visit;
    options.onArrival?.(visit, snapshot);
  };

  let snapshot = h.snapshot();
  sample(snapshot);

  for (let frame = 0; frame < frames; frame += 1) {
    await h.advance(1);
    snapshot = h.snapshot();
    sample(snapshot);
    if (frame % RECORD_CHUNK === RECORD_CHUNK - 1) clearCalls(h);
    if (options.done?.(visits) === true) break;
  }
  clearCalls(h);

  return { visits, overlaps, snapshot };
}
