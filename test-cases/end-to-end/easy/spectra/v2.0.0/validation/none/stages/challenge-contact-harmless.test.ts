// stages/challenge-contact-harmless — a challenge drone's body costs nothing.
//
// specs/stages.md, Challenge stages: "A challenge drone's body costs no life.
// Contact between the ship and one of them does nothing." specs/progression.md
// carries the same row in its table of what costs a life: "A challenge drone's
// body reaches the ship | Nothing". It is the exception to the rule
// `progression/body-costs-life` grades, where any drone's body, of either band,
// costs one life.
//
// WHAT IS DRIVEN. The game builds its own challenge wave, and one of its OWN drones
// is brought to the ship. Nothing about the drone is fabricated: it is a drone the
// build made for a challenge stage, so a build that decides harmlessness per drone
// rather than per stage is graded the same as one that reads the stage.
//
// THE SHIP'S CONTACT TEST IS ON. It is one of the three world gates `startPosed`
// shuts, and this is one of the points whose requirement it IS, so it is left
// exactly as the game leaves it. The other two gates are shut: without
// `setWaveEntry(false)` the stage's next group arrives mid-scenario, and without
// `setDiveLaunching(false)` a formation drone could be pulled into a dive — neither
// of which this point is about.
//
// THE FIELD IS ISOLATED TO ONE DRONE. Every other drone of the flyover is removed,
// so nothing else can reach the ship and the life the check reads back can only
// have been paid for the contact it posed. The survivor is set down ON the ship,
// with its travel off so it stays there, and carries the band OPPOSITE the ship's —
// the band that would be lethal on a standard stage, so a build that spares only
// same-band bodies is caught.
//
// WHAT IS ASSERTED. The lives, and nothing else. Whether the drone survives the
// contact, whether it scores, and what the ship does are other points' business.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { CHALLENGE_EVERY, SHIP_Y, START_LIVES, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startStage,
  type Harness,
} from "../harness";

/** The stage the flyover is opened on: the first the challenge schedule names. */
const STAGE = CHALLENGE_EVERY;

/**
 * Seconds the drone is left sitting on the ship.
 *
 * Half a second — fifty frames of contact resolving every one of them. A build that
 * charges a life for the contact charges it in the first of those frames, and a
 * build that charges one on some cadence of its own has had fifty chances.
 */
const HELD_FOR = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("costs no life when a challenge drone's body reaches the ship", async () => {
  await startStage(harness, STAGE);

  const opened = await harness.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${STAGE} to be a challenge stage (specs/stages.md)`,
  );
  const chosen = opened.drones[0];
  if (chosen === undefined) {
    fail(
      "a challenge stage to put its drones on the field (specs/stages.md)",
      "the drone roster was empty when the challenge stage opened",
    );
  }

  await harness.debug.setWaveEntry(false);
  await harness.debug.setDiveLaunching(false);
  for (const drone of opened.drones) {
    if (drone.id !== chosen.id) await harness.debug.removeDrone(drone.id);
  }

  await harness.debug.setLives(START_LIVES);
  await harness.debug.setDroneTravel(chosen.id, false);
  await harness.debug.setDroneOscillation(chosen.id, false);
  await harness.debug.setDroneFire(chosen.id, false);
  await harness.debug.setDroneBand(chosen.id, opposite(opened.ship.band));
  await harness.debug.setDronePosition(chosen.id, opened.ship.x, SHIP_Y);

  await harness.advance(framesFor(HELD_FOR));
  await captureStill(harness, "harmless");

  const after = await harness.snapshot();
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives left after a challenge drone's body reached the ship (specs/stages.md, specs/progression.md)",
  );
});
