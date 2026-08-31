// Meltdown — screens/pause-menu: the pause screen offers its three rows, over a
// floor that is still drawn.
//
// THE RULE. specs/screens.md, `paused`: "Draws the three rows of `PAUSE_ITEMS`:
// `RESUME`, `RESTART`, and `QUIT TO MENU`. The floor is still drawn behind the
// menu."
//
// TWO READINGS, BOTH NAMED BY THE ITEM. The three rows are looked for as runs of
// text, by the copy the seeded `PAUSE_ITEMS` handed the build; and the floor
// behind them is read as a floor a player can still SEE.
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
// itself reports, so nothing here assumes where a tower is drawn inside it.
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
import { PAUSE_ITEMS, TILE, tileLeft, tileTop } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  renderFrame,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { differing, pixelsOver, readScreen, requireRun } from "./menu";

/**
 * The footprint's top-left tile: the largest tower in the game, standing clear of
 * both corridors and of the four openings.
 *
 * The Lance's `4`-tile footprint (specs/towers.md) is the biggest patch of floor
 * one tower covers, which is what makes the presence-or-absence reading below a
 * reading of a large area rather than of a few dozen pixels.
 */
const SITE = { type: "lance", col: 4, row: 4 } as const;

/**
 * How far apart two renders of the same patch must be to count as different:
 * `4` of the `441` a full swing across the RGB cube is.
 *
 * It is deliberately small. specs/screens.md requires the floor to be drawn
 * behind the menu and says nothing about how strongly a build may wash over it,
 * so a build that dims the floor to a tenth of its contrast has still drawn it —
 * and this reading has to pass that build while failing one that painted the
 * floor out altogether.
 */
const VISIBLE_DISTANCE = 4;

/**
 * How much of the footprint must read differently: a twentieth of its pixels.
 *
 * A tower drawn on the floor covers its footprint (specs/hud.md draws its heat
 * read across it), so a build showing one is showing far more than this; the
 * floor is set low so that a build drawing its towers as outlines, or under a
 * heavy wash, still clears it. A mark smaller than a twentieth of a `4`-tile
 * footprint is not a tower.
 */
const MIN_CHANGED_FRACTION = 0.05;

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
  for (const item of PAUSE_ITEMS) {
    requireRun(runs, item, "the pause menu");
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
    differing(withTower, withoutTower, VISIBLE_DISTANCE),
    Math.round(withTower.length * MIN_CHANGED_FRACTION),
    "pixels of the footprint that read differently with the tower standing on " +
      "the floor and with it gone, both taken on the pause screen",
  );
});
