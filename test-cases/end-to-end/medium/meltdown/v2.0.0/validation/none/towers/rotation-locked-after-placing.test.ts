// towers/rotation-locked-after-placing — a placed tower keeps the orientation it
// landed with, however the preview is turned afterwards.
//
// `specs/building.md`, Rotating the preview: "Rotating changes only the held
// preview. ... A tower's orientation is fixed at the moment it is placed: a placed
// tower's rotation and its world radiator faces never change again."
// `specs/instrumentation.md` closes the other door: "There is no operation that
// rotates a placed tower. Orientation is fixed at placement, so `rotation` is set
// by `addTower` and by the preview's rotation at the moment `place` commits."
// `specs/hud.md` says the inspector "offers no rotate action, because a placed
// tower's orientation is fixed".
//
// THE WRONG MODEL THIS NAMES is a build that keeps ONE rotation — the held one —
// and draws every tower from it, so that turning the preview turns the towers
// already standing. That build passes `towers/rotation-turns-the-faces` and
// `towers/rotation-cycles-through-four` outright, because a tower posed at a
// rotation does report that rotation's faces; it fails only when the preview moves
// on afterwards, which is what this item drives.
//
// THE TOWER IS PLACED RATHER THAN POSED, because the requirement is about the
// moment of PLACEMENT: `place` is what fixes the orientation, so this is one of the
// three items in this group that reaches the act rather than the atom.
//
// THE STUTTER IS THE TOWER. Its local radiators are N and E, an asymmetric pair, so
// each of the four steps names a different pair of world faces — `{N,E}`, `{E,S}`,
// `{S,W}`, `{W,N}`. It is placed at rotation `1`, holding world `{E,S}`, and the
// preview is then turned to `2` and to `3`, whose sets share exactly one face with
// it and one with each other. A build that let the preview reach the placed tower
// therefore reports a DIFFERENT pair at each turn, and the failure names the turn.
//
// THE PREVIEW REALLY IS TURNED, and the placement really is still held while it is.
// `specs/building.md`: "Placement stays armed afterward, at the same type and the
// same rotation, so a second copy drops without arming again", and the purse below
// is far above a second Stutter's cost, so nothing disarms it. The held rotation is
// read back at each turn, so a build that failed to turn the PREVIEW is named for
// that rather than passing this item by never moving anything.
//
// A FRAME RUNS AFTER EACH TURN, so a build that copies the held rotation onto its
// towers inside its update rather than in the operation is caught too.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison, because nothing in
// the specification fixes the ORDER `radiatorFaces` lists them in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import { worldRadiators, type Rotation } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  lastTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./probes";

/** The tower placed: local radiators N and E, so all four steps differ. */
const TYPE = "stutter";

/** The rotation it is placed at, and where. */
const PLACED_AT: Rotation = 1;
const AT = FREE_SITE;

/** The rotations the preview is turned to afterwards, while the tower stands. */
const AFTERWARDS: readonly Rotation[] = [2, 3, 0];

/** Money far above two Stutters, so the placement stays armed while it turns. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the rotation and the world faces it was placed with while the preview turns on", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  // Placed through the real placement path, at the rotation the preview held.
  const before = (await h.snapshot()).towers.length;
  await h.debug.setArmed(TYPE);
  await h.debug.setPreviewRotation(PLACED_AT);
  await h.debug.setPreview(AT.col, AT.row);
  await h.debug.place();
  const committed = await h.snapshot();
  if (committed.towers.length !== before + 1) {
    fail(
      `placing a ${TYPE} on open floor at (${AT.col}, ${AT.row}) to build one ` +
        "tower (specs/building.md, Placing)",
      `the roster went from ${before} towers to ${committed.towers.length}`,
    );
  }
  const id = lastTower(committed)?.id ?? -1;
  const want = [...worldRadiators(TYPE, PLACED_AT)].sort();

  const landed = requireTower(committed, id, `the ${TYPE} as it landed`);
  assertEqual(
    landed.rotation,
    PLACED_AT,
    `the rotation the ${TYPE} landed with, which specs/building.md fixes at ` +
      "the held rotation",
  );
  assertDeepEqual(
    [...landed.radiatorFaces].sort(),
    want,
    `the world radiator faces the ${TYPE} landed with at rotation ${PLACED_AT}`,
  );

  // The preview turns on. The tower does not.
  for (const [index, rotation] of AFTERWARDS.entries()) {
    await h.debug.setPreviewRotation(rotation);
    await h.advance(1);
    if (index === 0) {
      await h.debug.setSelected(id);
      await h.advance(1);
      await captureStill(h, "locked");
    }
    assertEqual(
      (await heldPreview(h)).rotation,
      rotation,
      `the held rotation after turning the still-armed preview to ${rotation}`,
    );

    const standing = requireTower(
      await h.snapshot(),
      id,
      `the placed ${TYPE} while the preview is held at ${rotation}`,
    );
    assertEqual(
      standing.rotation,
      PLACED_AT,
      `the placed ${TYPE}'s own rotation while the preview is held at ` +
        `${rotation}; specs/building.md fixes it at placement`,
    );
    assertDeepEqual(
      [...standing.radiatorFaces].sort(),
      want,
      `the placed ${TYPE}'s world radiator faces while the preview is held at ` +
        `${rotation}, whose own face set would be ` +
        `${JSON.stringify([...worldRadiators(TYPE, rotation)].sort())}`,
    );
  }
});
