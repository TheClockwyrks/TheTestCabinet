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
// THE READING SEPARATES THE TWO MODELS BY ITSELF. A build that took the Prism
// whole leaves nothing on the roster; a build that only broke the shell leaves
// the drone there with `shellAlive` false. So the verdict is "off the roster"
// rather than "not intact", and the second reading — the shell state a surviving
// Prism would report — is named in the failure so a reviewer can see which of the
// two happened.
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
import { DISCHARGE_MAX_R, DISCHARGE_TIME } from "../constants";
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
import { release } from "./wave";

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

  await release(h);
  await h.advance(WAVE_FRAMES);
  await captureStill(h, "whole");
  const after = await h.snapshot();

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
