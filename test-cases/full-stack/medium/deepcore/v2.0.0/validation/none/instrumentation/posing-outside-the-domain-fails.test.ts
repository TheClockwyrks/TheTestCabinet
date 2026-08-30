// instrumentation/posing-outside-the-domain-fails — a pose aimed at a cell the
// domain does not hold is refused rather than quietly dropped.
//
// `specs/instrumentation.md`: "An argument outside the domain this file states
// for it is invalid, and the call fails loudly rather than guessing what was
// meant. So is a call whose subject is not in the condition the operation
// states, such as a cell outside the grid". The domain the same file states for
// a pose is `col` from `0` to `WORLD_COLS - 1` and `row` from `1` to `coreRow`,
// and it adds that "`row 0` is the camp and is not posed".
//
// WHY THIS IS ITS OWN POINT. A pose that silently does nothing is the worst
// answer a debug surface can give: the scenario a later reading is taken against
// was never arranged, so the reading reports a defect in the game that is really
// a defect in the surface. The surface is a deliverable, so the refusal is
// graded like any other behaviour.
//
// Each of the four posing operations is aimed past each of the four edges of the
// domain, and every cell is read back afterwards exactly as it stood before — a
// build that threw and posed anyway fails here too. The camp row is one of the
// four, and it is the reason the read-back compares against what was there
// rather than against the shape of a cell outside the grid: `row 0` is a real
// cell that simply may not be posed.

import { afterEach, beforeEach, it } from "vitest";
import { WORLD_COLS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** Where the miner stands while the attempts are made, clear of every edge. */
const COL = 6;
const ROW = 12;

/** The ore and the material an attempt names; neither ever reaches a cell. */
const ORE = "ferron" as const;
const MATERIAL = "resonite" as const;

/** The health an attempt names, inside the domain for any minable cell. */
const HEALTH = 1;

/** Run `attempt` and require it to be refused. */
async function refuses(
  attempt: () => Promise<unknown>,
  context: string,
): Promise<void> {
  let threw = false;
  try {
    await attempt();
  } catch {
    threw = true;
  }
  assertEqual(threw, true, context);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses every posing operation aimed outside the stated domain", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await h.advance(2);
  captureStill(h, "loud");

  const before = await h.snapshot();
  const outside: readonly (readonly [number, number])[] = [
    [-1, ROW],
    [WORLD_COLS, ROW],
    [COL, 0],
    [COL, before.coreRow + 1],
  ];

  for (const [col, row] of outside) {
    const at = `(${col}, ${row})`;
    const stood = await h.tileAt(col, row);

    await refuses(
      () => h.debug.setTile(col, row, "rock"),
      `specs/instrumentation.md: setTile ${at} is outside the pose domain`,
    );
    await refuses(
      () => h.debug.setOreTile(col, row, ORE),
      `specs/instrumentation.md: setOreTile ${at} is outside the pose domain`,
    );
    await refuses(
      () => h.debug.setMaterialTile(col, row, MATERIAL),
      `specs/instrumentation.md: setMaterialTile ${at} is outside the pose domain`,
    );
    await refuses(
      () => h.debug.setTileHealth(col, row, HEALTH),
      `specs/instrumentation.md: setTileHealth ${at} is outside the pose domain`,
    );

    // Nothing was posed on the way out. The cell reads exactly as it did, and
    // the scanner still has no target, which a posed node would have given it.
    const after = await h.snapshot();
    assertDeepEqual(
      await h.tileAt(col, row),
      stood,
      `the cell at ${at} after the refusals`,
    );
    assertDeepEqual(
      after.scanner,
      before.scanner,
      `specs/instrumentation.md: no node was posed at ${at}`,
    );
    assertEqual(
      after.coreRow,
      before.coreRow,
      `the mine's depth after the refusals at ${at}`,
    );
  }

  // The cell the miner is standing on is untouched, so nothing landed anywhere.
  assertEqual(
    (await h.tileAt(COL, ROW)).kind,
    "rock",
    "the cell the scene posed is as it was",
  );
});
