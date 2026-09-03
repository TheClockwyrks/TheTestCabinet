// controls/delete-tie-counterweight-over-ring — a delete tie between a
// counterweight and the ring takes the counterweight.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to the member, then
// the counterweight, then the ring." This check is the second step of that order,
// so nothing is built that could put a member in range at all.
//
// THE TIE IS EXACT, AND IT IS MADE BY A FLANGE NODE. The ring is measured from
// its eight flange nodes and the counterweight from the node it hangs on, so a
// counterweight hung on a flange node and clicked at the point the build says it
// drew that node at leaves both of them zero pixels from the click — the same
// number, not two numbers that happen to be close.
//
// A build that answered such a tie with the ring would clear the ring and leave
// the counterweight; the stated order takes the counterweight and leaves the ring
// standing at the corner it was placed by. `specs/structure.md` allows the
// counterweight there: it is placed "on any node the structure uses, a node a
// member ends at or a flange node of the ring".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The ring's base corner: a lattice node off the ground, as the rules ask. */
const RING = { x: 2, y: 6, z: 2 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the counterweight when a counterweight and the ring tie", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addCounterweight(RING.x, RING.y, RING.z);
  await h.debug.setTool("delete");

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    0,
    "the members standing, none, so no member is in range of the click",
  );
  assertNotNull(
    posed.structure.ring,
    "the ring the scenario places (specs/structure.md)",
  );
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight the scenario hangs on the ring's base corner",
  );
  assertEqual(posed.tool, "delete", "the tool the click is made under");

  const at = await h.project(RING.x, RING.y, RING.z);
  assertTrue(
    at.visible,
    "the flange node the click is made on is on the stage",
  );
  await h.click(at.x, at.y);

  await h.capture("state", "the ring after the tied delete click");

  const s = await h.snapshot();
  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights after a delete click tied between the counterweight " +
      "and the ring, which the tie order takes first (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.ring),
    JSON.stringify({ corner: { x: RING.x, y: RING.y, z: RING.z } }),
    "the ring after that click: the tie the counterweight won leaves it " +
      "standing at the corner it was placed by (specs/controls.md)",
  );
});
