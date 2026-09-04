// bands/body-always-lethal-same-band — a body is never mistaken for a shield.
//
// specs/bands.md, immediately after the shield table: "A drone's body is not
// filtered by the shield. Contact between the ship and any drone's body, of
// either band and whatever the ship is tuned to, hits the ship."
// specs/progression.md prices it the same way: any drone's body reaching the ship
// costs one life.
//
// The band under test is the ship's OWN, which is the wrong-model case: a build
// that runs a drone's body through the same filter its bullets go through
// absorbs this contact and pays nothing, and it is only readable here. The
// opposite band is the sibling `bands/body-always-lethal-opposite`, so a build
// that never charges for a body and one that charges only for the opposite band
// grade differently.
//
// HOW THE BODY REACHES THE SHIP. The drone is posed with its centre on the
// ship's, in phase `diving` — the phase a body reaches the ship in during play —
// with every faculty off, so nothing but the build's own contact test decides
// what follows. It is not flown there: specs/swarm.md lets a dive end "by turning
// back above `FIELD_BOTTOM`", so a build whose dives turn back above `SHIP_Y`
// (600) is conformant and would never deliver a body by flight. Posing the
// contact demands nothing a build does not owe, and it reaches the requirement
// directly.
//
// The field holds nothing else: no bullet, no second drone, and the wave's own
// entry and dive launching are shut, so the life count can only move for the
// contact under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SHIP_Y, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Frames the contact is given to resolve, in frames of the suite's clock.
 *
 * A twentieth of a second. specs/simulation.md resolves contacts at the end of
 * EVERY sub-step, and the overlap stands from the moment the drone is posed, so a
 * conformant build resolves it on the first update that runs; the window is the
 * room a build gets to resolve a contact it noticed on the frame before. It is
 * far inside `READY_HOLD` (`1.3` s, specs/progression.md), so the beat the loss
 * opens cannot end and put the returning ship back onto the body still standing
 * there for a second charge. Stated in seconds rather than in frames, so the same
 * requirement is read to the same amount of GAME TIME under all three engines,
 * whose harness clocks differ.
 */
const CONTACT_FRAMES = framesFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("costs a life when a drone of the ship's own band reaches it", async () => {
  await startPosed(harness);
  await harness.debug.setShipContact(true);
  const posed = await harness.snapshot();
  assertEqual(posed.ship.band, "cyan", "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  await poseDrone(harness, "shard", posed.ship.x, SHIP_Y, {
    band: "cyan",
    phase: "diving",
  });

  const struck = await harness.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_FRAMES,
  });
  await captureStill(harness, "hit");

  assertEqual(
    struck.hit,
    true,
    "a drone body of the ship's own band costing a life (specs/bands.md)",
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    "the lives left after one same-band body reached the ship",
  );
});
