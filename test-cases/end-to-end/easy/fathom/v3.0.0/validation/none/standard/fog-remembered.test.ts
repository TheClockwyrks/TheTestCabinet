// standard/fog-remembered — the whole explored map stays drawn.
//
// `specs/sensing.md`, in the Standard dive: "The whole explored map stays drawn.
// Every tile ever revealed keeps being drawn, across the entire grid at once,
// remembered tiles dim and the pocket around the forager bright. The tiles drawn
// black are the never-revealed ones." A remembered tile is drawn "rock as dark
// stone, corridor as faint open water, and any plankton on it as a faint mote",
// and `specs/state.md` has it keep reporting `r`.
//
// So there is exactly one thing to prove, and it is a NEGATIVE: nothing masks the
// explored map by distance. The Kindle dive is the same game with that mask added,
// which is what makes this point worth its own check — a build that carried the
// Kindle circle into the Standard dive would report `r` for the tile and paint it
// black, and every reading short of the canvas would agree with the specification.
//
// THE BOARD IS POSED so "far away" is a fact of the fixture rather than of the
// maze a build laid out. The forager lights a pocket at one end of a long
// corridor, and is then rested at the other end, `SWUM_TILES` tiles off — past
// `V` at its very widest (`VISION_MIN + VISION_GAIN`, 160) many times over, so
// nothing the forager carries reaches the tile that is read.
//
// TWO TILES ARE READ, AND BOTH HALVES ARE NEEDED. The corridor tile still carries
// its plankton — the forager grazes only the tile its own center is on
// (`specs/gameplay.md`), so a tile it merely lit keeps its mote — and that mote
// against the faint floor is what a player sees out there, read at the tile's
// center where `specs/gameplay.md` draws it. Beside it, the ROCK tile above the
// forager's own berth is read, which carries no mote and can carry none: it is
// the TERRAIN, "rock as dark stone" (`specs/sensing.md`). A build that masked the
// explored ground by distance and went on drawing the motes over the mask would
// pass the first reading and fail the second.
//
// THE COMPARISON IS AGAINST THIS BUILD'S OWN FOG, sampled off a sealed pocket of
// the same fixture that nothing has ever touched. The palette is the build's
// (`specs/overview.md` leaves it so), so the question is whether the two tiles
// are drawn DIFFERENTLY, not what color either one is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import { VISION_GAIN, VISION_MIN } from "../constants";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  tileColor,
  type Harness,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { tileCenter, type Tile, visibilityAt } from "../maze";

/**
 * The board: a long corridor with the forager's home at one end, the tile that is
 * read two tiles along it, the far berth at the other end, and — across eight
 * tiles of solid rock — a sealed three-tile pocket nothing can ever reach.
 *
 * `H` home, `T` the tile that is read, `B` the far berth, `S` the fog reference.
 */
const ART = ["H.T" + ".".repeat(17) + "B" + " ".repeat(8) + "S.."] as const;

/** How far `T` sits from `H`, in tiles: inside `V` at `G = 0` (96, three tiles). */
const LIT_TILES = 2;

/** How far `B` sits from `T`, in tiles. */
const SWUM_TILES = 18;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

/**
 * The sensing floor the remembered tile owes against the unrevealed one, as an RGB
 * distance out of `441`.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 */
const DRAWN_MIN = 8;

/** Ticks the forager stands at each berth, so the build has drawn what it lit. */
const SETTLE_TICKS = 4;

/** How far above the home berth the rock tile that is read sits, in tiles. */
const ROCK_OFFSET = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps drawing explored ground however far the forager swims from it", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("H");
  const target = board.mark("T");
  const berth = board.mark("B");
  const unlit = board.mark("S");
  // The rock directly above the home berth: revealed by the forager's own light
  // while it stood there, and terrain rather than a mote, because no plankton sits
  // on rock (`specs/gameplay.md`).
  const rock: Tile = { tx: home.tx, ty: home.ty - ROCK_OFFSET };

  // A plankton on the tile that is read, which the forager is never carried
  // over: `specs/sensing.md` draws a remembered corridor tile as faint open
  // water "and any plankton on it as a faint mote", so the tile carries what a
  // remembered tile of a laid-out maze carries.
  await h.debug.setPlankton(target.tx, target.ty, true);

  // Light the pocket at home. The board is bare under the forager and `G` is
  // the zero a dive opens on, so the light that reveals `T` is the one a dive
  // opens with rather than one this arrangement widened.
  await parkForager(h, home);
  await h.advance(SETTLE_TICKS);
  const lit = await h.snapshot();
  for (const tile of [target, rock]) {
    assertNotEqual(
      visibilityAt(lit, tile),
      "u",
      `the visibility of the tile at (${tile.tx}, ${tile.ty}) with the ` +
        `forager's light on it — the corridor ${LIT_TILES} tiles ahead and the ` +
        "rock it lands on are the explored ground this point then reads",
    );
  }

  // And rest it at the far end of the corridor, its own pellet eaten there too.
  await parkForager(h, berth);
  const guard = await sceneGuard(h);
  await h.advance(SETTLE_TICKS);

  const after = await h.snapshot();
  const remembered = await tileColor(h, after, target);
  const rockColor = await tileColor(h, after, rock);
  const fog = await tileColor(h, after, unlit);
  // Before the assertions, so a check that fails still leaves the picture that
  // shows the reviewer what the build drew out there.
  await captureStill(h, "remembered");

  requireSceneHeld(after, guard);

  // The fixture's own geometry, asserted rather than assumed: the tile that is
  // read stands further off than the light reaches at ANY brightness.
  const at = tileCenter(after.grid, target);
  assertGreaterThan(
    Math.hypot(at.x - after.forager.x, at.y - after.forager.y),
    VISION_MAX,
    "the logical units between the forager and the remembered tile, which must " +
      `exceed V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );

  // What the build SAYS about the two tiles.
  assertEqual(
    visibilityAt(after, target),
    "r",
    `the corridor tile at (${target.tx}, ${target.ty}), revealed earlier and no ` +
      "longer lit",
  );
  assertEqual(
    visibilityAt(after, rock),
    "r",
    `the rock tile at (${rock.tx}, ${rock.ty}), revealed earlier and no longer lit`,
  );
  assertEqual(
    visibilityAt(after, unlit),
    "u",
    `the sealed tile at (${unlit.tx}, ${unlit.ty}), which nothing has touched`,
  );

  // And what it DRAWS there, a whole corridor away from the forager.
  assertGreaterThan(
    colorDistance(remembered, fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the remembered corridor tile at " +
      `(${target.tx}, ${target.ty}), ${SWUM_TILES} tiles behind the forager, and ` +
      "unrevealed fog: explored ground stays drawn however far off it lies",
  );
  assertGreaterThan(
    colorDistance(rockColor, fog),
    DRAWN_MIN,
    `the RGB distance out of 441 between the remembered rock tile at ` +
      `(${rock.tx}, ${rock.ty}) and unrevealed fog: the terrain of the explored ` +
      "map stays drawn too, with no mote on it to stand in for it",
  );
});
