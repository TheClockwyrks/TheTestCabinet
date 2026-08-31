// progression/body-costs-life — a drone's body costs ONE life.
//
// `specs/progression.md` prices it in its table: "Any drone's body reaches the
// ship, of either band | One life", under the same arithmetic the whole table
// runs on — "One event costs exactly one life, whatever else is on the field at
// that instant."
//
// SO THIS ITEM IS ABOUT THE PRICE. That a body is lethal whatever band it carries
// is `bands/body-always-lethal-same-band`'s and `bands/body-always-lethal-opposite`'s;
// what the loss then opens is `progression/ready-hold`'s. This one reads the
// count on the frame the count moved and requires exactly one off it, which is
// where a build that charges once per SUB-STEP reads two — a frame of this
// harness's 100 Hz clock (`0.01 s`) divides into two sub-steps of at most
// `SUBSTEP_MAX` (`1/120 s`, `specs/simulation.md`) — and where a build that
// prices a body as a whole run reads zero.
//
// HOW THE BODY REACHES THE SHIP. The drone is posed with its centre on the
// ship's, in phase `diving`, which is the phase a body reaches the ship in during
// play, with every faculty off so nothing but the build's own contact test
// decides what follows. It is not flown there: `specs/swarm.md` lets a dive end
// "by turning back above `FIELD_BOTTOM`", so a build whose dives turn back above
// `SHIP_Y` (`600`) is conformant and would never deliver a body by flight.
//
// THE BAND IS THE ONE OPPOSITE THE SHIP'S, so the reading is the plain price of a
// body rather than a question about the hull's shield — the shield filters
// bullets, and the same-band body is the sibling item's business.
//
// THE FIELD HOLDS NOTHING ELSE: no bullet, no second drone, and the wave's own
// entry and dive launching are shut, so the life count can only move for the
// contact under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SHIP_Y, START_LIVES, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Frames the contact is given to resolve.
 *
 * The overlap stands from the moment the drone is posed, so a build resolves it
 * on the first frame it runs; four frames leave room for one that resolves
 * contact after its motion step, and stop the sweep long before `READY_HOLD`
 * (`1.3 s`, `specs/progression.md`) could end and expose the ship to a second
 * charge from the body still standing there.
 */
const CONTACT_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes exactly one life when a drone body reaches the ship", async () => {
  await startPosed(h);
  // The one world gate this item's requirement IS.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const band = opposite(posed.ship.band);
  await poseDrone(h, "shard", posed.ship.x, SHIP_Y, { band, phase: "diving" });

  const struck = await h.until((s) => s.lives !== START_LIVES, {
    maxFrames: CONTACT_FRAMES,
  });
  await captureStill(h, "cost");

  assertEqual(
    struck.hit,
    true,
    `a ${band} drone body on the ship's own centre costing a life inside ` +
      `${String(CONTACT_FRAMES)} frames (specs/progression.md)`,
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    `the lives left on the frame the count moved, from ${String(START_LIVES)} — ` +
      "one event costs exactly one life (specs/progression.md)",
  );
});
