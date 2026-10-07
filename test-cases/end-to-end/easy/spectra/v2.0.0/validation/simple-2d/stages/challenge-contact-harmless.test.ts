// stages/challenge-contact-harmless — a challenge drone's body costs nothing.
//
// specs/stages.md, Challenge stages: "A challenge drone's body costs no life.
// Contact between the ship and one of them does nothing." specs/progression.md
// carries the same row in its table of what costs a life: a challenge drone's body
// reaching the ship costs nothing. It is the exception to the rule
// `progression/body-costs-life` grades, where any drone's body, of either band,
// costs one life.
//
// WHAT IS DRIVEN. The game builds its own challenge wave, and one of its OWN
// drones is brought to the ship. Nothing about the drone is fabricated: it is a
// drone the build made for a challenge stage, so a build that decides harmlessness
// per drone rather than per stage is graded the same as one that reads the stage.
//
// THE SHIP'S CONTACT TEST IS ON. It is one of the three world gates `startPosed`
// shuts, and this is one of the points whose requirement it IS, so it is left
// exactly as the game leaves it. The other two gates are shut: without
// `setWaveEntry(false)` the stage's next group arrives mid-scenario, and without
// `setDiveLaunching(false)` a formation drone could be pulled into a dive —
// neither of which this point is about.
//
// THE FIELD IS ISOLATED TO ONE DRONE. Every other drone of the flyover is removed,
// so nothing else can reach the ship and the life the check reads back can only
// have been paid for the contact it posed. The survivor is set down ON the ship,
// with its travel off so it stays there, and carries the band OPPOSITE the ship's
// — the band that would be lethal on a standard stage, so a build that spares only
// same-band bodies is caught.
//
// WHAT IS ASSERTED. The lives, and nothing else. Whether the drone survives the
// contact, whether it scores, and what the ship does are other points' business.

import { afterEach, beforeEach, it } from "vitest";
import { CHALLENGE_EVERY, SHIP_Y, START_LIVES } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the flyover is opened on: the first the challenge schedule names. */
const STAGE = CHALLENGE_EVERY;

/**
 * Seconds the drone is left sitting on the ship.
 *
 * Half a second — sixty frames of contact resolving every one of them. A build
 * that charges a life for the contact charges it in the first of those frames, and
 * a build that charges one on some cadence of its own has had sixty chances.
 */
const HELD_FOR = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life when a challenge drone's body reaches the ship", async () => {
  await startStage(h, STAGE);

  const opened = h.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${String(STAGE)} to be a challenge stage (specs/stages.md)`,
  );
  const chosen = opened.drones[0];
  if (chosen === undefined) {
    fail(
      "a challenge stage to put its drones on the field (specs/stages.md)",
      "the drone roster was empty when the challenge stage opened",
    );
  }

  h.debug.setWaveEntry(false);
  h.debug.setDiveLaunching(false);
  for (const drone of opened.drones) {
    if (drone.id !== chosen.id) h.debug.removeDrone(drone.id);
  }

  h.debug.setLives(START_LIVES);
  h.debug.setDroneTravel(chosen.id, false);
  h.debug.setDroneOscillation(chosen.id, false);
  h.debug.setDroneFire(chosen.id, false);
  h.debug.setDroneBand(
    chosen.id,
    opened.ship.band === "cyan" ? "magenta" : "cyan",
  );
  h.debug.setDronePosition(chosen.id, opened.ship.x, SHIP_Y);

  await h.advance(ticksFor(HELD_FOR));
  captureStill(h, "harmless");

  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "the lives left after a challenge drone's body reached the ship " +
      "(specs/stages.md, specs/progression.md)",
  );
});
