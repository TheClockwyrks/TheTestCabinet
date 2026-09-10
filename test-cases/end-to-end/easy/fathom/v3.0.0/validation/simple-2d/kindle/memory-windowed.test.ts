// kindle/memory-windowed — hidden, but not forgotten.
//
// specs/sensing.md: the vision circle "is a rendering mask and it senses nothing.
// It reveals no tile and remembers no tile", and "ground beyond `R` is painted
// with the same flat fog as never-revealed ground, and it stays remembered
// underneath. Returning to it draws it again, dim, with any uneaten plankton
// still on it." specs/state.md says the same from the other side: "The vision
// circle is a rendering mask over that and reveals nothing, so a remembered tile
// outside the circle still reports `r`."
//
// Four readings, and no two of them can be swapped for each other:
//
//   1. The tile inside the circle, drawn.
//   2. The forager beyond `R` of it — `visibility` still `r` while the pixel
//      there is the flat fog. This is the HIDDEN half, and it is what separates
//      the mask from a build that simply forgot the tile.
//   3. The forager back inside `R` — drawn again, and drawn the SAME, which is
//      what "with any uneaten plankton still on it" comes to on the canvas.
//   4. A tile the light has NEVER reached, standing inside `R` at that same
//      moment — `visibility` still `u`, and painted with the flat fog. This is
//      "it reveals no tile" read in the direction the other three cannot reach:
//      the circle is asked whether it SENSES, rather than whether it forgets.
//
// Without (1) and (3) the point would be passed by a build that never draws that
// ground at all; without (2) it would be passed by a build with no circle, which
// draws the tile the whole way through and satisfies "returning draws it again"
// while having hidden nothing; and without (4) it would be passed by a build
// whose circle marks everything it covers as explored, which hides nothing on the
// way out and leaves a maze that fills itself in as the forager swims.
//
// TWO BOUNDS, BECAUSE THE TWO FOG READINGS ARE TAKEN ON DIFFERENT GROUND. The
// hidden tile at (2) stands BEYOND `R`, which specs/sensing.md paints "with the
// same flat fog as never-revealed ground": one flat color, so it is held to
// `MASKED_MATCH`, the mask's own bound. The never-lit tile at (4) stands INSIDE
// the circle, where the same file has never-revealed ground "drawn as fog" and,
// in the same list, "a soft glow in the forager's color" that "fills the
// circle" — so the pixel there is fog under a glow whose strength the
// specification leaves to the build. It is held to `FOG_MATCH`, the bound the
// Kindle review items state for a tile painted with fog, which the glow at the
// circle's edge sits well inside and which remembered terrain, drawn dim on
// purpose, still stands off (`circle.ts` records the margin).
//
// THE TILE IS READ FROM THE REMEMBERED BAND, past the light pocket and inside the
// circle, so what draws it at (1) and (3) is the circle rather than the light.
//
// THE FORAGER IS MOVED BY POSE, NOT BY SWIMMING. A swim between berths would
// graze every pellet on the way, and one pellet is `BRIGHT_PER_EAT` of
// brightness, which widens `R` by `KINDLE_VISION_GAIN * 0.34` — enough to pull
// the far berth back inside the circle. `poseMaze` empties the board of plankton
// and each berth is posed rather than swum to, so no berth raises `G` from the
// `0` a dive opens on, and the distances are read against the `R` the build
// reports at the moment of each reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotEqual,
} from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  visibilityOf,
  type Harness,
  type Rgb,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import {
  DRAWN_FLOOR,
  FOG_MATCH,
  MASKED_MATCH,
  fromFog,
  tileColor,
  tileFromForager,
  windowRadius,
} from "./circle";

/**
 * The board: one long corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `T` is the tile that is watched and `M` the berth beside it that reveals it.
 * `H` is the near berth, `NEAR_TILES` from `T` — past the light pocket and inside
 * the circle. `A` is the away berth, `AWAY_TILES` from `T`, past the circle at
 * any brightness. `U` is the tile no berth's light ever reaches, standing
 * `UNSEEN_TILES` from `A` — past the light pocket there and inside the circle,
 * which is where the fourth reading is taken. `S` is the fog reference.
 */
const ART = ["H....TM....U....A" + " ".repeat(8) + "S.."] as const;

/** How far the near berth stands from the watched tile, in tiles. */
const NEAR_TILES = 5; // 160 units: past V (96), inside R (192)

/** How far the away berth stands from it, in tiles. */
const AWAY_TILES = 11; // 352 units: past R at G = 1 (320)

/**
 * How far the never-lit tile stands from the away berth, in tiles.
 *
 * `160` units: past the `V` of `96` the light reaches at the `G` of `0` every
 * berth is read at, and inside the `R` of `192` the circle covers there. Its
 * other two neighbours in this fixture stand `5` and `11` tiles off, both past
 * `V`, so no station of this scenario ever lights it.
 */
const UNSEEN_TILES = 5;

/**
 * The sensing floor a remembered tile owes against the fog, as an RGB distance
 * out of `441`.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 */
const DRAWN_MIN = DRAWN_FLOOR;

/** Ticks the forager stands at each berth, so the build has drawn what it lit. */
const SETTLE_TICKS = 4;

/** Extra ticks each station is held for, so the recording is watchable. */
const DWELL_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Hidden, but not forgotten", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const watched = board.mark("T");
  const unseen = board.mark("U");
  const unlit = board.mark("S");
  const near = board.mark("H");
  const away = board.mark("A");
  // A plankton on the watched tile and on the never-lit one, which is what a
  // maze is laid out with on every corridor tile (specs/gameplay.md) and what
  // `poseMaze` emptied the board of. Neither is ever eaten: the forager rests on
  // its own berths and never on these.
  h.debug.setPlankton(watched.tx, watched.ty, true);
  h.debug.setPlankton(unseen.tx, unseen.ty, true);

  /** Rest the forager at a berth and let it draw. */
  const restAt = async (tile: { tx: number; ty: number }): Promise<void> => {
    await parkForager(h, tile);
    await h.advance(SETTLE_TICKS);
  };

  // Reveal the watched tile from the berth beside it, then take up the near
  // station the readings are taken from.
  await restAt(board.mark("M"));
  // With nothing revealed there is no remembered tile for this point to hide and
  // bring back, so the reveal is part of what it decides.
  assertNotEqual(
    visibilityOf(h.snapshot(), watched),
    "u",
    "the visibility of the corridor tile beside the berth, which the forager's " +
      "own light reveals — it is the explored ground the circle then hides",
  );
  await restAt(near);
  const watch = await sceneGuard(h);

  const seen = await captureReplay(h, "memory", async () => {
    await h.advance(DWELL_TICKS);
    const atFirst = h.snapshot();
    const drawn: Rgb = tileColor(h, atFirst, watched);
    const fog: Rgb = tileColor(h, atFirst, unlit);

    // Beyond the circle.
    await restAt(away);
    await h.advance(DWELL_TICKS);
    const beyond = h.snapshot();
    const hidden: Rgb = tileColor(h, beyond, watched);
    const neverLit: Rgb = tileColor(h, beyond, unseen);

    // And back inside it.
    await restAt(near);
    await h.advance(DWELL_TICKS);
    const back = h.snapshot();
    const redrawn: Rgb = tileColor(h, back, watched);

    return { atFirst, drawn, fog, beyond, hidden, neverLit, back, redrawn };
  });

  requireSceneHeld(h.snapshot(), watch);

  // The fixture's own geometry at each station, against the circle the build
  // reports there.
  const first = tileFromForager(seen.atFirst, watched);
  assertGreaterThan(
    first,
    seen.atFirst.visionRadius,
    `the logical units between the near station and the watched tile ` +
      `(${NEAR_TILES} tiles), which must exceed the light pocket V so the ` +
      "circle rather than the light is what draws it",
  );
  assertGreaterThan(
    windowRadius(seen.atFirst),
    first,
    `the vision circle R against the ${first.toFixed(0)} units to the watched ` +
      "tile from the near station, which stands inside it",
  );
  const far = tileFromForager(seen.beyond, watched);
  assertGreaterThan(
    far,
    windowRadius(seen.beyond),
    `the ${AWAY_TILES} tiles from the away station to the watched tile, ` +
      "against the vision circle R reported there",
  );

  // 1. Drawn, inside the circle.
  assertEqual(
    visibilityOf(seen.atFirst, watched),
    "r",
    `the watched tile at (${watched.tx}, ${watched.ty}) from the near station`,
  );
  assertGreaterThan(
    fromFog(seen.drawn, seen.fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the watched tile inside the circle " +
      "and unrevealed fog",
  );

  // 2. Hidden, not forgotten.
  assertEqual(
    visibilityOf(seen.beyond, watched),
    "r",
    `the watched tile at (${watched.tx}, ${watched.ty}) once the forager stands ` +
      "beyond the circle: the circle is a mask and forgets nothing",
  );
  assertLessThanOrEqual(
    fromFog(seen.hidden, seen.fog),
    MASKED_MATCH,
    "the RGB distance out of 441 between the watched tile beyond the circle " +
      "and unrevealed fog, which it is painted with while it is out there",
  );

  // 4. And the tile the light never reached, inside the circle all the while.
  const reach = tileFromForager(seen.beyond, unseen);
  assertGreaterThan(
    reach,
    seen.beyond.visionRadius,
    `the ${UNSEEN_TILES} tiles from the away station to the never-lit tile, ` +
      "against the light pocket V reported there, which must fall short of it",
  );
  assertGreaterThan(
    windowRadius(seen.beyond),
    reach,
    `the vision circle R at the away station against the ${reach.toFixed(0)} ` +
      "units to the never-lit tile, which stands inside it",
  );
  assertEqual(
    visibilityOf(seen.beyond, unseen),
    "u",
    `the tile at (${unseen.tx}, ${unseen.ty}), which no light, pulse or flare ` +
      "has reached and which the circle covers: the circle reveals no tile and " +
      "remembers no tile (specs/sensing.md)",
  );
  assertLessThanOrEqual(
    fromFog(seen.neverLit, seen.fog),
    FOG_MATCH,
    "the RGB distance out of 441 between that never-lit tile inside the circle " +
      "and unrevealed fog, which is what ground the light has not reached is " +
      "painted with, under the soft glow that fills the circle (specs/sensing.md)",
  );

  // 3. Drawn again, and drawn the same.
  assertGreaterThan(
    fromFog(seen.redrawn, seen.fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the watched tile once the forager is " +
      "back inside the circle and unrevealed fog",
  );
  assertLessThanOrEqual(
    fromFog(seen.redrawn, seen.drawn),
    FOG_MATCH,
    "the RGB distance out of 441 between the watched tile as it is redrawn and " +
      "as it was drawn before it was hidden, with any uneaten plankton still on it",
  );
});
