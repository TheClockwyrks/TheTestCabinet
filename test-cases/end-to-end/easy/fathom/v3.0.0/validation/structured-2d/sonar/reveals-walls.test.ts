// sonar/reveals-walls — the flood follows the corridors, takes the rock with it,
// and stops.
//
// specs/sensing.md: "Each open tile within `E` corridor steps of the origin is
// revealed as the front reaches it, near tiles before far ones, together with the
// rock tiles bounding those corridors, so a flooded passage is drawn as corridor
// and rock rather than as floor alone. The flood follows the corridors, so it
// reaches around corners and through junctions, and it enters no space rock seals
// off."
//
// FOUR CLAIMS ON ONE BOARD, because they are only decidable together. A build
// that lights a disc around the forager passes "the corridors were revealed" and
// fails the sealed pocket; one that reveals floor alone passes the corridors and
// fails the rock; one that floods without a range passes everything and fails the
// tile past `E`; one that stops at the first bend fails the corner. So the
// fixture carries all four at once: a junction three steps out with a branch
// running off it, a corner six steps out with a leg running down, a corridor tile
// ten steps out — one past the `9` `E` is at depth `1` — and a three-tile pocket
// twelve tiles away that no corridor joins.
//
// EVERY TILE READ IS OUT PAST THE FORAGER'S OWN LIGHT, except the handful nearest
// it that the flood covers anyway. The pocket stands `12` tiles off and the tile
// past the range `7.2` tiles, against a light pocket of `V = 96` (three tiles) at
// the `G = 0` this scenario parks the forager at — and the pocket is walled in
// besides, so no light traces to it however a build casts one.
//
// WHAT THIS DOES NOT DECIDE. WHEN each tile is revealed, which is
// `sonar/near-before-far`'s; and what `E` is at a given depth, which is
// `progression/depth-scaling`'s — the fixture is drawn against the depth-1 range
// the scenario reads off the pulse itself.

import { afterEach, beforeEach } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { SONAR_RANGE_BASE } from "../../src/constants";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  visibilityAt,
  type Harness,
} from "../harness";
import type { Tile } from "../maze";
import {
  check,
  clearUnderfoot,
  denAll,
  parkForager,
  requireScene,
  sceneGuard,
} from "../scene";
import { emitPulse, foragerPulse } from "./pulse";

/**
 * The board: the forager's corridor with a junction and a corner on it, a leg
 * running one tile past the range, and a sealed pocket across twelve tiles of
 * rock.
 *
 * `F` is the forager, `J` the junction, `K` the end of its branch, `C` the
 * corner, `D` the last tile inside the range, `Y` the first tile past it, and `P`
 * the sealed pocket.
 */
const ART = [
  "F..J..C     P..",
  "   .  .",
  "   K  .",
  "      D",
  "      Y",
] as const;

/**
 * Every open tile within `E` corridor steps of the forager, as offsets from it.
 *
 * Walked out along the fixture: six steps right to the corner and three down its
 * leg, and two down the junction's branch. `D` is the ninth step, which is the
 * last one a depth-1 pulse reaches.
 */
const FLOODED: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 0],
  [6, 0],
  [3, 1],
  [3, 2],
  [6, 1],
  [6, 2],
  [6, 3],
];

/**
 * Rock the flood must take with it, as offsets from the forager.
 *
 * Each of these sits beside a tile the front sweeps over, and each stands more
 * than the `96` units of the light pocket from the forager — `163`, `224`, `186`,
 * `243` and `136` — so a build that reveals them has done it with the pulse.
 */
const BOUNDING_ROCK: readonly (readonly [number, number])[] = [
  [5, 1],
  [7, 0],
  [5, 3],
  [7, 3],
  [3, 3],
];

/** The tile one corridor step past the range, as an offset from the forager. */
const BEYOND = [6, 4] as const;

/** The sealed pocket, as offsets from the forager. */
const POCKET: readonly (readonly [number, number])[] = [
  [12, 0],
  [13, 0],
  [14, 0],
];

/**
 * How long the flood is given to finish, in ticks.
 *
 * A hard ceiling. A conforming front passes the depth-1 range of `9` steps
 * `9 / SONAR_WAVE_SPEED` seconds — `77` ticks — after the press, so a build whose
 * flood merely crawls FAILS on the tiles it never reached rather than leaving the
 * point undecided.
 */
const FLOOD_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "floods the corridors around a corner and through a junction with their rock, and enters neither a sealed pocket nor a tile past E",
  async () => {
    startPlaying(h);
    const board = await poseMaze(h, ART);
    const home = board.mark("F");
    await parkForager(h, home);
    await clearUnderfoot(h);
    const quiet = await denAll(h);
    const watch = await sceneGuard(h, quiet);

    const at = (offset: readonly [number, number]): Tile => ({
      tx: home.tx + offset[0],
      ty: home.ty + offset[1],
    });

    const emitted = await emitPulse(h);
    // The fixture is drawn for the depth this scenario runs at; a pulse carrying
    // some other range would be measuring a different board.
    assertEqual(
      emitted.pulse.range,
      SONAR_RANGE_BASE,
      "the range the depth-1 pulse this fixture is drawn for carries",
    );

    const swept = await h.until(
      (snapshot) => foragerPulse(snapshot) === undefined,
      {
        maxFrames: FLOOD_TICKS,
        poll: 1,
      },
    );
    // A beat past the pulse leaving the list, so what is read is the fog it left
    // rather than the tick it left on.
    await h.advance(2);
    const snapshot = h.snapshot();
    // Before the assertions, so a failing check still leaves the picture a
    // reviewer needs to see which half of the board went wrong.
    captureStill(h, "walls");

    requireScene(snapshot, watch);
    assertEqual(
      swept.hit,
      true,
      `the pulse ran out within ${FLOOD_TICKS} ticks, of the 77 a front at ` +
        "SONAR_WAVE_SPEED takes to pass a range of 9",
    );

    for (const offset of FLOODED) {
      const tile = at(offset);
      assertNotEqual(
        visibilityAt(snapshot, tile),
        "u",
        `the corridor tile at (${tile.tx}, ${tile.ty}), ${offset[0] + offset[1]} ` +
          "or fewer corridor steps out and inside the flood",
      );
    }

    for (const offset of BOUNDING_ROCK) {
      const tile = at(offset);
      assertNotEqual(
        visibilityAt(snapshot, tile),
        "u",
        `the rock tile at (${tile.tx}, ${tile.ty}), which bounds a corridor the ` +
          "front swept over",
      );
    }

    const beyond = at(BEYOND);
    assertEqual(
      visibilityAt(snapshot, beyond),
      "u",
      `the corridor tile at (${beyond.tx}, ${beyond.ty}), which is ` +
        `${SONAR_RANGE_BASE + 1} corridor steps out and so one past the range`,
    );

    for (const offset of POCKET) {
      const tile = at(offset);
      assertEqual(
        visibilityAt(snapshot, tile),
        "u",
        `the corridor tile at (${tile.tx}, ${tile.ty}), inside a pocket rock seals ` +
          "off from every corridor the flood travels",
      );
    }
  },
);
