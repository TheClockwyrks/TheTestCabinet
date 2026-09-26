// building/placed-at-the-held-rotation — a tower is built at the rotation the
// preview was held at, and its world faces follow.
//
// specs/building.md, Placing: the tower appears "at the held rotation".
// specs/towers.md, Footprints and rotation: "The rotation turns the local faces
// into world faces in the order N -> E -> S -> W, so rotation 1 turns a local N
// into a world E, rotation 2 into a world S, and rotation 3 into a world W", and
// "a tower's radiator faces are reported and drawn in world orientation".
// specs/instrumentation.md says the same of the snapshot: `radiatorFaces` are
// world-oriented, so they name the faces that point outward after the tower's
// placement rotation.
//
// THE STUTTER IS PLACED RATHER THAN THE ARC, and that is the whole design of this
// check. An Arc's radiators are local N and S, a pair a half turn maps onto
// itself, so an Arc could only ever distinguish two of the four steps. A Stutter's
// are local N and E — an asymmetric pair — so each of the four rotations names a
// DIFFERENT pair of world faces: `{N,E}`, `{E,S}`, `{S,W}`, `{W,N}`. Every wrong
// model therefore reads as a different pair, and the failure names which one the
// build implemented: turning the wrong way reads `{W,N}` where `{E,S}` was due,
// ignoring the rotation reads `{N,E}`, and a half-step error reads `{S,W}`.
//
// ALL FOUR STEPS ARE PLACED, each on a quiet anchor of its own, so the check names
// the step that failed rather than merely that one did.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison. Nothing in the
// specification fixes the ORDER `radiatorFaces` lists them in — it fixes which
// faces are in the list — so a build that reports the same two faces in its own
// order is conformant and passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  type Harness,
} from "../harness";
import { requirePlaced, towerOf, worldRadiators } from "./preview";
import { freeSite } from "./sites";

/** The type placed. Its local radiators are N and E: an asymmetric pair. */
const HELD = "stutter";

/** The four steps specs/towers.md fixes. */
const STEPS = [0, 1, 2, 3];

/** Enough money for four copies, so affordability never refuses one. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the tower at the held rotation, with the world faces that rotation gives", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const built: { rotation: number; id: number }[] = [];
  for (const [index, rotation] of STEPS.entries()) {
    const at = freeSite(index);
    const id = requirePlaced(
      placeAt(h, HELD, at.col, at.row, rotation),
      `a ${HELD} at rotation ${rotation}`,
    );
    built.push({ rotation, id });
  }

  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "placed");

  for (const { rotation, id } of built) {
    const tower = towerOf(after, id);
    const want = [...worldRadiators(HELD, rotation)].sort();
    assertEqual(
      tower.rotation,
      rotation,
      `the rotation the ${HELD} placed at rotation ${rotation} reports`,
    );
    assertDeepEqual(
      [...tower.radiatorFaces].sort(),
      want,
      `the world radiator faces of a ${HELD} placed at rotation ${rotation}, ` +
        "whose local radiators are N and E",
    );
  }
});
