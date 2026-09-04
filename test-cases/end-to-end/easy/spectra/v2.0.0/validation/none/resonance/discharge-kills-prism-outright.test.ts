// resonance/discharge-kills-prism-outright — a diving Prism with its shell intact
// is removed entirely by the wave rather than losing only its shell.
//
// THE RULE. `specs/resonance.md` gives the Prism its own row of the wave table:
// "A Prism in one of those phases | It is destroyed whole, shell and core
// together, in one step." The row exists because everywhere ELSE a Prism takes
// two hits — `specs/drones.md`: "Breaking the shell leaves the Prism alive with
// its core exposed" — so a build that routes the wave through its ordinary
// shot-resolution path breaks the shell and leaves the Prism flying, which is
// exactly the wrong model this point names.
//
// THE WAVE IS READ FRAME BY FRAME, WHICH IS WHERE "IN ONE STEP" LIVES. A build
// that took the Prism whole never shows it with `shellAlive` false; a build that
// took it in TWO — the shell broken on one frame, the core taken on a later one,
// both inside the wave's life — leaves nothing on the roster at the end and would
// satisfy a reading taken only there. So the verdict is BOTH: no frame of the
// wave's life on which the Prism stood on the roster with its shell gone, and
// nothing on the roster once the wave has run. The first names the two-step model
// the row exists to forbid; the second names the build that broke the shell and
// left the core flying.
//
// THE SAMPLE IS THE FRAME, WHICH IS WHAT A FRAME-BY-FRAME READING CAN HONESTLY
// CLAIM. This suite's clock runs at 100 Hz and `specs/simulation.md` divides a
// frame into sub-steps of at most `SUBSTEP_MAX` (1/120 s), so a 10 ms frame is two
// sub-steps and a build that broke a shell and took the core in consecutive
// SUB-STEPS of one frame would show neither state to a sample. That build is not
// separated here — nor under the `structured-2d` project, whose clock is the same
// — and it is not what the row is aimed at: the two-step model a build actually
// falls into is one where the shell break and the core kill are two RESOLUTIONS of
// the wave, frames apart, and the sweep sees every one of those.
//
// THE PRISM IS POSED IN PHASE `diving` WITH ITS SHELL INTACT, which is the only
// state in which the two models differ: a Prism whose shell is already gone would
// be destroyed by both. Every faculty is off, so it holds the place it was put
// and takes none of the two shots a diving Prism otherwise fires
// (`specs/drones.md`), and it stands well above `PRISM_INVERT_Y` (640), so
// nothing in this scenario can trigger the spectral inversion a dive to the
// bottom would.
//
// WHAT THIS DOES NOT DECIDE. What a shell break and a core kill SCORE, together
// or apart, is `scoring`'s; that the wave takes Shards is
// `resonance/discharge-clears-divers`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { DISCHARGE_MAX_R, DISCHARGE_TIME, PRISM_INVERT_Y } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  poseBystander,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { release, sweep } from "./wave";

/**
 * Where the diving Prism stands.
 *
 * Mid-field on the ship's own lane, 300 units from the ship at `(640, 600)` —
 * a fifth of `DISCHARGE_MAX_R` (1500), so the wave reaches it early in its life.
 * Clear of both HUD strips (`FIELD_TOP` 64, `FIELD_BOTTOM` 656), clear of the
 * corner the bystander holds, and 340 units above `PRISM_INVERT_Y` (640), the
 * line a diving Prism inverts the field by crossing.
 */
const PRISM_AT = { x: 640, y: 300 } as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (0.5 s) at the harness's 100 Hz clock, over which the wave
 * grows from `0` to `DISCHARGE_MAX_R` (1500), so a Prism 300 units out is reached
 * a fifth of the way through — and a build that broke the shell in one step and
 * would have taken the core in a later one has the rest of the wave's life to do
 * it in.
 */
const WAVE_FRAMES = framesFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a shell-intact diving Prism whole", async () => {
  await startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so the wave
  // still leaves a drone standing (specs/stages.md clears a stage on the moment
  // the last drone of its wave is destroyed).
  await poseBystander(h);
  const prism = await poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    phase: "diving",
    shell: true,
  });

  const posed = await h.snapshot();
  const before = requireDrone(posed, prism, "the diving Prism");
  assertEqual(
    before.phase,
    "diving",
    "precondition: the Prism stands in phase diving",
  );
  assertEqual(
    before.shellAlive,
    true,
    "precondition: the Prism's shell stands before the wave",
  );
  assertEqual(
    before.y < PRISM_INVERT_Y,
    true,
    `precondition: the Prism stands above PRISM_INVERT_Y (${PRISM_INVERT_Y}), ` +
      `so nothing here triggers the inversion a dive to the bottom would ` +
      `(specs/drones.md)`,
  );

  await release(h);
  const samples = await sweep(h, WAVE_FRAMES);
  await captureStill(h, "whole");
  const after = await h.snapshot();

  // The whole of the two-step model, in one reading: a Prism still on the roster
  // with its shell gone is one the wave took a layer at a time.
  const halved = samples.filter(
    (sample) => droneById(sample, prism)?.shellAlive === false,
  );
  assertEqual(
    halved.length,
    0,
    `the frames of the wave's ${WAVE_FRAMES}-frame life on which the diving ` +
      `Prism stood on the roster with its shell gone and its core still ` +
      `flying: none, since the wave destroys a Prism whole, shell and core ` +
      `together, IN ONE STEP (specs/resonance.md). A build that shows the ` +
      `Prism in that state has taken it in two`,
  );

  const survivor = droneById(after, prism);
  assertUndefined(
    survivor,
    `the diving Prism after a discharge wave reached it, 300 units from the ` +
      `ship and far inside DISCHARGE_MAX_R (${DISCHARGE_MAX_R}): off the ` +
      `roster, since the wave ` +
      `destroys a Prism whole, shell and core together, in one step ` +
      `(specs/resonance.md). A Prism still on the roster with shellAlive ` +
      `${String(survivor?.shellAlive)} is one whose shell the wave broke and ` +
      `whose core it left flying`,
  );
});
