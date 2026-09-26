// Meltdown — towers/rotation-cycles-through-four: four rotations, four face sets,
// and no fifth.
//
// THE RULE. specs/towers.md: "A tower carries a placement rotation of `0`, `1`,
// `2`, or `3`, each a further 90-degree step", and the rotation turns the local
// faces into world faces in the order `N -> E -> S -> W`. specs/building.md fixes
// the step: "rotating advances the held rotation one step through `0`, `1`, `2`,
// `3` and back to `0`". So there are four rotations and exactly four, and a fifth
// is not a thing a player can reach.
//
// THE RIME, BECAUSE ITS FACES ARE THE ODD SET. Its local radiators are N, S and E
// — three faces, and an arrangement no rotation maps onto itself — so each of the
// four steps names a DIFFERENT set of world faces: `{E,N,S}`, `{E,S,W}`,
// `{N,S,W}`, `{E,N,W}`. Every wrong model therefore reads as a different set, and
// the failure names which one the build implemented: turning the wrong way reads
// `{E,N,W}` where `{E,S,W}` is due, ignoring the rotation reads `{E,N,S}` at every
// step, and a half-step error reads `{N,S,W}`. An Arc, whose N-and-S pair a half
// turn maps onto itself, could distinguish only two of the four.
//
// EACH STEP IS PLACED ON A QUIET ANCHOR OF ITS OWN, so the failure names the step
// it came from rather than merely that one failed, and so no pair abuts or
// lengthens a route. They are PLACED rather than posed because the rule is about
// the rotation a placement fixes (specs/building.md, Placing).
//
// AND THEN THE FIFTH STEP IS LOOKED FOR. The rotate control is driven four times
// from a held rotation of `0` and the held rotation is read after each: it must
// walk `1, 2, 3, 0`, so the fourth press returns to the start and no press ever
// reaches `4`. specs/controls.md binds `rotate` to `KeyR`, and the key is used
// rather than the surface's `setPreviewRotation` because a value the surface was
// HANDED says nothing about what a player can reach — the wrap is a property of
// the step, and the step is what the key drives.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison: nothing in the
// specification fixes the ORDER `radiatorFaces` lists them in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
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
  heldPreview,
  placeAt,
  requirePlaced,
  sortedFaces,
} from "./roster";

/** The tower placed. Its local radiators are N, S and E (specs/towers.md). */
const TOWER = "rime";

/** The four steps specs/towers.md fixes, and no fifth. */
const STEPS = [0, 1, 2, 3];

/**
 * The world faces each step must report, written out rather than derived, because
 * this is the item that decides the `N -> E -> S -> W` mapping over a full cycle.
 * Local N, S and E turned one step give E, W and S; two give S, N and W; three
 * give W, E and N.
 */
const WORLD_FACES: Record<number, string[]> = {
  0: ["E", "N", "S"],
  1: ["E", "S", "W"],
  2: ["N", "S", "W"],
  3: ["E", "N", "W"],
};

/** The key specs/controls.md binds `rotate` to, and the only one. */
const ROTATE_KEY = BINDINGS.rotate[0];

/** Money far above four Rimes, so no placement is refused for the purse. */
const PURSE = 100 * costOf(TOWER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Four rotations give four face sets", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const built = STEPS.map((rotation, index) => {
    const at = freeSite(index);
    return {
      rotation,
      id: requirePlaced(
        placeAt(h, TOWER, at.col, at.row, rotation),
        `placing a ${TOWER} at rotation ${rotation}`,
      ),
    };
  });

  await h.advance(1);
  captureStill(h, "cycle");
  const read = h.snapshot();

  for (const { rotation, id } of built) {
    const tower = towerOf(read, id);
    assertEqual(
      tower.rotation,
      rotation,
      `the rotation a ${TOWER} placed at rotation ${rotation} reports`,
    );
    assertDeepEqual(
      sortedFaces(tower.radiatorFaces),
      WORLD_FACES[rotation],
      `the world radiator faces of a ${TOWER} placed at rotation ${rotation}, ` +
        `whose local radiators are N, S and E`,
    );
  }

  // ---- And there is no fifth step -----------------------------------------
  const spare = freeSite(STEPS.length);
  h.debug.setArmed(TOWER);
  h.debug.setPreview(spare.col, spare.row);
  h.debug.setPreviewRotation(0);
  await h.advance(1);

  for (const step of STEPS) {
    await h.tap(ROTATE_KEY);
    assertEqual(
      heldPreview(h, `after ${step + 1} presses of ${ROTATE_KEY}`).rotation,
      (step + 1) % STEPS.length,
      `the held rotation after ${step + 1} press(es) of ${ROTATE_KEY} from 0, ` +
        `which walks 1, 2, 3 and back to 0 without ever reaching ` +
        `${STEPS.length} (specs/building.md, Rotating the preview)`,
    );
  }
});
