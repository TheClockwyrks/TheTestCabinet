// towers/mover-stats — the Forge's and the Sink's rows of the roster.
//
// `specs/towers.md`, The Forge and the Sink: "Both are 2x2, cost `20`, never fire,
// carry no heat, and have no radiator faces at any rotation. They do not rotate.
// Both block their four tiles like any other tower." And the table under it gives
// each one's own figure at level I: the Forge warms an emitter toward a setpoint
// (`FORGE_SETPOINT`) of `72`, the Sink drains it per shared edge-tile at an output
// (`SINK_OUTPUT`) of `16`.
//
// `specs/instrumentation.md` puts both in one snapshot field: `output` is "the
// Forge's setpoint or the Sink's per-edge cooling at this level", and
// `radiatorFaces` is "empty for movers".
//
// WHAT THIS ITEM DECIDES AND WHAT IT LEAVES ALONE. It reads the movers' ROW: the
// two figures that separate them, the shared cost and footprint, and the empty
// face list. What each figure then DOES to a touching emitter — the flow a Forge
// drives, the drain a Sink drives, how either scales with shared edges or with
// level — is the `movers/*` group's, and that a mover fires nothing and carries no
// heat is `movers/forge-does-not-fire`, `movers/sink-does-not-fire` and
// `movers/forge-has-no-heat`. Nothing here reads a heat or a shot.
//
// AT EVERY ROTATION, WHICH IS WHY THERE ARE EIGHT TOWERS AND NOT TWO. "No radiator
// faces at any rotation" is a claim about all four steps, and a build that gave
// its movers the two-face default of an emitter and then turned it would report an
// empty list at no rotation, while a build that special-cased rotation `0` would
// report one at three of them. Each of the four steps is posed as its own tower on
// its own quiet anchor, so a failure names the step.
//
// THE TWO FIGURES ARE READ SIDE BY SIDE ON PURPOSE. `72` and `16` are the same
// field on two types, and the wrong model this arrangement names is a build that
// wired one type's table to the other's — it reads `16` where `72` is due and `72`
// where `16` is, and both halves of the pair fail rather than one.
//
// THE FLOOR HOLDS NOTHING ELSE. `startRun` empties both rosters, and the anchors
// are the quiet ones, six tiles apart, so no mover touches another and none of
// them lengthens a route. A mover posed against an emitter would be a `movers/*`
// scenario; here they stand alone, because a reading of a row does not need one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  MOVER_TYPES,
  moverOutput,
  type Rotation,
  type TowerType,
} from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { moverDefOf } from "./roster";

/** The four placement rotations `specs/towers.md` fixes. */
const STEPS: readonly Rotation[] = [0, 1, 2, 3];

/** The level every figure below is the level-I one of; a posed tower starts here. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("gives both movers the same cost and footprint, no radiator faces at any rotation, and each its own level-I output", async () => {
  await startRun(h);

  // Every pose first, so the picture below holds the whole arrangement and a
  // failing reading still leaves it behind.
  const posed: { type: TowerType; rotation: Rotation; id: number }[] = [];
  let anchor = 0;
  for (const type of MOVER_TYPES) {
    for (const rotation of STEPS) {
      const at = freeSite(anchor);
      anchor += 1;
      posed.push({
        type,
        rotation,
        id: await poseTower(h, type, at.col, at.row, rotation),
      });
    }
  }

  const forge = posed.find((entry) => entry.type === "forge");
  await h.debug.setSelected(forge?.id ?? null);
  await h.advance(1);
  await captureStill(h, "movers");

  const standing = await h.snapshot();
  for (const { type, rotation, id } of posed) {
    const def = moverDefOf(type);
    const where = `the ${type} at rotation ${rotation}`;
    const tower = requireTower(standing, id, where);

    assertEqual(tower.size, def.size, `${where}: the side of its footprint`);
    assertEqual(
      tower.spent,
      def.cost,
      `${where}: its build cost, which specs/instrumentation.md puts into an ` +
        "added tower's spent",
    );
    assertDeepEqual(
      [...tower.radiatorFaces],
      [],
      `${where}: its radiator faces, which specs/towers.md gives a mover at ` +
        "every rotation",
    );
    assertEqual(
      tower.output,
      moverOutput(def, LEVEL),
      `${where}: the level-I figure specs/towers.md gives it — the Forge's ` +
        "setpoint, or the Sink's per-shared-edge cooling",
    );
  }
});
