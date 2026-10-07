// Meltdown — towers/rotation-turns-the-faces: a quarter turn moves the radiator
// faces.
//
// THE RULE. specs/towers.md, Footprints and rotation: "Radiator faces are given
// below in the tower's local orientation, which is its orientation at rotation
// `0`", and "The rotation turns the local faces into world faces in the order
// `N -> E -> S -> W`, so rotation `1` turns a local `N` into a world `E`". "A
// tower's radiator faces are reported and drawn in world orientation", and
// specs/instrumentation.md says the same of `radiatorFaces`. The Arc's local
// radiators are N and S, so a quarter turn must report E and W.
//
// TWO TOWERS, THE SAME TYPE, ONE STEP APART, and that is the whole of the
// reading. Rotation `0` is the control: a build that reports N and S there and E
// and W a step later has turned its faces, and a build that reports N and S at
// both has not turned them at all. Reading rotation `1` alone could not tell the
// second from a build whose local layout is E and W to begin with.
//
// THEY ARE PLACED RATHER THAN POSED, because the rule is about the rotation a
// PLACEMENT fixes: specs/building.md commits the tower "at the held rotation", so
// the reading runs through arming, holding a rotation and committing — the path a
// player takes — rather than through `addTower`'s rotation argument. The two
// stand on quiet anchors six tiles apart, so neither abuts the other and neither
// lengthens a route.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison. Nothing in the
// specification fixes the ORDER `radiatorFaces` lists them in — it fixes which
// faces are in the list — so a build reporting the same two in its own order is
// conformant and passes.
//
// WHY THE ARC RATHER THAN AN ASYMMETRIC TOWER. This item decides the SINGLE step
// the description names, and the Arc's N-and-S pair is the one specs/towers.md
// gives that step's example against. That the pair is symmetric under a half turn
// is why the item stops at one step: `towers/rotation-cycles-through-four` reads
// all four, on a Rime, where every step names a different set.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import {
  costOf,
  freeSite,
  placeAt,
  requirePlaced,
  sortedFaces,
} from "./roster";

/** The tower placed. Its local radiators are N and S (specs/towers.md). */
const TOWER = "arc";

/** The control step and the quarter turn read against it. */
const STEPS = [0, 1];

/**
 * The world faces each step must report, written out rather than derived, because
 * this is the item that decides the `N -> E -> S -> W` mapping itself.
 */
const WORLD_FACES: Record<number, string[]> = {
  0: ["N", "S"],
  1: ["E", "W"],
};

/** Money far above two Arcs, so neither placement is refused for the purse. */
const PURSE = 100 * costOf(TOWER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Rotation turns the radiator faces", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const built = STEPS.map((rotation, index) => {
    const at = freeSite(index);
    return {
      rotation,
      id: requirePlaced(
        placeAt(h, TOWER, at.col, at.row, rotation),
        `placing an ${TOWER} at rotation ${rotation}`,
      ),
    };
  });

  await h.advance(1);
  captureStill(h, "turned");
  const read = h.snapshot();

  for (const { rotation, id } of built) {
    const tower = towerOf(read, id);
    assertEqual(
      tower.rotation,
      rotation,
      `the rotation an ${TOWER} placed at rotation ${rotation} reports`,
    );
    assertDeepEqual(
      sortedFaces(tower.radiatorFaces),
      WORLD_FACES[rotation],
      `the world radiator faces of an ${TOWER} placed at rotation ` +
        `${rotation}, whose local radiators are N and S`,
    );
  }
});
