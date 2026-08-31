// Meltdown — screens/pause-menu: the pause screen offers its three entries, over
// a floor that is still drawn.
//
// THE RULE. `specs/screens.md`, on `paused`: it "Draws the three rows of
// `PAUSE_ITEMS`: `RESUME`, `RESTART`, and `QUIT TO MENU`. The floor is still drawn
// behind the menu."
//
// TWO READINGS OF THE SAME SCREEN. The copy, from the frame's own text runs; and
// the floor behind it, from the pixels the frame left on the canvas. A build whose
// pause menu is missing a row fails the first; one that pauses to a blank screen,
// which is the defect the second half of the sentence exists to catch, fails the
// second.
//
// THE COPY IS MATCHED BY SUBSTRING, and each row is asserted separately, so a
// build that drew two of the three fails with the missing one named. Substring
// because the words are the case's and the presentation is the build's: a row is
// commonly drawn with a marker or padding beside it, and requiring the exact run
// would fail a menu showing precisely the right words.
//
// HOW "STILL DRAWN" IS READ, AND WHY IN PIXELS. `specs/overview.md` fixes no
// palette, `specs/screens.md` fixes no layout for the menu, and nothing forbids a
// build from veiling the floor to push the menu forward — a dim floor behind a
// pause menu is the ordinary way to draw one. What a veil cannot do and still
// satisfy the sentence is hide the floor altogether. So what is read is CONTRAST
// INSIDE THE REACTOR REGION on the paused frame: two towers each against the bare
// floor beside them, and the casing band against the floor it rings
// (`specs/floor.md`). A build still drawing the reactor behind its menu keeps some
// of that contrast however hard it dims; a build drawing a flat panel over the
// whole region reads 0 everywhere.
//
// THE STRONGEST PROBE DECIDES, not all of them, because no specification fixes
// where the pause menu sits or how large it is. A build entitled to draw its menu
// across the middle of the floor would cover a probe there, and failing it for a
// layout the specification left open would be reading the build's design rather
// than the requirement. The probes are spread to the floor's opposite corners and
// to its edge band precisely so that a menu of any reasonable size leaves one of
// them showing.
//
// THE TWO TOWERS ARE POSED WITH EVERY FACULTY OFF. Neither firing nor the thermal
// model has anything to do with whether a floor is drawn
// (`specs/instrumentation.md`), and a tower left running would drift in heat and
// so in colour between the pose and the reading. The quiet anchors of
// `fixtures.ts` keep both footprints off the two corridors, so neither changes a
// route either.
//
// THE SCREEN IS POSED, because what the pause screen DRAWS does not depend on how
// a player got to it — that `pause` opens it is `controls.pause-opens-the-pause-
// screen`'s reading, and where each row leads is `screens.pause-resume`'s,
// `screens.pause-restart`'s and `screens.pause-quit`'s. Whether the floor FREEZES
// while it is up is `waves.pause-freezes-the-floor`'s, measured on the build's own
// clock; this point reads only that the floor is still on the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { CASING, PAUSE_ITEMS, tileCX, tileCY, type Tile } from "../constants";
import { BOXED_SITE, FREE_SITE } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  drewText,
  poseTower,
  requireTower,
  sampleColor,
  sampleTile,
  sampleTower,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far apart, out of the 441 the RGB cube spans, the strongest probe inside the
 * reactor must read on the paused frame.
 *
 * `specs/screens.md` asks only that "the floor is still drawn behind the menu" and
 * fixes neither a palette nor how far a build may dim what it draws behind an
 * overlay, so all a check may lean on is that the picture is still THERE. 6 is
 * under a seventieth of the scale — about the smallest step that reads as a
 * difference at all, and low enough that even a heavy veil, which multiplies every
 * contrast under it by what it leaves through, cannot fail an honest build. A
 * build that stopped drawing the reactor reads exactly 0 on every probe, because
 * every probe is then reading one flat colour twice.
 */
const FLOOR_BEHIND_MIN = 6;

/** The tower posed at each site: the Lance, whose 4x4 is the largest footprint. */
const PROBE_TOWER = "lance" as const;

/**
 * Where the floor beside a footprint is read, as an offset in tiles from the
 * footprint's top-left.
 *
 * Geometry, not a tolerance. The Lance covers four tiles on each axis, so `+6` is
 * two clear tiles past its far edge: off the tower, and near enough that a build
 * shading its floor across the reactor is compared against the shade beside the
 * tower rather than against one on the other side of the room.
 */
const BESIDE = 6;

/** Bare floor tiles for the casing probe, clear of both posed footprints. */
const BARE: readonly Tile[] = [
  { col: 44, row: 6 },
  { col: 15, row: 12 },
];

/**
 * Where the casing band is read: the middle of the left band at two heights, and
 * the middle of the top band.
 *
 * `specs/floor.md` puts the band `CASING` (`18`) units thick along all four sides
 * and says it "is drawn unbroken except at those four openings", so the middle of
 * the band is on the wall wherever it is read. Row `5` and row `30` are clear of
 * the left vent's rows `16..19`, and column `10` is clear of the top vent's
 * columns `22..29`.
 */
const CASING_POINTS: readonly { x: number; y: number }[] = [
  { x: CASING / 2, y: tileCY(5) },
  { x: CASING / 2, y: tileCY(30) },
  { x: tileCX(10), y: CASING / 2 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws all three pause entries with the floor still behind them", async () => {
  const { debug } = h;
  await startRun(h);

  // Two towers at opposite ends of the floor, neither firing nor exchanging heat,
  // so the picture the paused frame draws cannot move between the pose and the
  // reading.
  const sites: readonly Tile[] = [FREE_SITE, BOXED_SITE];
  const ids: number[] = [];
  for (const site of sites) {
    const id = await poseTower(h, PROBE_TOWER, site.col, site.row);
    await debug.setTowerFiring(id, false);
    await debug.setTowerThermal(id, false);
    ids.push(id);
  }

  await debug.setScreen("paused");
  const calls = await h.frameCalls();
  await captureStill(h, "pause");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the pause menu is read on");
  assertEqual(
    posed.towers.length,
    sites.length,
    "the towers on the paused floor",
  );

  for (const [row, item] of PAUSE_ITEMS.entries()) {
    assertEqual(
      drewText(calls, item),
      true,
      `the pause menu drew ${item}, row ${row} of ${PAUSE_ITEMS.length}`,
    );
  }

  // Every probe inside the reactor, as a pair of colours the paused frame drew.
  const probes: { what: string; a: Rgb; b: Rgb }[] = [];
  for (const [index, id] of ids.entries()) {
    const tower = requireTower(
      posed,
      id,
      `the ${PROBE_TOWER} at probe ${index}`,
    );
    const body = await sampleTower(h, tower);
    for (const [dc, dr] of [
      [BESIDE, 0],
      [0, BESIDE],
    ] as const) {
      probes.push({
        what: `the ${PROBE_TOWER} at (${tower.col}, ${tower.row}) against the floor at (${tower.col + dc}, ${tower.row + dr})`,
        a: body,
        b: await sampleTile(h, tower.col + dc, tower.row + dr),
      });
    }
  }
  for (const point of CASING_POINTS) {
    const wall = await sampleColor(h, point.x, point.y);
    for (const tile of BARE) {
      probes.push({
        what: `the casing at (${point.x}, ${point.y}) against the floor at (${tile.col}, ${tile.row})`,
        a: wall,
        b: await sampleTile(h, tile.col, tile.row),
      });
    }
  }

  const read = probes.map((probe) => ({
    what: probe.what,
    moved: colorDistance(probe.a, probe.b),
  }));
  const best = read.reduce((strongest, probe) =>
    probe.moved > strongest.moved ? probe : strongest,
  );
  assertGreaterThanOrEqual(
    best.moved,
    FLOOR_BEHIND_MIN,
    `the strongest contrast inside the reactor on the paused frame, which was ` +
      `${best.what} at ${best.moved.toFixed(1)}; the floor is still drawn ` +
      `behind the menu ` +
      `(specs/screens.md), and a screen with nothing drawn behind it reads 0 on ` +
      `every one of the ${probes.length} probes`,
  );
});
