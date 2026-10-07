// towers/footprint-2x2 — a 2x2 tower blocks its four tiles and no others, and its
// centre is the footprint's centre.
//
// `specs/towers.md`, Footprints and rotation: "A tower occupies a square footprint
// of 2x2, 3x3, or 4x4 tiles, anchored and measured as `specs/floor.md` states.
// Range is measured from the footprint's centre." `specs/mazing.md`: "A tower
// blocks every tile of its footprint from the frame it lands until the frame it
// leaves". `specs/instrumentation.md` anchors an added tower by "its footprint's
// top-left at tile `(col, row)`", so an Arc anchored at `(10, 10)` occupies
// `(10..11, 10..11)` and nothing else.
//
// TWO READINGS, BECAUSE THE SIZE HAS TWO CONSEQUENCES: which tiles the footprint
// takes off the floor, and where the point every range is measured from sits.
//
// THE EXTENT IS READ THROUGH THE GAME'S OWN PLACEMENT CHECK, in both directions.
// `specs/instrumentation.md` states that "there is no operation that asks whether
// a footprint could be placed" and that `build.valid` answers it "through the same
// check", so a 2x2 preview held at each anchor around the tower reads invalid
// exactly on the anchors whose four tiles meet the tower's. The grid of those
// answers pins the extent from both sides at once: over the twenty-five anchors
// scanned, the nine that meet a true 2x2 become four for a build that blocked its
// anchor tile alone and sixteen for one that blocked a 3x3, and all twenty-five
// stay valid for a build that blocked nothing. A route length — `mazing/towers-block-tiles`'s reading
// — says that something was blocked and what it cost the surge; it cannot say
// which tiles, and this item's requirement is which tiles.
//
// THE CENTRE IS FOUND BY BISECTING THE TOWER'S OWN RANGE BOUNDARY, in four
// directions, and taking the midpoint of each opposed pair. `specs/combat.md`
// makes the boundary "at most `range * TILE` logical units" from the footprint's
// centre — a distance — so the two boundaries along one axis sit the same distance
// either side of the centre whatever that range turns out to be. That is the whole
// reason for the bisection: a pair of probes placed against the range the roster
// gives would fail a build whose centre is right and whose range is short, and this
// item is not about the range. What the Arc's range comes to is `towers/arc-stats`.
//
// THE WRONG MODEL THIS NAMES is a tower measured from its ANCHOR TILE's centre
// rather than its footprint's. On a 2x2 that is exactly half a tile — `9.5` logical
// units — north-west of the truth, which is nineteen times the band below, and it
// shows up in the reading as an east boundary short by `9.5` and a west boundary
// long by the same.
//
// THE FLOOR HOLDS ONE TOWER AND, FOR THE SECOND READING, ONE TARGET. The tower's
// heat is pinned, so nothing it does while the four rays are walked can trip it or
// move a figure; its guns are on, because targeting is the faculty the second
// reading is taken through. The surge is empty for the first reading, so the
// placement check's unit clause cannot refuse a probe.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { TILE, footprintCentre, type Tile } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type Harness,
} from "../harness";
import { overlaps, poseMark, reachAlong, scanOpenness } from "./probes";
import { sizeOf } from "./roster";

/** The tower under test, and where `test-case.toml` anchors it. */
const TYPE = "arc";
const SIZE = sizeOf(TYPE);
const AT: Tile = { col: 10, row: 10 };

/** The type the openness grid is probed with: the smallest footprint there is. */
const PROBE = "arc";

/** Money far above the probe type's cost, so affordability refuses no probe. */
const PURSE = 2000;

/** The heat the tower is pinned at: the heat a placed tower starts at. */
const PIN_HEAT = 0;

/** The point specs/combat.md measures this tower's range from. */
const CENTRE = footprintCentre(AT.col, AT.row, SIZE);

/**
 * The bracket each of the four rays is bisected inside, in logical units from the
 * footprint's centre.
 *
 * The near end is one tile clear of the footprint's own edge, which is inside
 * every level-I range on the roster and off the tower's own tiles. The far end is
 * `200` units, which is over ten tiles: past the Arc's `6.0` by a wide margin, and
 * still short of the `209` units between this centre and the nearest edge of the
 * floor, so every probe of every ray lands on the grid. Geometry, not a tolerance.
 */
const BRACKET = { near: (SIZE / 2 + 1) * TILE, far: 200 };

/**
 * How many halvings each boundary is bisected to.
 *
 * Twelve takes the `162`-unit bracket down to `0.04` of a logical unit, which is
 * twenty-five times finer than the one unit `specs/combat.md` itself distinguishes
 * at a range boundary.
 */
const STEPS = 12;

/**
 * How far the centre the four rays put the tower at may sit from the footprint's
 * own centre, in logical units.
 *
 * Each boundary is resolved to `0.04` units by the bisection above, and the
 * specification's own granularity at a range boundary is one unit, so this is that
 * granularity and nothing looser. The wrong model it has to exclude — a range
 * measured from the anchor tile's centre — sits `TILE / 2`, `9.5` units, away.
 */
const CENTRE_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blocks the four tiles of its footprint and nothing else, and measures from that footprint's centre", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);
  const id = await posePinnedTower(h, TYPE, AT.col, AT.row, PIN_HEAT);

  /* ---- The extent, through the game's own placement check ---------------- */

  const cells = await scanOpenness(h, PROBE, AT, SIZE);

  await h.debug.setArmed(null);
  await h.debug.setSelected(id);
  await h.advance(1);
  await captureStill(h, "footprint");

  for (const cell of cells) {
    const meets = overlaps(
      { col: cell.col, row: cell.row, size: sizeOf(PROBE) },
      { col: AT.col, row: AT.row, size: SIZE },
    );
    assertEqual(
      cell.valid,
      !meets,
      `a ${sizeOf(PROBE)}x${sizeOf(PROBE)} footprint held at ` +
        `(${cell.col}, ${cell.row}) ${meets ? "meets" : "clears"} the ` +
        `${SIZE}x${SIZE} block at (${AT.col}, ${AT.row}), which covers ` +
        `(${AT.col}..${AT.col + SIZE - 1}, ${AT.row}..${AT.row + SIZE - 1})`,
    );
  }

  /* ---- The centre, from the midpoint of each opposed range boundary ------ */

  const mark = await poseMark(h, TYPE, CENTRE.x + BRACKET.near, CENTRE.y);
  const rays = {
    east: { dx: 1, dy: 0 },
    west: { dx: -1, dy: 0 },
    south: { dx: 0, dy: 1 },
    north: { dx: 0, dy: -1 },
  } as const;
  const reach: Record<keyof typeof rays, number> = {
    east: 0,
    west: 0,
    south: 0,
    north: 0,
  };
  for (const [name, dir] of Object.entries(rays)) {
    reach[name as keyof typeof rays] = await reachAlong(
      h,
      id,
      mark,
      CENTRE,
      dir,
      BRACKET,
      STEPS,
    );
  }

  assertLessThanOrEqual(
    Math.abs((reach.east - reach.west) / 2),
    CENTRE_TOLERANCE,
    `the tower's centre east of the footprint's own centre (${CENTRE.x}), ` +
      `halfway between an east boundary at ${reach.east.toFixed(2)} units and ` +
      `a west boundary at ${reach.west.toFixed(2)}; off by`,
  );
  assertLessThanOrEqual(
    Math.abs((reach.south - reach.north) / 2),
    CENTRE_TOLERANCE,
    `the tower's centre south of the footprint's own centre (${CENTRE.y}), ` +
      `halfway between a south boundary at ${reach.south.toFixed(2)} units and ` +
      `a north boundary at ${reach.north.toFixed(2)}; off by`,
  );
});
