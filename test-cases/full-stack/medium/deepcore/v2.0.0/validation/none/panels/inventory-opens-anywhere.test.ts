// panels/inventory-opens-anywhere — the inventory opens on the surface and deep.
//
// `specs/ui.md`: `inventory` opens anywhere, where the other five open only at
// their buildings. `specs/mining.md` says why it matters — the overlay is what
// sheds weight, and an overload is discovered mid-climb rather than at the camp.
//
// So the same key is pressed twice, once standing at the camp and once standing
// on a floor deep in the mine, and both must open it. The drill is held, because
// nothing here cuts. Nothing is bought or banked in between: a scene is opened
// fresh for each, so the second reading cannot be the first one's panel still
// standing open.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layCamp,
  layFloor,
  openScene,
  pinDrill,
  standAtCamp,
  standOn,
  type Harness,
} from "../harness";

/** A row well below the surface, inside the rockbed at the Standard size. */
const DEEP_ROW = 200;

/** The column the deep floor is stood on. */
const COL = PLAYABLE_COL_MIN + 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the inventory at the camp and deep underground alike", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);
  await h.tap(ACTION_KEY.inventory);
  const atCamp = (await h.snapshot()).panel;

  await openScene(h);
  await pinDrill(h);
  await layFloor(h, DEEP_ROW);
  await standOn(h, COL, DEEP_ROW);
  await h.tap(ACTION_KEY.inventory);
  const deep = (await h.snapshot()).panel;
  await captureStill(h, "inventory");

  assertEqual(atCamp, "inventory", "specs/ui.md");
  assertEqual(deep, "inventory", "specs/ui.md");
});
