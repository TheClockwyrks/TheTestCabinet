// Arc Foundry — audio/cue-plays-on-every-update: every update that raises a cue
// plays it, whatever the wall clock is doing.
//
// THE REQUIREMENT, from `specs/ui.md`: "Each cue is played on the frame its event
// happens, by the code that raised it, and at most once on that frame." The
// sibling point `audio/cue-once-per-frame` reads the ceiling half — a frame that
// raises one event three times plays one cue. This one reads the other half, which
// is the direction a build fails silently: a frame that raised an event has to
// PLAY it, and so does the next frame that raises it, and the one after that.
//
// WHY IT IS ITS OWN POINT. A build is free to fold identical sounds together so a
// firefight does not turn into a wall of noise, and the cheap way to do it is a
// gate on elapsed REAL time — play this cue, then swallow it for the next few
// tens of milliseconds. That passes every point that listens for one cue on one
// frame and still drops most of a rapid structure's shots, because
// `specs/controls.md` advances the simulation "from the elapsed time it is handed
// and from nothing else": at `8x` a shot every `4.5`th of a second of simulation
// is a shot every twenty-eighth of a second of real time, and under a driver
// running frames back to back it is faster still. The cadence is the simulation's,
// so the sound is the simulation's too.
//
// THE DRIVE. One Scrap Emitter with one frozen Slug parked inside its range, run
// for a window long enough to carry five shots, twice: once at `1x` and once at
// `8x`. The Emitter is the right structure for it — `4.5` shots a second is the
// fastest cadence in `specs/components.md`, so the shots crowd together and a gate
// on real time has nowhere to hide. A Slug is the right target: at wave `1` it
// carries far more health than the window's `2`-damage shots remove, so it neither
// dies nor clears the wave underneath the reading. The window is driven in ONE
// advance rather than a frame at a time, deliberately: a frame at a time puts real
// milliseconds between the game's own updates, and this point is about a build
// that measures them.
//
// HOW THE SHOTS ARE COUNTED, WITHOUT WATCHING EVERY FRAME. Every shot is a
// travelling projectile that applies its damage on arrival (`specs/components.md`),
// so across a window that began with an empty yard the shots fired are the damage
// the structure has dealt, over its damage a shot, plus the projectiles still in
// the air. Both are in the snapshot, and both come from figures
// `specs/components.md` fixes rather than from anything the reference chose.
//
// WHAT IS ASSERTED. That as many frames carried the spark cue as the Emitter took
// shots. The engine announces every play with its cue's name and its frame, so the
// two numbers are read directly, and a build that swallowed four of five shots
// reports one against five.

import { afterEach, beforeEach, it } from "vitest";

import { CUES } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  componentDamage,
  componentFireRate,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";
import { ANCHOR, TARGET } from "./cues";

/** The structure the volley is taken with, at Scrap. */
const TYPE = "emitter";
const TIER = 1;

/** Its cadence and its damage a shot, from `specs/components.md`. */
const RATE = componentFireRate(TYPE);
const DAMAGE = componentDamage(TYPE, TIER);

/** How many shots the volley is about. */
const SHOTS = 5;

/** The two ends of the range of multipliers `specs/controls.md` offers. */
const SPEEDS = [1, 8] as const;

/**
 * How long a volley runs, in seconds of SIMULATION: the five shots plus two fire
 * intervals of slack, so the window is never the thing that ran short.
 */
const WINDOW = (SHOTS + 2) / RATE;

/** What one volley did. */
interface Volley {
  /** How many shots the Emitter took across the window. */
  shots: number;
  /** Every cue the engine announced across the window, oldest first. */
  cues: TimedCue[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Hold one Emitter firing at one parked Slug at `speed`, for one window. */
async function volley(h: Harness, speed: number): Promise<Volley> {
  emptyYard(h);
  const emitter = standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
  parkUnit(h, "slug", TARGET);
  h.debug.setSpeed(speed);

  // Nothing has run since the yard was emptied, so the structure has dealt no
  // damage and nothing is in the air: the window opens on zero of both.
  const cues = watchCues(h);
  const from = h.frame();
  await h.advance(ticks(WINDOW / speed));
  const to = h.frame();

  const snapshot = h.snapshot();
  const dealt = structureById(snapshot, emitter).damageDealt;
  return {
    shots: Math.round(dealt / DAMAGE) + snapshot.projectiles.length,
    // A watcher runs until the harness is disposed of, so the window is cut out
    // of it by the frames it drove rather than read off the end of the list.
    cues: cues.filter((cue) => cue.frame > from && cue.frame <= to),
  };
}

it("plays the spark cue on every frame an Emitter fires on", async () => {
  openYard(h, { wave: 1 });

  const volleys = await captureReplay(h, "cues", async () => {
    const driven: Volley[] = [];
    for (const speed of SPEEDS) driven.push(await volley(h, speed));
    return driven;
  });

  for (const [index, speed] of SPEEDS.entries()) {
    const { shots, cues } = volleys[index]!;
    assertGreaterThanOrEqual(
      shots,
      SHOTS,
      `a Scrap ${TYPE} with a Slug inside its range to take at least ` +
        `${SHOTS} shots across ${WINDOW.toFixed(2)} seconds of simulation at ` +
        `${speed}x, at the ${RATE} shots a second of specs/components.md`,
    );
    assertEqual(
      new Set(
        cues
          .filter((cue) => cue.cue === CUES.fireSpark)
          .map((cue) => cue.frame),
      ).size,
      shots,
      `as many frames to carry the ${CUES.fireSpark} cue at ${speed}x as the ` +
        `${TYPE} took shots, so a cue is played on every frame its event ` +
        "happens (specs/ui.md)",
    );
  }
});
