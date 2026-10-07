// waves/speed-scales-per-wave — each wave's rocks drift four percent faster than
// the one before.
//
// THE RULE. `specs/progression.md`, "Waves": "Each rock's speed is a Large's base
// drift speed (`specs/rocks.md`) multiplied by `1 + min(WAVE_SPEED_CAP,
// WAVE_SPEED_STEP * (N - 1))` with `WAVE_SPEED_STEP` (`0.04`) and
// `WAVE_SPEED_CAP` (`0.4`), so wave 1's rocks take the plain range, wave 6's are
// `20` percent faster".
//
// THE BASE SPEED IS POSED, SO THE FACTOR IS READ DIRECTLY. A base drift speed is
// DRAWN — "drawn uniformly from its size's range" (`specs/rocks.md`) — so one rock
// of wave 6 read on its own says nothing about the factor: a slow draw at `1.20`
// and a fast draw at `1.00` produce the same number. `specs/instrumentation.md`
// gives the surface `setNextRockSpeed`, which sets the outcome that draw would
// decide for every rock of the next placement, so wave 6 is spawned with a known
// base and every one of its rocks must arrive at that base times `1.20`. The
// range itself is `rocks/drift-speed-large`'s item.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that applies no
// per-wave scaling at all reads `100`, twenty units out. A build that halves or
// doubles the step reads `110` or `140`. A build that applies the cap from the
// start reads `140`. A build that scales from `N` rather than from `N - 1` reads
// `124`, and one that compounds the step reads `121.7`, both outside the bound.
//
// THE FACTOR IS READ AGAINST THE WAVE THE BUILD SAYS IT SPAWNED, not against the
// one this check posed. `specs/progression.md` states two separate rules — the
// wave number advances by one on a clear, and wave `N`'s speeds carry `N`'s
// factor — and `wave-number-increments` is the item for the first. A build that
// advances by two is wrong about that rule and can be exactly right about this
// one; read against the posed wave it would lose this point as well, for a defect
// it has already been charged for.
//
// THE READING IS TAKEN ON THE TICK THE WAVE ARRIVES, because `specs/rocks.md`
// makes the base drift speed "the speed it enters the field with" and every tick
// afterwards is a tick `specs/gravity.md`'s well has been bending it. At most one
// tick of the well is inside a reading — where a spawn sits among a tick's six
// steps is not something `specs/simulation.md` fixes — and at the closest a wave
// may spawn to the star that is under one unit per second (`./scene.ts`,
// {@link SPAWN_WELL_PER_TICK}).
//
// WHAT THIS ITEM DOES NOT DECIDE. The CAP, which is `speed-is-capped`'s point: at
// wave 6 the cap is nowhere near, so a build that never caps at all passes here
// and fails there.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note
// at the top of `scene.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_SPEED_CAP, WAVE_SPEED_STEP } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  POSED_BASE_SPEED,
  SPAWN_WELL_PER_TICK,
  posedWaveSpeeds,
  waveSpeedScale,
} from "./scene";

/** The wave read: far enough along that the step has bitten, short of the cap. */
const SCALED_WAVE = 6;

/**
 * How far a rock's speed may fall from the posed base times the factor: two
 * units per second.
 *
 * Inside it sit exactly two things: the at-most one tick of the well that is in
 * every reading, worth under `0.94` units per second at `WAVE_MIN_STAR_DIST`,
 * and float rounding on a velocity read off the state. The nearest wrong model,
 * a build scaling from `N` rather than `N - 1`, is four units out.
 */
const SPEED_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drifts wave 6's rocks at the posed base times 1 + WAVE_SPEED_STEP x 5", async () => {
  const arrived = await posedWaveSpeeds(h, SCALED_WAVE);
  // The faster rocks of a later wave, as the spawn left them. The clear runs
  // undrawn, so one frame is drawn for the picture — after every speed the
  // verdict rests on has been read.
  await h.paint();
  captureStill(h, "wave");

  // What `specs/progression.md` says the factor is, for the wave the build
  // reported spawning: `1 + WAVE_SPEED_STEP * 5` = `1.20` for a build whose wave
  // number advances by one, as waves/wave-number-increments requires separately.
  const wanted = POSED_BASE_SPEED * waveSpeedScale(arrived.wave);

  assertGreaterThan(
    arrived.speeds.length,
    0,
    `rocks on the field for wave ${String(arrived.wave)}, whose speeds are ` +
      "read (specs/progression.md)",
  );

  for (const [index, speed] of arrived.speeds.entries()) {
    assertLessThanOrEqual(
      Math.abs(speed - wanted),
      SPEED_TOLERANCE,
      `rock ${String(index + 1)} of wave ${String(arrived.wave)} drifting at ` +
        `the posed base ${String(POSED_BASE_SPEED)} times ` +
        `${wanted.toFixed(2)}, within ${String(SPEED_TOLERANCE)} — a wave's ` +
        "speeds are the base multiplied by " +
        "1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1)), with " +
        `WAVE_SPEED_STEP ${String(WAVE_SPEED_STEP)} and WAVE_SPEED_CAP ` +
        `${String(WAVE_SPEED_CAP)} (specs/progression.md); read on the tick ` +
        `the wave arrived, where at most ${SPAWN_WELL_PER_TICK.toFixed(2)} ` +
        "units per second of the well is in a reading; " +
        `${String(POSED_BASE_SPEED)} is a build that never scales`,
    );
  }
});
