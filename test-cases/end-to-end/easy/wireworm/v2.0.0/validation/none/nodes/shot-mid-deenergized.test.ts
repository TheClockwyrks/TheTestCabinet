// nodes/shot-mid-deenergized — a bolt knocks a charge-2 node down one rung.
//
// specs/nodes.md's table of what a bolt does to a node by charge gives charge
// `2` one outcome: "The node is left standing at charge `1`." One rung per bolt,
// never two, and never a removal: "A charged node is therefore cleared by
// knocking its charge down one bolt at a time and removing it once it is inert."
//
// WHY CHARGE 2 IS ITS OWN POINT. It is the rung from which every wrong model
// reads back as a different number — left alone reads `2`, cleared to inert
// reads `0`, removed reads absent, detonated reads absent with the neighbouring
// witness gone too, and raised reads `3`. A build that treats "shot" as "reset to
// inert" passes nodes/shot-low-deenergized and fails only here, which is what
// makes the pair worth two points.
//
// THE POSE IS ONE NODE, ONE WITNESS AND ONE BOLT. The witness stands two tiles
// away at charge `1`, inside the reach a detonation would arc along
// (specs/discharge.md, DISCHARGE_RADIUS `2`), so a build that detonates instead
// of de-energizing is named by the witness rather than passing quietly. The bolt
// is placed one row below the target, on an empty tile, and climbs into it
// through the build's own shot code (specs/cursor.md).
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseNodes,
  shootTile,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the shot node stands on: clear of the band, clear of the entry row. */
const TARGET = { c: 12, r: 10 } as const;

/** The node is posed at charge `2`, the "charged" state of specs/nodes.md's table. */
const POSED_CHARGE = 2;

/** What one bolt leaves it at, from the same table. */
const STRUCK_CHARGE = 1;

/** A charged witness inside a detonation's reach, so a wrong blast is named. */
const WITNESS = { c: TARGET.c + 2, r: TARGET.r, charge: 1 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a charge-2 node standing at charge 1 when a bolt strikes it", async () => {
  await startPlaying(h);
  await poseNodes(h, [
    [TARGET.c, TARGET.r, POSED_CHARGE],
    [WITNESS.c, WITNESS.r, WITNESS.charge],
  ]);
  assertEqual(
    chargeAt(await h.snapshot(), TARGET.c, TARGET.r),
    POSED_CHARGE,
    "the node as posed, before the bolt",
  );

  await shootTile(h, TARGET.c, TARGET.r);
  await captureStill(h, "deenergized");

  const after = await h.snapshot();
  assertEqual(
    chargeAt(after, TARGET.c, TARGET.r),
    STRUCK_CHARGE,
    `the node at (${TARGET.c}, ${TARGET.r}) after one bolt`,
  );
  assertEqual(
    chargeAt(after, WITNESS.c, WITNESS.r),
    WITNESS.charge,
    `the charged witness at (${WITNESS.c}, ${WITNESS.r})`,
  );
});
