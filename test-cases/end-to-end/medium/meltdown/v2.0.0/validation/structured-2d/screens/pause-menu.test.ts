// Meltdown — screens/pause-menu: the pause screen offers its three rows, over a
// floor that is still drawn.
//
// THE RULE. specs/screens.md, `paused`: "Draws the three rows of `PAUSE_ITEMS`:
// `RESUME`, `RESTART`, and `QUIT TO MENU`. The floor is still drawn behind the
// menu."
//
// TWO READINGS, BOTH NAMED BY THE ITEM. The three rows are looked for as copy
// the frame drew — the package's `drewText` (`../case-harness/text`), by the
// strings the seeded `PAUSE_ITEMS` handed the build; and the floor behind them
// is read as a floor a player can still SEE.
//
// HOW "STILL DRAWN" IS READ, AND WHY IT IS READ THAT WAY. specs/screens.md fixes
// nothing about what a build may draw OVER the floor — a dimming wash, a panel
// behind the rows, a vignette are all art direction — so a check comparing the
// paused screen against the live one would be demanding that nothing was drawn
// over it at all. What the rule does state is that the FLOOR is behind the menu,
// and a floor that is drawn is a floor whose contents reach the pixels. So the
// same patch of floor is photographed twice while the game stays paused, once
// with a tower standing on it and once with that tower gone, and the two must
// differ: a build that draws the floor behind its menu — at any opacity, under
// any wash — shows the tower and then shows it gone, and a build that paints over
// the floor entirely shows the same pixels both times.
//
// THE PATCH IS THE TOWER'S OWN FOOTPRINT, taken from the snapshot the build
// itself reports, so nothing here assumes where a tower is drawn inside it. Every
// pixel of it is read and what the two photographs are asked is where they
// diverge MOST, so a build drawing its towers as thin outlines answers as clearly
// as one drawing them solid. How much of the footprint moved is never counted:
// how a tower is drawn is specs/overview.md's to leave to the build.
//
// THE TOWER IS POSED WITH ONLY WHAT THE READING NEEDS: its guns are held off and
// its heat is `0`, so nothing about it animates between the two photographs and
// the only difference between them is the tower's presence. It stands at the top
// left of the floor, four tiles clear of both vent-to-exhaust corridors
// (specs/floor.md runs them along rows `16`-`19` and columns `22`-`29`) and far
// from the centre a menu is usually drawn in — a patch of floor that is a patch of
// floor and nothing else.
//
// THE FREEZE IS NOT READ HERE. That the floor STOPS while the screen is `paused`
// is `waves.pause-freezes-the-floor`, measured there on the build's own clock,
// because a question about whether time passes belongs on the clock the player's
// game runs on. This item is about what is DRAWN, and a drawing reads the same
// however the clock is driven.
//
// THE SCREEN IS POSED OUTRIGHT over a live run. How the pause screen is REACHED is
// `controls.pause-key` and `controls.esc-pauses`; this item reads the screen.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import { PAUSE_ITEMS, TILE, tileLeft, tileTop } from "../constants";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  renderFrame,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { largestShift, pixelsOver, readScreen, textOf } from "./menu";

/**
 * The footprint's top-left tile: the largest tower in the game, standing clear of
 * both corridors and of the four openings.
 *
 * The Lance's `4`-tile footprint (specs/towers.md) is the biggest patch of floor
 * one tower covers, so wherever inside its footprint a build draws the tower, the
 * patch read below takes the drawing in.
 */
const SITE = { type: "lance", col: 4, row: 4 } as const;

/**
 * How far the footprint has to move between the two photographs for the floor
 * under the menu to have been drawn at all: `8` of the `441` a full swing across
 * the RGB cube is, the floor every reading of the picture in this project takes.
 *
 * An instrument reading presence needs a floor under it, and this one is set so
 * that any drawing of the floor whatsoever clears it: 8 is under two per cent of
 * the scale, so a build that dims the floor behind a heavy wash still shows its
 * tower arrive and leave. A build that painted the floor out altogether shows the
 * same pixels both times and reads 0.
 *
 * specs/overview.md now states the same figure for a thing being visible against
 * what is behind it, and specs/screens.md now says the floor behind this menu is
 * held to it. Both sentences were added after this check was written; they put
 * into words the bar it already used rather than raising it.
 */
const FLOOR_REDRAWN_MIN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws RESUME, RESTART and QUIT TO MENU, with the floor still drawn behind them", async () => {
  startRun(h);
  const id = poseIdleTower(h, SITE.type, SITE.col, SITE.row, 0, 0);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "pause");

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the scenario is posed on",
  );
  const drawn = textOf(runs).join(" | ");
  for (const item of PAUSE_ITEMS) {
    assertTrue(
      drewText(h.calls, item),
      `the ${JSON.stringify(item)} row of PAUSE_ITEMS drawn on the pause ` +
        `menu (specs/screens.md); it drew ${drawn}`,
    );
  }

  const tower = towerById(h.snapshot(), id);
  if (tower === undefined) {
    fail(
      `the tower posed on the floor behind the pause menu to still be on the ` +
        `roster (specs/instrumentation.md, Identity)`,
      h.snapshot().towers.map((entry) => entry.id),
    );
  }
  const footprint = {
    x: tileLeft(tower.col),
    y: tileTop(tower.row),
    w: tower.size * TILE,
    h: tower.size * TILE,
  };

  const withTower = pixelsOver(h, footprint);
  h.debug.removeTower(id);
  await renderFrame(h);
  const withoutTower = pixelsOver(h, footprint);

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen both photographs were taken on",
  );
  assertGreaterThanOrEqual(
    largestShift(withTower, withoutTower),
    FLOOR_REDRAWN_MIN,
    "how far the tower's footprint moved between the tower standing on the " +
      "floor and the tower gone, both photographs taken on the pause screen; " +
      "the floor is still drawn behind the menu (specs/screens.md), and a " +
      "floor painted out altogether reads 0",
  );
});
