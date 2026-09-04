// editor/counterweight-on-a-flange-node — a flange node of the ring carries a
// counterweight, with no member ending there.
//
// `specs/structure.md` § Counterweights: a counterweight is "placed on any node
// the structure uses, a node a member ends at or a flange node of the ring". The
// two halves of that phrase are two ways for a node to qualify, and this check
// decides the second one alone.
//
// SO THE STRUCTURE IS THE RING AND NOTHING ELSE. The world is emptied and only
// the ring is placed, so `(2, 6, 2)` — the top flange's far corner — is used by
// the ring and by nothing else in the crane. A build that only counts member ends
// refuses it; a build that reads the spec's second half places it. Choosing a
// TOP-flange node rather than the base corner also keeps the reading away from
// `structure.ring.corner`, which a build could special-case on its own.
//
// Site 0's envelope covers the ring's eight nodes and its `3000` budget covers
// `RING_COST` (`300`) plus `COUNTERWEIGHT_COST` (`40`), so nothing here is
// refused for room or for money, and the base corner's `y` is `4` rather than
// `0`, as the ring rule requires.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength, assertNotNull } from "../assert";
import { LATTICE_PITCH } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The ring's base corner: off the ground, as the ring rule requires. */
const CORNER: Vec3 = { x: 0, y: 4, z: 0 };

/** The top flange's far corner: `(x + pitch, y + pitch, z + pitch)`. */
const FLANGE_NODE: Vec3 = {
  x: CORNER.x + LATTICE_PITCH,
  y: CORNER.y + LATTICE_PITCH,
  z: CORNER.z + LATTICE_PITCH,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a counterweight on a flange node where no member ends", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  const posed = await h.snapshot();
  assertNotNull(posed.structure.ring, "the ring the counterweight hangs on");
  assertLength(
    posed.structure.members,
    0,
    "the members standing, so the flange node is used by the ring alone",
  );

  await h.debug.addCounterweight(FLANGE_NODE.x, FLANGE_NODE.y, FLANGE_NODE.z);
  await h.advance(1);

  const { structure } = await h.snapshot();
  assertContains(
    structure.counterweights,
    FLANGE_NODE,
    `the counterweight on (${FLANGE_NODE.x}, ${FLANGE_NODE.y}, ` +
      `${FLANGE_NODE.z}), a flange node of the ring (specs/structure.md)`,
  );

  await h.capture(
    "counterweight-on-a-flange-node",
    "A counterweight on the ring's top-flange node",
  );
});
