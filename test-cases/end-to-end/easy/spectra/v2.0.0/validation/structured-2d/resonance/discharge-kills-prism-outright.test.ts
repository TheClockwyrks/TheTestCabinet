// resonance/discharge-kills-prism-outright — a diving Prism with its shell intact
// is removed entirely by the wave rather than losing only its shell.
//
// THE RULE. specs/resonance.md gives the Prism its own row of the wave table: "A
// Prism in one of those phases | It is destroyed whole, shell and core together,
// in one step." The row exists because everywhere ELSE a Prism takes two hits —
// specs/drones.md: breaking the shell leaves the Prism alive with its core
// exposed — so a build that routes the wave through its ordinary shot-resolution
// path takes the shell first and the core after, which is exactly the wrong model
// this point names.
//
// "IN ONE STEP" IS WHAT THE READING HAS TO CATCH, and it is why the wave is
// sampled frame by frame rather than read once at the end. A build that breaks
// the shell on the frame the wave arrives and takes the core on a later one ends
// the wave with the same empty roster a conforming build does, so an end-state
// reading alone grades the two the same. What separates them is the state in
// between: a Prism destroyed whole is never observed standing with its shell
// gone, and a Prism taken in two steps is. So the verdict is that no frame of the
// wave ever shows this Prism on the roster with `shellAlive` false — and, with
// it, that the roster no longer holds the Prism once the wave has run, which is
// what fails a build whose wave leaves the core flying for good.
//
// THE PRISM IS POSED IN PHASE `diving` WITH ITS SHELL INTACT, which is the only
// state in which the two models differ: a Prism whose shell is already gone would
// be destroyed by both. Every faculty is off, so it holds the place it was put
// and takes none of the shots a diving Prism otherwise fires (specs/drones.md),
// and nothing else is on the field that could break its shell — no player bullet
// is placed and the wave is the only thing that reaches it.
//
// IT STANDS WELL ABOVE `PRISM_INVERT_Y` (`640`), so nothing in this scenario can
// trigger the spectral inversion a dive to the bottom would.
//
// WHAT THIS DOES NOT DECIDE. What a shell break and a core kill SCORE, together
// or apart, is `scoring`'s; that the wave takes Shards is
// `resonance/discharge-clears-divers`.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_MAX_R, DISCHARGE_TIME } from "../../src/constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  LANE_CENTER,
  SHIP_LANE_Y,
  captureStill,
  createHarness,
  distanceBetween,
  droneById,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander, release, sweep } from "./wave";

/**
 * Where the diving Prism stands, in logical units.
 *
 * Mid-field on the ship's own lane, 300 units from the ship — a fifth of
 * `DISCHARGE_MAX_R` (`1500`), so the wave reaches it early in its life and the
 * frames after it arrives are all inside the span this check samples. Well inside
 * the play field on both axes (`y` in `[64, 656]`, specs/field.md), clear of the
 * corner the bystander holds, and 340 units above `PRISM_INVERT_Y` (`640`), the
 * line a diving Prism inverts the field by crossing.
 */
const PRISM_AT = { x: LANE_CENTER, y: 300 } as const;

/** The Prism's stored band, which specs/drones.md makes the shell's. */
const STORED_BAND = "cyan" as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the harness's 100 Hz clock, sampled one frame at
 * a time so every state the Prism passed through is read. The wave grows from `0`
 * to `DISCHARGE_MAX_R` (`1500`) over that span, so a Prism 300 units out is
 * reached a fifth of the way through — and a build that broke the shell in one
 * step and would have taken the core in a later one has the rest of the wave's
 * life to do it in, and is caught by the frames in between rather than let off by
 * the end state it eventually reaches.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a shell-intact diving Prism whole, never leaving its core flying", async () => {
  startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so the wave
  // still leaves a drone standing (specs/stages.md clears a stage in the moment
  // the last drone of its wave is destroyed).
  poseBystander(h);
  const prism = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: STORED_BAND,
    phase: "diving",
    shell: true,
  });

  const posed = h.snapshot();
  const range = distanceBetween(PRISM_AT, {
    x: posed.ship.x,
    y: SHIP_LANE_Y,
  });
  assertEqual(
    droneById(posed, prism)?.phase,
    "diving",
    "precondition: the Prism stands in phase diving",
  );
  assertEqual(
    droneById(posed, prism)?.shellAlive,
    true,
    "precondition: the Prism's shell stands before the wave",
  );

  await release(h);
  const samples = await sweep(h, WAVE_TICKS);
  captureStill(h, "whole");

  const halved = samples.filter(
    (snapshot) => droneById(snapshot, prism)?.shellAlive === false,
  );
  assertEqual(
    halved.length,
    0,
    `the frames of the wave in which the Prism stood on the roster with its ` +
      `shell gone and its core still flying: none, since the wave destroys a ` +
      `Prism whole, shell and core together, IN ONE STEP ` +
      `(specs/resonance.md). A build that shows the Prism in that state has ` +
      `taken it in two`,
  );
  assertUndefined(
    droneById(h.snapshot(), prism),
    `the diving Prism after a discharge wave reached it, ${range} units from ` +
      `the ship and far inside DISCHARGE_MAX_R (${DISCHARGE_MAX_R}): off the ` +
      `roster, since the wave destroys a Prism whole rather than leaving its ` +
      `core flying (specs/resonance.md)`,
  );
});
