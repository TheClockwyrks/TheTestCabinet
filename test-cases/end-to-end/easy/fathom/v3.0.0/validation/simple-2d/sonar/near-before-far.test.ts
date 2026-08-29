// sonar/near-before-far — the flood arrives, it does not appear.
//
// specs/sensing.md: "Each open tile within `E` corridor steps of the origin is
// revealed as the front reaches it, near tiles before far ones". Read against the
// rate the same page fixes — "the front advances at `SONAR_WAVE_SPEED` (`14`)
// corridor steps per second" — that is a claim with a number in it: a tile `d`
// steps out becomes revealed `d / 14` seconds after the pulse.
//
// So this poses a straight corridor, watches two tiles at known corridor
// distances, and takes the moment each first stops reporting `u`. A build that
// reveals its whole flood on the tick the pulse is cast fails both times; one
// that reveals the far tile with the near one fails the ordering; one whose front
// crawls fails the far time.
//
// THE TWO TILES ARE OUT PAST THE FORAGER'S OWN LIGHT, and that is what fixes
// which distances can be read. specs/sensing.md gives the light pocket a radius
// of `V = VISION_MIN + VISION_GAIN * G`, `96` at the `G = 0` this scenario parks
// the forager at, and on a straight corridor the light travels straight down it —
// so the first three tiles are already lit before any pulse, and only a tile four
// or more steps out is dark enough for "when did the pulse reveal it" to be a
// question at all. `NEAR_STEPS` and `FAR_STEPS` are the nearest and the furthest
// pair that leaves both readings inside the depth-1 range of `9`.
//
// WHAT THIS DOES NOT DECIDE. How far the pulse reaches, and what it does with the
// rock, which are `sonar/reveals-walls`'; and where the front stands at a given
// moment, which is `sonar/wavefront`'s — that point reads the build's own `front`
// and this one reads the fog, so a build can fail either alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { SONAR_WAVE_SPEED, TICK_DT, TILE } from "../../src/constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import { Tile } from "../maze";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { emitPulse, requireFogMemory, sinceEmit } from "./pulse";

/** The corridor, in tiles: the forager's own plus nine steps out. */
const RUN_TILES = 10;

/** The near tile's corridor distance from the forager, in steps. See the header. */
const NEAR_STEPS = 4;

/** The far tile's, inside the `9` steps a depth-1 pulse reaches. */
const FAR_STEPS = 8;

/**
 * How far each arrival may sit from `d / SONAR_WAVE_SPEED`, as a fraction.
 *
 * The item's bound: five percent.
 */
const ARRIVAL_TOLERANCE = 0.05;

/**
 * The extra slack each arrival carries, in seconds.
 *
 * Two ticks. One for the tick the press itself ran on — elapsed is measured from
 * the snapshot before the key went down, and specs/sensing.md does not fix where
 * inside that tick the casting falls — and one for the tick of resolution a
 * sweep that samples every tick can report an arrival to.
 */
const ARRIVAL_SLACK = 2 * TICK_DT;

/**
 * How long the sweep runs, in ticks after the press.
 *
 * A hard ceiling half again the `FAR_STEPS / SONAR_WAVE_SPEED` seconds a
 * conforming front takes, so a build whose flood merely crawls FAILS on the
 * tolerance above rather than leaving the point undecided.
 */
const SWEEP_TICKS = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reveals a tile 4 corridor steps out before one 8 steps out, each as the front reaches it", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  await parkForager(h, run.start);
  const watch = await sceneGuard(h);

  const near: Tile = { tx: run.start.tx + NEAR_STEPS, ty: run.start.ty };
  const far: Tile = { tx: run.start.tx + FAR_STEPS, ty: run.start.ty };

  // The scenario's own ground: at the brightness it parks the forager at, the
  // light pocket cannot reach either tile, so whatever reveals them is the
  // pulse. Both halves of that are checked — the radius the build reports, and
  // the fog it actually has.
  const posed = h.snapshot();
  assertLessThan(
    posed.visionRadius,
    NEAR_STEPS * TILE,
    `V at the brightness this scenario poses, against the ${NEAR_STEPS * TILE} ` +
      `units to the nearer of the two tiles it reads`,
  );
  for (const tile of [near, far]) {
    assertEqual(
      visibilityOf(posed, tile),
      "u",
      `the visibility of the tile at (${tile.tx}, ${tile.ty}) before any pulse ` +
        `was cast — it stands ${Math.hypot(tile.tx - run.start.tx, tile.ty - run.start.ty) * TILE} ` +
        `units from a forager whose light reaches ${posed.visionRadius}, and ` +
        "an already-revealed tile leaves no arrival for this point to time",
    );
  }

  const flood = await captureReplay(h, "progressive", async () => {
    const emitted = await emitPulse(h);
    let arrivedNear: number | null = null;
    let arrivedFar: number | null = null;
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = h.snapshot();
      const elapsed = sinceEmit(emitted, snapshot);
      if (arrivedNear === null && visibilityOf(snapshot, near) !== "u") {
        arrivedNear = elapsed;
      }
      if (arrivedFar === null && visibilityOf(snapshot, far) !== "u") {
        arrivedFar = elapsed;
      }
      if (arrivedNear !== null && arrivedFar !== null) break;
    }
    // Held on a little past the readings, so the clip shows the front running
    // out rather than stopping the instant the far tile lights.
    await h.advance(24);
    return { emitted, arrivedNear, arrivedFar };
  });

  requireSceneHeld(h.snapshot(), watch);

  // Every reading above is of the fog's MEMORY of a front that has already
  // passed, so a build that keeps nothing it reveals answers "u" at all of
  // them and reads exactly like one whose pulse revealed nothing. Taken here,
  // after the readings, so it costs a clean run nothing.
  await requireFogMemory(h);

  for (const arrival of [
    { steps: NEAR_STEPS, at: flood.arrivedNear, tile: near },
    { steps: FAR_STEPS, at: flood.arrivedFar, tile: far },
  ]) {
    const expected = arrival.steps / SONAR_WAVE_SPEED;
    assertEqual(
      arrival.at !== null,
      true,
      `the tile at (${arrival.tile.tx}, ${arrival.tile.ty}), ${arrival.steps} ` +
        `corridor steps out, was revealed within ${SWEEP_TICKS} ticks of the ` +
        `press, of the ${expected.toFixed(3)} s a front at SONAR_WAVE_SPEED takes`,
    );
    if (arrival.at === null) continue;
    assertLessThanOrEqual(
      Math.abs(arrival.at - expected),
      ARRIVAL_TOLERANCE * expected + ARRIVAL_SLACK,
      `|arrival - ${expected.toFixed(3)} s| at the tile ${arrival.steps} ` +
        "corridor steps out, measured from the tick the press ran on",
    );
  }

  if (flood.arrivedNear !== null && flood.arrivedFar !== null) {
    assertLessThan(
      flood.arrivedNear,
      flood.arrivedFar,
      `when the tile ${NEAR_STEPS} steps out was revealed, against the ` +
        `${flood.arrivedFar.toFixed(3)} s it took the tile ${FAR_STEPS} steps out`,
    );
  }
});
