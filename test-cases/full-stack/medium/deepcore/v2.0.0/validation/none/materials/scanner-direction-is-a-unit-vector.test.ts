// materials/scanner-direction-is-a-unit-vector — the bearing points at the node.
//
// `specs/instrumentation.md` fixes `dirX` and `dirY` as "a unit direction to the
// target", and `specs/ui.md` says what it is for: the indicator draws a
// direction to the locked material. So the node is posed in each of the four
// directions from the miner in turn and two things are read at each: that the
// vector's length is `1`, and that its sign follows which way the node lies.
// `specs/world.md` fixes the axes, `x` increasing to the right and `y` downward,
// so a node further down the column is a positive `dirY`.
//
// The offset is twelve tiles along one axis, so whether a build measures from
// the miner's cell centre or from its continuous position the component across
// the axis is at most half a tile in twelve — under `0.05` either way — and the
// signs the check reads are the ones the specification fixes rather than an
// artefact of where inside its cell the box happens to sit.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { captureStill, createHarness, standOn, type Harness } from "../harness";
import {
  clearNode,
  minerCell,
  openScanner,
  poseNode,
  settled,
} from "./scanner-scene";

/** The column and row the miner is read from, with twelve tiles clear each way. */
const HOME_COL = 16;
const HOME_ROW = 40;

/** How far along one axis each node is posed. */
const REACH = 12;

/** How far the across-axis component may sit from zero: half a tile in twelve. */
const ACROSS_MAX = 0.1;

/** How near the along-axis component must be to a full unit. */
const ALONG_MIN = 0.98;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a unit vector whose signs follow where the node lies", async () => {
  await openScanner(h, 3);
  await standOn(h, HOME_COL, HOME_ROW);
  const me = minerCell(await settled(h));

  const bearings = [
    { name: "east", cell: { col: me.col + REACH, row: me.row } },
    { name: "west", cell: { col: me.col - REACH, row: me.row } },
    { name: "below", cell: { col: me.col, row: me.row + REACH } },
    { name: "above", cell: { col: me.col, row: me.row - REACH } },
  ];

  for (const bearing of bearings) {
    await poseNode(h, bearing.cell, "resonite");
    const at = await settled(h);
    if (bearing.name === "east") await captureStill(h, "bearing");
    const { locked, dirX, dirY } = at.scanner;
    assertEqual(locked, true, `specs/mining.md, node ${bearing.name}`);
    assertCloseTo(
      Math.hypot(dirX, dirY),
      1,
      2,
      `specs/instrumentation.md, node ${bearing.name}`,
    );

    const along =
      bearing.name === "east" || bearing.name === "west" ? dirX : dirY;
    const across =
      bearing.name === "east" || bearing.name === "west" ? dirY : dirX;
    const forward = bearing.name === "east" || bearing.name === "below";
    if (forward) {
      assertGreaterThan(
        along,
        ALONG_MIN,
        `specs/world.md, node ${bearing.name}`,
      );
    } else {
      assertLessThan(along, -ALONG_MIN, `specs/world.md, node ${bearing.name}`);
    }
    assertLessThan(
      Math.abs(across),
      ACROSS_MAX,
      `specs/world.md, node ${bearing.name}`,
    );
    await clearNode(h, bearing.cell);
  }
});
