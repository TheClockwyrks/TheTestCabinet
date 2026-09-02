// Meltdown — audio/trip-cue: an emitter carried over `100` by a real shot plays
// the `trip` cue on the frame it trips.
//
// `specs/audio.md` binds `trip` to "an emitter trips" and fixes the frame: a cue
// "is raised by the frame that resolves the event it answers". `specs/heat.md`
// fixes the event, and it is a crossing rather than a value: an emitter trips on
// the frame in which its newly resolved heat reaches `100` having opened that
// frame below it.
//
// THE CROSSING IS REAL, AND IT IS THE ONE THING NOT POSED. `setTowerTripped` sets
// the flag alone, touching neither the heat nor `tripTimer`
// (`specs/instrumentation.md`), and it is not used here: this point's requirement
// IS the trip event, so the emitter runs its own fire clock, its own
// `heatPerShot` and its own two-phase heat resolution and crosses on its own.
//
// THE HEAT IS POSED HIGH ONLY TO SHORTEN THE CLIMB. `setTowerHeat` is a
// precondition and "does not trip the tower: the trip belongs to the heat model"
// (`specs/instrumentation.md`), and `90` is below the `100` the crossing is at,
// so the frame the cue names is still one the build's own heat model chose. The
// figure is not load-bearing either: a firing Stutter gains
// `fireRate * heatPerShot / mass` = `7.0 * 4.2 / 0.5` = `58.8` heat a second
// against an air loss of at most `(3.6 * 4 + 1.1 * 4) / 0.5` = `37.6` a second at
// heat `100` (`specs/towers.md`, `specs/heat.md`), so it climbs to the trip from
// ANY starting heat and the pose only decides how long the check takes.
//
// The `fire` cue sounds through the climb, because every shot that landed is a
// shot that resolved, and this point says nothing about it: what is read here is
// the trip cue and its frame alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  watchCues,
  type Harness,
} from "../harness";
import { playedOn, playsOf } from "./cues";

/** The tile the Stutter's 2x2 footprint is anchored on: quiet floor, off every opening. */
const TOWER = { col: 10, row: 10 } as const;

/** The tile the target stands on, about `2.6` tiles inside the Stutter's `5.0` (specs/towers.md). */
const TARGET = { col: 13, row: 10 } as const;

/**
 * The heat the Stutter is posed at, below the `TRIP_HEAT` (`100`) the crossing is
 * at (`specs/heat.md`), so the shot that carries it over is the build's.
 */
const POSED_HEAT = 90;

/**
 * The target's hp, and its maximum.
 *
 * Past its redline of `60` a Stutter is at the curve's plateau (`3.5`), so it
 * removes `2.0 * 3.5` = `7` per shot at `7.0` shots a second (`specs/towers.md`,
 * `specs/heat.md`, `specs/combat.md`) — under `50` hp a second. A pool four orders
 * of magnitude past that cannot be emptied inside this check's window, so the
 * emitter keeps a target for the whole climb and never raises `death`.
 */
const TARGET_HP = 1_000_000;

/**
 * How long the emitter is given to cross `100`.
 *
 * From heat `90` a conforming Stutter's net gain is over `20` a second, so it
 * crosses in about half a second; the first of the shots that carry it lands one
 * fire interval — `1 / 7` of a second — after the target is acquired
 * (`specs/combat.md`). Five seconds is a hard ceiling ten times that: a build
 * whose heat model is merely slow fails here rather than leaving the point
 * inconclusive.
 */
const TRIP_TICKS = ticksFor(5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the trip cue on the frame a real shot carries the emitter over 100", async () => {
  startRun(h);
  const stutter = poseTower(h, "stutter", TOWER.col, TOWER.row, 0);
  h.debug.setTowerHeat(stutter, POSED_HEAT);
  poseTarget(h, "mote", TARGET.col, TARGET.row, TARGET_HP);

  assertEqual(
    towerOf(h.snapshot(), stutter).tripped,
    false,
    "posing: setTowerHeat does not trip the tower, so the emitter opens this " +
      "drive online (specs/instrumentation.md)",
  );

  // Subscribed after the floor is posed, so what is read is the climb alone.
  const played = watchCues(h);

  const trip = await h.until((s) => towerOf(s, stutter).tripped, {
    maxFrames: TRIP_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "trip");

  assertEqual(
    trip.hit,
    true,
    "the Stutter's own shots carried its heat to 100 inside " +
      `${String(TRIP_TICKS)} frames (specs/heat.md, The trip)`,
  );
  assertLength(
    playsOf(played, CUES.trip).filter((cue) => cue.frame < frame),
    0,
    "plays of the trip cue on any frame before the crossing — a cue is raised " +
      "by the frame that resolves the event it answers (specs/audio.md)",
  );
  assertLength(
    playedOn(played, frame).filter((name) => name === CUES.trip),
    1,
    "plays of the trip cue on the frame the emitter tripped, which is its own " +
      "frame and once on it (specs/audio.md)",
  );
  assertGreaterThan(
    playsOf(played, CUES.trip)[0].gain,
    0,
    "the gain the trip cue played at on an unmuted bus (specs/audio.md)",
  );
});
