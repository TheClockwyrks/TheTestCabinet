// save/runs-without-storage — the game plays perfectly well with nowhere to save.
//
// specs/expedition.md: "The save is held in the browser. The game runs correctly
// when that storage is unavailable, simply without saving." This point decides
// the RUNS half of that sentence: the game stands up, draws, starts an
// expedition, descends and cuts, and nothing throws on the way.
//
// THE REFUSAL IS ITS OWN POINT. `save/no-storage-refuses-the-save` decides that
// the title carries no `CONTINUE` and that the Save Pad reports the refusal, so a
// build that survives the missing storage and then claims a save it never wrote
// grades differently from one that dies on the way up.
//
// HOW THE STORAGE IS TAKEN AWAY is `save/no-storage`, which shuts every door the
// same way a browser shuts them.
//
// ISOLATION. One expedition, started from the title the way a player starts one,
// on the mine the build generated for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  MODE_ITEMS,
  SIZE_ITEMS,
  TILE,
  TITLE_ITEMS_NO_SAVE,
} from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  drawOps,
  driveCut,
  driveFall,
  openScene,
  type Harness,
} from "../harness";
import { thrownBy, withoutStorage } from "./no-storage";

/** Where each choice sits on its own menu, with no save to lead the title. */
const NEW_EXPEDITION = TITLE_ITEMS_NO_SAVE.indexOf("NEW EXPEDITION");
const STANDARD_MODE = MODE_ITEMS.indexOf("STANDARD");
const STANDARD_SIZE = SIZE_ITEMS.indexOf("STANDARD");

/** The shaft the descent runs down, and the cell the drill bites at its foot. */
const DIG_COL = 10;
const SHAFT_TOP = 2;
const SHAFT_BOTTOM = 20;
const FLOOR_ROW = SHAFT_BOTTOM + 1;
const DROP_HEIGHT = 8 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands up, starts an expedition and digs without ever throwing", async () => {
  await withoutStorage(h);
  await openScene(h, { screen: "title" });

  const title = await h.frameCalls();
  assertGreaterThan(
    drawOps(title),
    0,
    "specs/overview.md: the game draws a frame with no storage behind it",
  );

  // A full start, the way a player starts one.
  await h.debug.setMenuIndex(NEW_EXPEDITION);
  await h.tap(ACTION_KEY.activate);
  await h.debug.setMenuIndex(STANDARD_MODE);
  await h.tap(ACTION_KEY.activate);
  await h.debug.setMenuIndex(STANDARD_SIZE);
  await h.tap(ACTION_KEY.activate);
  assertEqual(
    (await h.snapshot()).screen,
    "in-mine",
    "specs/ui.md: choosing a size begins the expedition",
  );

  await digShaft(h, DIG_COL, SHAFT_TOP, SHAFT_BOTTOM);
  const played = await captureReplay(h, "no-storage", async () => {
    const fall = await driveFall(h, DIG_COL, FLOOR_ROW, DROP_HEIGHT);
    const cut = await driveCut(h, "down", { col: DIG_COL, row: FLOOR_ROW });
    return { fall, cut };
  });

  assertEqual(
    played.fall.landed,
    true,
    "the drop reached the floor of the shaft",
  );
  assertEqual(
    played.cut.broke,
    true,
    "the drill cut through the floor of the shaft",
  );
  assertDeepEqual(
    thrownBy(h),
    [],
    "specs/expedition.md: nothing throws when the storage is unavailable",
  );
});
