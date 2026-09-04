// save/runs-without-storage — the game plays perfectly well with nowhere to save.
//
// specs/gameplay.md: "The save is held in the browser. The game runs correctly
// when that storage is unavailable, simply without saving." A browser refuses the
// storage in ordinary circumstances — a private window, third-party cookies
// blocked, a quota already spent — so this is a path real players walk, and a
// build that reaches for it unguarded throws on the way up and shows nothing at
// all.
//
// HOW THE STORAGE IS TAKEN AWAY. Every door is shut before the engine is built,
// so the build initializes against a host that never had one, and shut the way a
// browser shuts them: reading `localStorage` or `sessionStorage` THROWS a
// `SecurityError`, which is what Chromium does when site data is blocked, and
// `indexedDB` is simply not there. A getter that throws is deliberately harsher
// than an absent global, because a build guarding with `typeof localStorage` and
// nothing else passes the absent case and still dies in a real browser.
//
// WHAT "RUNS CORRECTLY" IS READ AS. Four things, and each of them fails a
// different broken build: nothing threw, from the moment the engine was built to
// the end of the drive; the title carries no `CONTINUE`, because there is no save
// to continue; a full start, a real descent and a real cut all run; and activating
// the Save Pad leaves `hasSave` false rather than claiming a save that was never
// written.
//
// A THROW IS REPORTED RATHER THAN RAISED. The whole scenario runs inside a catch,
// so a build that dies on the storage fails this point with the specification on
// the `Expected:` line and its own error beside it, rather than with a stack the
// reviewer has to interpret.
//
// ISOLATION. One expedition, started from the title the way a player starts one,
// on the mine the build generated for it.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS, SIZE_ITEMS, TILE, TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  drawOps,
  drewText,
  driveCut,
  driveFall,
  openScene,
  removeStorage,
  standAtBuilding,
  type DrawCall,
  type Harness,
} from "../harness";
import { TITLE_ITEMS_NO_SAVE, menuLength } from "./expedition";

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

/** What the specification requires of a build on a host with no storage. */
const REQUIREMENT =
  "specs/gameplay.md: the game runs correctly when the browser storage is " +
  "unavailable, simply without saving";

/** Shut every store the save could be held in, the way a browser shuts them. */
function denyStorage(): void {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get(): never {
        const refusal = new Error("storage is unavailable");
        refusal.name = "SecurityError";
        throw refusal;
      },
    });
  }
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get: () => undefined,
  });
}

/** Put the stores back as a Node process leaves them: absent, and quiet about it. */
function restoreStorage(): void {
  removeStorage();
  for (const name of ["sessionStorage", "indexedDB"]) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

/** How a thrown value reads on the `Actual:` line. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Run `step`, reporting anything it threw as this point's failure. */
async function ran<T>(what: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    fail(REQUIREMENT, `${what} threw ${describe(error)}`);
  }
}

let h: Harness | undefined;

beforeEach(() => {
  denyStorage();
});

afterEach(() => {
  h?.dispose();
  h = undefined;
  restoreStorage();
});

it("starts, digs and refuses a save without ever throwing", async () => {
  h = await ran("standing the game up", () => createHarness());
  const game = h;

  let title: DrawCall[] = [];
  await ran("opening the title", async () => {
    openScene(game, { screen: "title" });
    title = await game.frameCalls();
  });

  assertEqual(
    game.snapshot().hasSave,
    false,
    "specs/gameplay.md: there is no save while the storage is unavailable",
  );
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
    await ran("stepping the title menu", () => menuLength(game)),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is NEW EXPEDITION and HOW TO PLAY",
  );

  // A full start, the way a player starts one.
  await ran("starting an expedition from the title", async () => {
    game.debug.setMenuIndex(NEW_EXPEDITION);
    await game.tap(ACTION_KEY.activate);
    game.debug.setMenuIndex(STANDARD_MODE);
    await game.tap(ACTION_KEY.activate);
    game.debug.setMenuIndex(STANDARD_SIZE);
    await game.tap(ACTION_KEY.activate);
  });
  assertEqual(
    game.snapshot().screen,
    "in-mine",
    "specs/ui.md: choosing a size begins the expedition",
  );

  digShaft(game, DIG_COL, SHAFT_TOP, SHAFT_BOTTOM);
  const played = await captureReplay(game, "no-storage", () =>
    ran("descending, cutting and activating the Save Pad", async () => {
      const fall = await driveFall(game, DIG_COL, FLOOR_ROW, DROP_HEIGHT);
      const cut = await driveCut(game, "down", {
        col: DIG_COL,
        row: FLOOR_ROW,
      });
      standAtBuilding(game, "save-pad");
      await game.advance(1);
      await game.tap(ACTION_KEY.activate);
      return { fall, cut, snapshot: game.snapshot() };
    }),
  );

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
});
