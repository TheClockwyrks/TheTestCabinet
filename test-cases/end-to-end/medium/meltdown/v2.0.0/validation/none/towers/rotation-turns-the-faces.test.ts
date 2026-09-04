// towers/rotation-turns-the-faces — a quarter turn moves a tower's radiator faces
// a quarter turn.
//
// `specs/towers.md`, Footprints and rotation: "Radiator faces are given below in
// the tower's local orientation, which is its orientation at rotation `0`. ... The
// rotation turns the local faces into world faces in the order `N -> E -> S -> W`,
// so rotation `1` turns a local `N` into a world `E` ... A tower's radiator faces
// are reported and drawn in world orientation."
// `specs/instrumentation.md` says the same of the field this reads:
// `radiatorFaces` are "world-oriented, so they name the faces that point outward
// after the tower's placement rotation".
//
// THE ARC IS THE TOWER, and `test-case.toml` names it for a reason worth stating:
// its local radiators are N and S, an OPPOSED pair, so one quarter turn moves both
// of them onto the other axis — `{N,S}` becomes `{E,W}` — and the two readings
// share no face at all. Nothing about this reading is subtle, and that is the
// point: this item is the `broken`-capped one, the coarse question of whether a
// rotation reaches the faces at all. A build that reports its LOCAL faces whatever
// the rotation reads `{N,S}` twice; a build that turns them reads two disjoint
// pairs.
//
// WHAT IT DOES NOT DECIDE. Which way round the four steps go, and that all four are
// distinct, is `towers/rotation-cycles-through-four`'s, on a tower whose faces are
// asymmetric — an opposed pair cannot tell rotation `1` from rotation `3`, because
// both map `{N,S}` onto `{E,W}`. That a rotation survives a placement is
// `towers/rotation-locked-after-placing`'s, and what a radiator face is WORTH in
// the heat model is `heat/radiator-sheds-more`'s. This reads the report.
//
// TWO TOWERS, POSED SIDE BY SIDE. Both are added at the same moment on quiet
// anchors six tiles apart, so neither abuts the other and the pair is one reading
// rather than two runs that might differ for some other reason. The guns are off:
// walling, firing and heat are none of this requirement's business, and the faces
// are reported whatever the tower is doing.
//
// THE FACES ARE COMPARED AS A SET, sorted before the comparison. Nothing in the
// specification fixes the ORDER `radiatorFaces` lists them in — it fixes which
// faces are in the list — so a build that reports the same two faces in its own
// order is conformant and passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { worldRadiators, type Rotation } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The tower under test: local radiators N and S, an opposed pair. */
const TYPE = "arc";

/** The two steps this item contrasts. */
const LOCAL: Rotation = 0;
const TURNED: Rotation = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reports world radiator faces E and W at rotation 1 where rotation 0 reports N and S", async () => {
  await startRun(h);

  const localSite = freeSite(0);
  const turnedSite = freeSite(1);
  const unturned = await poseIdleTower(h, TYPE, localSite.col, localSite.row, {
    rotation: LOCAL,
  });
  const turned = await poseIdleTower(h, TYPE, turnedSite.col, turnedSite.row, {
    rotation: TURNED,
  });

  await h.debug.setSelected(turned);
  await h.advance(1);
  await captureStill(h, "turned");

  const posed = await h.snapshot();
  for (const [id, rotation] of [
    [unturned, LOCAL],
    [turned, TURNED],
  ] as const) {
    const tower = requireTower(
      posed,
      id,
      `the ${TYPE} at rotation ${rotation}`,
    );
    assertEqual(
      tower.rotation,
      rotation,
      `the placement rotation the ${TYPE} added at rotation ${rotation} reports`,
    );
    assertDeepEqual(
      [...tower.radiatorFaces].sort(),
      [...worldRadiators(TYPE, rotation)].sort(),
      `the world radiator faces of a ${TYPE} at rotation ${rotation}, whose ` +
        "local radiators specs/towers.md gives as N and S",
    );
  }
});
