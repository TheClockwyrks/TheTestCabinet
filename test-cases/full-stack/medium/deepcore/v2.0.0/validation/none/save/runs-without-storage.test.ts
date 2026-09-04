// save/runs-without-storage — the game plays perfectly well with nowhere to save.
//
// specs/gameplay.md: "The save is held in the browser. The game runs correctly
// when that storage is unavailable, simply without saving." A browser refuses the
// storage in ordinary circumstances — a private window, third-party cookies
// blocked, a quota already spent — so this is a path real players walk, and a
// build that reaches for it unguarded throws on the way up and shows nothing at
// all.
//
// HOW THE STORAGE IS TAKEN AWAY. Every door the browser offers is shut before a
// line of the build's script runs, and shut the way a browser shuts them: reading
// `localStorage` or `sessionStorage` throws a `SecurityError`, which is what
// Chromium itself does when site data is blocked, and `indexedDB` is simply not
// there. The page is then reloaded so the build initializes against that, since
// what is being read is whether the build survives having no storage FROM THE
// START rather than losing it midway.
//
// WHAT "RUNS CORRECTLY" IS READ AS. Four things, and each of them fails a
// different broken build: the page threw nothing and logged no error; the title
// carries no `CONTINUE`, because there is no save to continue; a full start, a
// real descent and a real cut all run; and activating the Save Pad leaves
// `hasSave` false rather than claiming a save that was never written.
//
// ISOLATION. One expedition, started from the title the way a player starts one,
// on the mine the build generated for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  MODE_ITEMS,
  SIZE_ITEMS,
  TILE,
  TITLE_ITEMS,
  TITLE_ITEMS_NO_SAVE,
} from "../constants";
import {
  ACTION_KEY,
  HANDLE,
  captureReplay,
  createHarness,
  digShaft,
  drawOps,
  drewText,
  driveCut,
  driveFall,
  openScene,
  standAtBuilding,
  type Harness,
} from "../harness";
import { menuLength } from "./expedition";

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

/** How long the surface is waited for after the page comes back. */
const RELOAD_TIMEOUT_MS = 20_000;

/**
 * Shut every browser store the save could be held in, then reload onto that.
 *
 * The init script runs before any of the page's own script, and survives the
 * reload, so the build initializes in a browser that has never had storage.
 */
async function withoutStorage(h: Harness): Promise<void> {
  await h.page.addInitScript(() => {
    const deny = (name: string): void => {
      Object.defineProperty(window, name, {
        configurable: true,
        get(): never {
          throw new DOMException("storage is unavailable", "SecurityError");
        },
      });
    };
    deny("localStorage");
    deny("sessionStorage");
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => undefined,
    });
  });
  await h.page.reload({ waitUntil: "load" });
  await h.page.waitForFunction(
    (handle) => (window as unknown as Record<string, unknown>)[handle] != null,
    HANDLE,
    { timeout: RELOAD_TIMEOUT_MS },
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts, digs and refuses a save without ever throwing", async () => {
  await withoutStorage(h);
  await openScene(h, { screen: "title" });

  const opened = await h.snapshot();
  assertEqual(
    opened.hasSave,
    false,
    "specs/gameplay.md: there is no save while the storage is unavailable",
  );
  const title = await h.frameCalls();
  assertGreaterThan(
    drawOps(title),
    0,
    "specs/overview.md: the game draws a frame with no storage behind it",
  );
  assertEqual(
    drewText(title, TITLE_ITEMS[0]),
    false,
    "specs/ui.md: the title carries no CONTINUE with no save to continue",
  );
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is NEW EXPEDITION and HOW TO PLAY",
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
    await standAtBuilding(h, "save-pad");
    await h.advance(1);
    await h.tap(ACTION_KEY.activate);
    return { fall, cut, snapshot: await h.snapshot() };
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
  assertEqual(
    played.snapshot.hasSave,
    false,
    "specs/gameplay.md: the game runs simply without saving",
  );
  assertEqual(
    played.snapshot.screen,
    "in-mine",
    "specs/gameplay.md: the refused save leaves the game running in the mine",
  );
  // What the build threw or logged, which is what "runs correctly" turns on. A
  // browser asks every page it opens for a favicon and a static build is free to
  // ship none, so a resource that 404s is the page's network log rather than the
  // build failing, and it is left out of the reading.
  const thrown = h.pageErrors.filter(
    (message) => !/failed to load resource/i.test(message),
  );
  assertDeepEqual(
    thrown,
    [],
    "specs/gameplay.md: nothing throws when the storage is unavailable",
  );
});
