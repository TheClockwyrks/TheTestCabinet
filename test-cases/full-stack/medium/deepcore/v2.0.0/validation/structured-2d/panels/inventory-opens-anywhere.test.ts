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
import { PLAYABLE_COL_MIN } from "../constants";
import { assertEqual } from "../assert";
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

afterEach(() => {
  h?.dispose();
});

it("opens the inventory at the camp and deep underground alike", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);
  await h.tap(ACTION_KEY.inventory);
  const atCamp = h.snapshot().panel;

  openScene(h);
  pinDrill(h);
  layFloor(h, DEEP_ROW);
  standOn(h, COL, DEEP_ROW);
  await h.tap(ACTION_KEY.inventory);
  const deep = h.snapshot().panel;
  captureStill(h, "inventory");

  assertEqual(atCamp, "inventory", "specs/ui.md");
  assertEqual(deep, "inventory", "specs/ui.md");
});
