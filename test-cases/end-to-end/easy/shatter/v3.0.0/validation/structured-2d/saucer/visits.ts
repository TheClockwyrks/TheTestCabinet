// Shatter — driving a game long enough to watch saucers come and go, for the
// `saucer/*` points about the CADENCE.
//
// Six points in this directory are about when a saucer turns up rather than about
// what it does once it has: the first arrival at `SAUCER_FIRST_DELAY` (`18` s),
// the `SAUCER_GAP_MIN`–`SAUCER_GAP_MAX` (`25`–`35` s) gap after each one leaves,
// the edge and the row each enters at, that only one is ever up, and — through the
// avoidance sweep — thirty-six whole crossings. Every one of them needs long
// stretches of game time, and this module is the one reading they share: the game
// opened the way a player opens it, emptied of everything the point is not about,
// and then watched arrival by arrival.
//
// THE DUE IS POSED WHERE THE CADENCE IS NOT THE REQUIREMENT. `specs/saucer.md`
// draws the gap between visits from twenty-five to thirty-five seconds, and
// `setSaucerDue` sets the figure that draw decides (`specs/instrumentation.md`).
// A point about the entry edge or the entry row wants an arrival rather than a
// wait, so {@link closeUpArrival} poses a due a quarter of a second out and
// catches the arrival that follows; the two points about the cadence itself pose
// nothing and read the build's own clock.
//
// WHY A FRAME IS WORTH SEVERAL TICKS HERE. `specs/simulation.md` fixes the game's
// timestep at `TICK_HZ` and has the game convert whatever delta a frame brings
// into whole ticks, carrying the remainder — so an interval of game time reaches
// the same state however it was divided into frames, which
// `specs/instrumentation.md` states outright as the property the whole surface
// rests on. A frame worth {@link MARCH_TICKS} ticks is therefore exactly as much
// game as {@link MARCH_TICKS} frames worth one, and it is what makes these points
// affordable: forty arrivals over four games is eight minutes of game time even
// with every due posed short, which is sixty thousand ticks, and the engine
// renders once per FRAME rather than once per tick.
//
// WHAT THE COARSER FRAME COSTS, AND WHERE IT IS PAID. A reading can only be taken
// on a frame boundary, so a sample lands up to {@link MARCH_TICKS} ticks after the
// event it reports. Every point that marches states what that is worth in its own
// units — a saucer at `SAUCER_SPEED` (`140`) covers `9.3` units in eight ticks,
// which is why `enters-at-an-edge` reads a `40`-unit band and not a tighter one —
// and no point marches where it needs a tick-exact reading. `at-most-one-at-a-time`
// marches too, because a second visit begun over a live one shows as one live id
// followed straight by another at any stride, while a conformant clear stretch
// between visits lasts twenty-five seconds and more.
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

import { ConstantClock } from "@clockwyrks/structured-2d";
import {
  FACE_UP,
  SAFE_X,
  SAFE_Y,
  SAUCER_LIFETIME,
  TICK_HZ,
} from "../constants";
import { fail } from "../assert";
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
 * posed: `reset` for the title, then `confirm` on `PLAY` (`specs/ui.md`). One frame runs, the frame that carries the key's edge, and its
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
export async function openQuietGame(h: Harness): Promise<number> {
  await startRun(h);

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
  /**
   * Called on the sample a visit is first seen on.
   *
   * The watch runs undrawn (see below), so a handler that wants the picture
   * awaits {@link Harness.paint} first — one drawn frame, one tick past the
   * sample it was handed.
   */
  onArrival?: (visit: Visit, snapshot: ShatterSnapshot) => void | Promise<void>;
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
 *
 * THE WATCH RUNS UNDRAWN. Every frame is a whole frame — the world ticks and the
 * pipeline walks the scene — but none of them puts ink on the canvas, because
 * what a watch reads is one id per frame and `at-most-one-at-a-time` alone spends
 * two minutes of game time here. A handler that wants a picture of the moment
 * asks for one with {@link Harness.paint}.
 */
export async function watchVisits(
  h: Harness,
  frames: number,
  options: WatchOptions = {},
): Promise<VisitWatch> {
  const visits: Visit[] = [];
  const overlaps: string[] = [];
  let live: Visit | null = null;

  const sample = async (snapshot: ShatterSnapshot): Promise<void> => {
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
    await options.onArrival?.(visit, snapshot);
  };

  let snapshot = h.snapshot();

  await h.quiet(async () => {
    await sample(snapshot);
    for (let frame = 0; frame < frames; frame += 1) {
      await h.advance(1);
      snapshot = h.snapshot();
      await sample(snapshot);
      if (frame % RECORD_CHUNK === RECORD_CHUNK - 1) clearCalls(h);
      if (options.done?.(visits) === true) break;
    }
  });
  clearCalls(h);

  return { visits, overlaps, snapshot };
}

/* -------------------------------------------------------------------------- */
/* Bringing an arrival on                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The due a check poses to bring an arrival on at once, in seconds.
 *
 * `setSaucerDue` sets the figure the gap draw decides
 * (`specs/instrumentation.md`), so a check that wants an arrival without waiting
 * out the cadence poses a short one. A quarter of a second, which is thirty
 * ticks: long enough that a build's clock has whole ticks to reach it, short
 * enough that the watch to the arrival costs a handful of frames.
 */
export const SHORT_DUE = 0.25;

/** How long a wait for a posed arrival runs before the scenario is unreachable. */
const ARRIVAL_CEILING_SECONDS = 2;

/**
 * Pose a due of {@link SHORT_DUE} and watch until the arrival it times is on the
 * field, answering that visit as the watch first saw it.
 *
 * The field must be clear of a saucer when this is called: the cadence runs only
 * while it is (`specs/saucer.md`), and the watch reads the first visit it sees.
 * A conformant build brings the saucer on within a quarter of a second; a build
 * that ignores the posed due is reported as an arrival that never came, inside
 * two seconds, rather than as a bad edge or row.
 */
export async function closeUpArrival(h: Harness): Promise<Visit> {
  if (h.snapshot().saucer !== null) {
    fail(
      "a field clear of a saucer when a posed due is set, so the arrival it " +
        "times is the next one (specs/saucer.md)",
      "a saucer is already up",
    );
  }
  h.debug.setSaucerDue(SHORT_DUE);
  const watch = await watchVisits(h, marchFrames(ARRIVAL_CEILING_SECONDS), {
    done: (visits) => visits.length >= 1,
  });
  const visit = watch.visits[0];
  if (visit === undefined) {
    fail(
      `a saucer arriving within ${ARRIVAL_CEILING_SECONDS} s of game time of ` +
        `setSaucerDue(${SHORT_DUE}) on a clear field (specs/instrumentation.md)`,
      "no saucer arrived",
    );
  }
  return visit;
}

/**
 * Run until the field is clear of the saucer `id`.
 *
 * A visit ends on its own clock, `SAUCER_LIFETIME` after it entered
 * (`specs/saucer.md`), so a watch of a little over that always finds the field
 * clear on a conformant build; the cadence to the next arrival runs from there.
 * Undrawn, like every watch here.
 */
export async function awaitDeparture(h: Harness, id: number): Promise<void> {
  const left = await h.quiet(() =>
    h.until(
      (snapshot) => snapshot.saucer === null || snapshot.saucer.id !== id,
      { poll: 1, maxFrames: marchFrames(SAUCER_LIFETIME + 1) },
    ),
  );
  clearCalls(h);
  if (!left.hit) {
    fail(
      `saucer ${id} leaving the field within SAUCER_LIFETIME ` +
        `(${SAUCER_LIFETIME} s) of game time (specs/saucer.md)`,
      "it was still on the field a second past that",
    );
  }
}
