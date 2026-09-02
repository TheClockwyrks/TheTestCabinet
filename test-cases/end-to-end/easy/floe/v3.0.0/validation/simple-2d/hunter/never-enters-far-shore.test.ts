// hunter/never-enters-far-shore — the far shore is closed to a bear, on both of
// its rows.
//
// specs/hunter.md closes a tile to a bear when it "Is on row `0` or row `1`, the
// far shore", and a step into a closed tile is refused: "the bear stays settled
// where it is, on the strait and unharmed, and chooses again on the next tick."
// The bays are the critter's business alone; nothing hunting it ever stands among
// them.
//
// BOTH ROWS ARE READ, because the far shore is two rows and a build that closed
// only the bay row would still let a bear onto the solid cap behind it. They are
// one item because they are one rule read at its two edges: a bear on row 2 sent
// up into the bay row, and a bear on row 1 sent up into the cap. The two bears sit
// twenty columns apart on rows nothing else is on, so neither is a bystander in
// the other's reading.
//
// The steps are sent with `setBearStep`, which `specs/instrumentation.md` says
// consults no route: a routed bear would simply never choose these tiles, so what
// would be read is the routing rather than the refusal. Both bears have their
// sense and their routing off, so the step each has is the one it was sent.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_BAYS, WATER_TOP } from "../constants";
import { assertDeepEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { bearStepTile, bearTile } from "./harness";

/** The bear sent up from the top of the water band into the bay row. */
const AT_WATER_COL = 10;
/** The bear sent up from the bay row into the solid cap behind it. */
const AT_BAYS_COL = 30;

/** The game time the refused steps are left standing for. */
const HOLD_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a step up into either row of the far shore", async () => {
  startCrossing(h);
  const frozen = { sense: false, routing: false } as const;
  const atWater = poseBear(h, AT_WATER_COL, WATER_TOP, frozen);
  const atBays = poseBear(h, AT_BAYS_COL, ROW_BAYS, frozen);

  const after = await captureReplay(h, "refuse", async () => {
    h.debug.setBearStep(atWater, "up");
    h.debug.setBearStep(atBays, "up");
    await h.advance(ticksFor(HOLD_SECONDS));
    return h.snapshot();
  });

  const fromWater = bearOf(after, atWater);
  assertDeepEqual(
    bearTile(fromWater),
    { col: AT_WATER_COL, row: WATER_TOP },
    `the tile a bear on row ${WATER_TOP} sent up is left on`,
  );
  assertDeepEqual(
    bearStepTile(fromWater),
    { col: AT_WATER_COL, row: WATER_TOP },
    `the tile it is travelling into, the step into row ${ROW_BAYS} being refused`,
  );

  const fromBays = bearOf(after, atBays);
  assertDeepEqual(
    bearTile(fromBays),
    { col: AT_BAYS_COL, row: ROW_BAYS },
    `the tile a bear on row ${ROW_BAYS} sent up is left on`,
  );
  assertDeepEqual(
    bearStepTile(fromBays),
    { col: AT_BAYS_COL, row: ROW_BAYS },
    `the tile it is travelling into, the step into row 0 being refused`,
  );
});
