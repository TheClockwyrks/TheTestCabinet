// towers/rotation-cycles-through-four — four steps, four different face sets, and
// the fourth step comes back to the first.
//
// `specs/towers.md`, Footprints and rotation: "A tower carries a placement rotation
// of `0`, `1`, `2`, or `3`, each a further 90-degree step ... The rotation turns
// the local faces into world faces in the order `N -> E -> S -> W`, so rotation `1`
// turns a local `N` into a world `E`, rotation `2` into a world `S`, and rotation
// `3` into a world `W`." `specs/building.md`, Rotating the preview: rotating
// "advances the held rotation one step through `0`, `1`, `2`, `3` and back to `0`".
//
// THE RIME IS THE TOWER, and the choice is the whole design of this check. Its
// local radiators are N, S and E — three faces, so the set is asymmetric under
// every turn — and the four steps therefore name four DIFFERENT world sets:
// `{N,E,S}`, `{E,S,W}`, `{S,W,N}` and `{W,N,E}`, each one omitting a different
// face. Every wrong model reads as a different set, and the failure names which:
// a build that turns the wrong way reads `{W,N,E}` where `{E,S,W}` is due, a build
// that ignores the rotation reads `{N,E,S}` four times, and a build that turns by
// half-steps or two at a time lands on the set two rows down. An opposed pair like
// the Arc's could not do this: `{N,S}` maps onto `{E,W}` at rotation `1` and back
// at rotation `2`, so two of the four steps would be indistinguishable by design.
// The coarse question — that a rotation moves the faces at all — is
// `towers/rotation-turns-the-faces`'s, on exactly that tower.
//
// THE FOUR SETS ARE POSED AS FOUR TOWERS, one per step, each on its own quiet
// anchor, so a failure names the step that was wrong rather than merely that one
// was. `addTower` takes the placement rotation directly
// (`specs/instrumentation.md`), which is the shortest route to the scenario: what
// a PLACEMENT does with a held rotation is `building/placed-at-the-held-rotation`'s
// requirement.
//
// ROTATION 4 IS NOT REACHABLE, AND THE ONLY WAY TO ASK IS TO STEP. The surface
// carries no operation that advances a rotation — `setPreviewRotation` sets one of
// the four — so the wrap is read where the specification puts it, on a held
// preview driven by the player's own rotate action four times over. The rotation
// read back after each press is `1`, `2`, `3`, `0`: a build that let the counter
// run reads `4` on the fourth press, and one that stopped at the ceiling reads `3`.
// A tower is never placed here, so nothing about placement is in this reading.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison, because nothing
// in the specification fixes the ORDER `radiatorFaces` lists them in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { worldRadiators, type Rotation } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  startRun,
  tapAction,
  type Harness,
} from "../harness";
import { heldPreview } from "./probes";

/** The tower under test: local radiators N, S and E, asymmetric under every turn. */
const TYPE = "rime";

/** The four steps `specs/towers.md` fixes, and the only four there are. */
const STEPS: readonly Rotation[] = [0, 1, 2, 3];

/** Money above the held type's cost, so the preview stays armed while it turns. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("gives the four rotations four different world face sets, and comes back to the first on the fourth step", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  /* ---- Four towers, one per step ---------------------------------------- */

  const posed: { rotation: Rotation; id: number }[] = [];
  for (const [index, rotation] of STEPS.entries()) {
    const at = freeSite(index);
    posed.push({
      rotation,
      id: await poseIdleTower(h, TYPE, at.col, at.row, { rotation }),
    });
  }

  await h.debug.setSelected(posed[1].id);
  await h.advance(1);
  await captureStill(h, "cycle");

  const standing = await h.snapshot();
  const seen: string[] = [];
  for (const { rotation, id } of posed) {
    const tower = requireTower(
      standing,
      id,
      `the ${TYPE} at rotation ${rotation}`,
    );
    const faces = [...tower.radiatorFaces].sort();
    assertEqual(
      tower.rotation,
      rotation,
      `the placement rotation the ${TYPE} added at rotation ${rotation} reports`,
    );
    assertDeepEqual(
      faces,
      [...worldRadiators(TYPE, rotation)].sort(),
      `the world radiator faces of a ${TYPE} at rotation ${rotation}, whose ` +
        "local radiators specs/towers.md gives as N, S and E",
    );
    for (const [index, earlier] of seen.entries()) {
      assertNotEqual(
        faces.join(""),
        earlier,
        `the face set at rotation ${rotation} against the one at rotation ` +
          `${STEPS[index]} — specs/towers.md's four steps give this tower four ` +
          "different sets",
      );
    }
    seen.push(faces.join(""));
  }

  /* ---- And the fourth step comes back to the first ----------------------- */

  await h.debug.setArmed(TYPE);
  await h.debug.setPreviewRotation(STEPS[0]);
  assertEqual(
    (await heldPreview(h)).rotation,
    STEPS[0],
    "the rotation the held preview opens the cycle at",
  );
  for (let step = 1; step <= STEPS.length; step += 1) {
    await tapAction(h, "rotate");
    assertEqual(
      (await heldPreview(h)).rotation,
      STEPS[step % STEPS.length],
      `the held rotation after ${step} rotate press(es) from 0, which ` +
        "specs/building.md advances through 0, 1, 2, 3 and back to 0",
    );
  }
});
