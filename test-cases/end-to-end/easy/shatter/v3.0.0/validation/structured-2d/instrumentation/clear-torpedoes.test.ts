// instrumentation/clear-torpedoes — `clearTorpedoes()` empties the torpedoes and
// leaves every other body standing. `warhead` only.
//
// THE RULE. `specs/instrumentation.md`, The torpedoes: "`clearTorpedoes()`
// Removes every torpedo, leaving the rest standing."
//
// WHY THE ITEM EXISTS AT ALL. `clearTorpedoes` sits inside the harness's
// `clearWorld`, which is the first line of `startPlaying` and therefore of
// almost every `warhead` scenario in this suite. A build that implements it
// wrongly — leaving a torpedo in flight, or taking the rocks with it — would
// contaminate scenarios across Homing torpedo, Detonation and Armor with no item
// naming the cause. This one names it.
//
// THE FIELD CARRIES ONE OF EVERYTHING. "Leaving the rest standing" is only a
// reading on a field where the rest is there to stand: a rock of each size, three
// of the ship's rounds, three of the saucer's, and a saucer, each held against
// exactly what it was — the same entries with the same ids at the same places.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the clear
// and the reading: a pose acts on the live game the moment it is made
// (`specs/instrumentation.md`), so what is compared is the operation's own
// effect. It also keeps the torpedoes' own guidance out of the scenario
// entirely — no tick runs while they are on the field, so nothing is acquired,
// nothing turns and nothing lands (`specs/weapons.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { posePopulatedField } from "./scene";
import { poseTorpedo } from "./torpedo";

/** Where the torpedoes hang: out at the left, clear of every other body. */
const TORPEDO_SPOTS = [
  { x: 120, y: 300 },
  { x: 120, y: 360 },
  { x: 120, y: 420 },
];

/** The heading they are posed on. No tick runs while they are up. */
const TORPEDO_HEADING = Math.PI;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every torpedo and leaves the rest standing", async () => {
  posePopulatedField(h);
  for (const at of TORPEDO_SPOTS) {
    poseTorpedo(h, at.x, at.y, TORPEDO_HEADING);
  }

  const before = h.snapshot();
  assertLength(
    torpedoesOf(before),
    TORPEDO_SPOTS.length,
    "the posed field carries the torpedoes",
  );

  requireOp(h.debug, "clearTorpedoes")();
  const after = h.snapshot();

  assertLength(torpedoesOf(after), 0, "clearTorpedoes removes every torpedo");
  assertDeepEqual(
    after.rocks,
    before.rocks,
    "clearTorpedoes leaves the rocks standing, unchanged",
  );
  assertDeepEqual(
    after.bullets,
    before.bullets,
    "clearTorpedoes leaves the ship's bullets standing, unchanged",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "clearTorpedoes leaves the saucer's bullets standing, unchanged",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "clearTorpedoes leaves the saucer standing, unchanged",
  );

  // The field with the torpedoes gone and the rest standing.
  await h.advance(1);
  captureStill(h, "cleared");
});
