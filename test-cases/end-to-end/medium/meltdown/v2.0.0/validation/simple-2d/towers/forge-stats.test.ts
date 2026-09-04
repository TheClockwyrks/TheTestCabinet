// towers/forge-stats — the Forge's row of the roster.
//
// `specs/towers.md`, The Forge and the Sink: "Both are 2x2, cost `20`, never fire,
// carry no heat, and have no radiator faces at any rotation. They do not rotate.
// Both block their four tiles like any other tower." The table under it gives the
// Forge its own figure at level I: it warms an emitter toward a setpoint (`FORGE_SETPOINT`) of `72`.
//
// `specs/instrumentation.md` puts both movers' figure in one snapshot field:
// `output` is "the Forge's setpoint or the Sink's per-edge cooling at this level",
// and `radiatorFaces` is "empty for movers".
//
// ONE MOVER, BECAUSE THE TWO ARE TWO ROWS. `The Sink's row` is
// `towers.sink-stats`'s. `72` and `16` are the same field on two types, and a
// build that wired one type's table to the other's must fail on each row rather
// than lose one point for both.
//
// WHAT THIS ITEM DECIDES AND WHAT IT LEAVES ALONE. It reads the Forge's ROW: its
// cost, its footprint, its empty face list and its level-I output. What that
// figure then DOES to a touching emitter — the flow a Forge drives, the drain a
// Sink drives, how either scales with shared edges or with level — is the
// `movers/*` group's, and that a mover fires nothing and carries no heat is
// `movers/forge-does-not-fire`, `movers/sink-does-not-fire` and
// `movers/forge-has-no-heat`. Nothing here reads a heat or a shot.
//
// AT EVERY ROTATION, WHICH IS WHY THERE ARE FOUR TOWERS AND NOT ONE. "No radiator
// faces at any rotation" is a claim about all four steps, and a build that gave
// its movers the two-face default of an emitter and then turned it would report an
// empty list at no rotation, while a build that special-cased rotation `0` would
// report one at three of them. Each of the four steps is posed as its own tower on
// its own quiet anchor, so a failure names the step.
//
// THE FLOOR HOLDS NOTHING ELSE. `startRun` empties both rosters, and the anchors
// are the quiet ones, six tiles apart, so no mover touches another and none of
// them lengthens a route. A mover posed against an emitter would be a `movers/*`
// scenario; here it stands alone, because a reading of a row does not need one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { costOf, freeSite, moverOutputOf, sortedFaces } from "./roster";

/** The mover this item reads. */
const TYPE = "forge" as const;

/** The figures both movers share, off the case's own seeded table. */
const COST = costOf(TYPE);
const SIZE = 2;

/** The four placement rotations, each of which must leave the face list empty. */
const ROTATIONS = [0, 1, 2, 3];

/** The level a posed tower opens at (specs/instrumentation.md). */
const LEVEL = 1;

/** The level-I output specs/towers.md gives this row. */
const OUTPUT = moverOutputOf(TYPE, LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge carries its stats", async () => {
  startRun(h);

  // The mover alone on a quiet anchor: nothing on this floor drives a flow into
  // anything.
  const at = freeSite(0);
  const id = poseTower(h, TYPE, at.col, at.row);
  h.debug.setSelected(id);
  await h.advance(1);
  captureStill(h, "forge");

  const tower = towerOf(h.snapshot(), id);
  assertEqual(tower.size, SIZE, `the ${TYPE}'s footprint side, in tiles`);
  assertEqual(
    tower.spent,
    COST,
    `the ${TYPE}'s build cost, as the spent a fresh tower opens with`,
  );
  assertEqual(
    tower.output,
    OUTPUT,
    `the ${TYPE}'s level-${LEVEL} output, which specs/towers.md gives as ` +
      `a setpoint of 72`,
  );

  // ---- No radiator faces at ANY rotation ----------------------------------
  for (const rotation of ROTATIONS) {
    startRun(h);
    const site = freeSite(0);
    const turned = poseTower(h, TYPE, site.col, site.row, rotation);
    assertDeepEqual(
      sortedFaces(towerOf(h.snapshot(), turned).radiatorFaces),
      [],
      `the world radiator faces of a ${TYPE} at rotation ${rotation}, which ` +
        `specs/towers.md leaves empty at every rotation`,
    );
  }
});
