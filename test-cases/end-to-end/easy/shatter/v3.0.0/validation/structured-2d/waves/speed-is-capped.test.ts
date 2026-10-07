// waves/speed-is-capped — the per-wave speed scaling stops at forty percent.
//
// THE RULE. `specs/progression.md`, "Waves": each rock's speed is a Large's base
// drift speed "multiplied by `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))`
// with `WAVE_SPEED_STEP` (`0.04`) and `WAVE_SPEED_CAP` (`0.4`) … and every wave
// from 11 onward is `40` percent faster".
//
// WHAT IS MEASURED. Wave 20's rocks against the posed base times
// `1 + WAVE_SPEED_CAP` = `1.40`. THE CAP, which is the whole of what separates
// this item from `speed-scales-per-wave`: that item reads a wave below the cap,
// where the step is all there is; this one reads a wave far above it, where the
// `min` is what decides the answer.
//
// THE BASE SPEED IS POSED, through `setNextRockSpeed`, for the reason
// `speed-scales-per-wave` gives: a base drift speed is drawn, and posing the
// outcome of that draw is what lets one wave be read against a known figure.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no cap at
// all reads `1 + 0.04 * 19` times the base, `176`, thirty-six units out. A build
// that caps at the wrong figure — the step itself, `104`, or a doubled cap,
// `180` — reads those. A build with no per-wave scaling at all reads `100`,
// which fails here and fails `speed-scales-per-wave` too — the two items
// together say whether a build has the step, the cap, both or neither.
//
// WHY WAVE 20 AND NOT WAVE 11. Wave 11 is the first wave the cap bites on, so a
// build that is out by one wave — capping from 12, say — still reads `140` there
// and would pass. At wave 20 an uncapped build is far away and a build that caps
// a wave late is still capped, so what the reading is about is the cap and not
// the boundary it starts at.
//
// THE FACTOR IS READ AGAINST THE WAVE THE BUILD SAYS IT SPAWNED, not against the
// one this check posed, and THE READING IS TAKEN ON THE TICK THE WAVE ARRIVES,
// both for the reasons `speed-scales-per-wave` gives.
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

/** The wave read: well past the wave the cap first bites on. */
const CAPPED_WAVE = 20;

/**
 * How far a rock's speed may fall from the posed base times the capped factor:
 * two units per second, on the derivation `speed-scales-per-wave` gives.
 */
const SPEED_TOLERANCE = 2;

/** What a build that never caps would read, for the failure message. */
const UNCAPPED = POSED_BASE_SPEED * (1 + WAVE_SPEED_STEP * (CAPPED_WAVE - 1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops the per-wave scaling at 1 + WAVE_SPEED_CAP", async () => {
  const arrived = await posedWaveSpeeds(h, CAPPED_WAVE);
  // Wave 20's rocks, at the capped drift speed, as the spawn left them. The
  // clear runs undrawn, so one frame is drawn for the picture — after every
  // speed the verdict rests on has been read.
  await h.paint();
  captureStill(h, "wave");

  // What `specs/progression.md` says the factor is, for the wave the build
  // reported spawning: `1 + WAVE_SPEED_CAP` = `1.40` for a build whose wave
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
        `${wanted.toFixed(2)} — the capped factor 1 + WAVE_SPEED_CAP — within ` +
        `${String(SPEED_TOLERANCE)}: the per-wave scaling is ` +
        "1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1)), so every wave " +
        `from 11 onward drifts ${String(WAVE_SPEED_CAP * 100)} percent faster ` +
        "and no faster (specs/progression.md); read on the tick the wave " +
        `arrived, where at most ${SPAWN_WELL_PER_TICK.toFixed(2)} units per ` +
        `second of the well is in a reading; ${UNCAPPED.toFixed(0)} is a ` +
        "build that never caps at all",
    );
  }
});
