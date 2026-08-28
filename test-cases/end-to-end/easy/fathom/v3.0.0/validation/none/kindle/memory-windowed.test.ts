// kindle/memory-windowed — hidden, but not forgotten.
//
// `specs/sensing.md`: the vision circle "is a rendering mask and it senses
// nothing. It reveals no tile and remembers no tile", and "ground beyond `R` is
// painted with the same flat fog as never-revealed ground, and it stays
// remembered underneath. Returning to it draws it again, dim, with any uneaten
// plankton still on it." `specs/state.md` says the same from the other side: "The
// vision circle is a rendering mask over that and reveals nothing, so a
// remembered tile outside the circle still reports `r`."
//
// Three readings, and no two of them can be swapped for each other:
//
//   1. The tile inside the circle, drawn.
//   2. The forager beyond `R` of it — `visibility` still `r` while the pixel
//      there is the flat fog. This is the HIDDEN half, and it is what separates
//      the mask from a build that simply forgot the tile.
//   3. The forager back inside `R` — drawn again, and drawn the SAME, which is
//      what "with any uneaten plankton still on it" comes to on the canvas.
//
// Without (1) and (3) the point would be passed by a build that never draws that
// ground at all; without (2) it would be passed by a build with no circle, which
// draws the tile the whole way through and satisfies "returning draws it again"
// while having hidden nothing.
//
// THE TILE IS READ FROM THE REMEMBERED BAND, past the light pocket and inside the
// circle, so what draws it at (1) and (3) is the circle rather than the light.
//
// THE FORAGER IS MOVED BY POSE, NOT BY SWIMMING. Every berth costs the pellet
// underfoot and one pellet is `BRIGHT_PER_EAT` of brightness, which widens `R` by
// `KINDLE_VISION_GAIN * 0.34` — enough to pull the far berth back inside the
// circle. So each berth eats its own pellet off camera and puts `G` back to zero
// (`specs/instrumentation.md`), and the distances are read against the `R` the
// build reports at the moment of each reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { poseMaze, visibilityAt } from "../fixtures";
import {
  captureReplay,
  colorDistance,
  createHarness,
  tileColor,
  windowRadius,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAllExcept,
  parkForager,
  sceneGuard,
  sceneHeld,
  startPlaying,
} from "../scene";
import type { TileRef } from "../maze";
import { FOG_MATCH, tileFromForager } from "./_kindle";

/**
 * The board: one long corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `T` is the tile that is watched and `M` the berth beside it that reveals it.
 * `H` is the near berth, `NEAR_TILES` from `T` — past the light pocket and inside
 * the circle. `A` is the away berth, `AWAY_TILES` from `T`, past the circle at
 * any brightness. `S` is the fog reference.
 */
const ART = ["H....TM.........A" + " ".repeat(8) + "S.."] as const;

/** How far the near berth stands from the watched tile, in tiles. */
const NEAR_TILES = 5; // 160 units: past V (96), inside R (192)

/** How far the away berth stands from it, in tiles. */
const AWAY_TILES = 11; // 352 units: past R at G = 1 (320)

/** The review item's bound on "drawn", as an RGB distance out of `441`. */
const DRAWN_MIN = FOG_MATCH;

/** Ticks the forager stands at each berth, so the build has drawn what it lit. */
const SETTLE_TICKS = 4;

/** Extra ticks each station is held for, so the recording is watchable. */
const DWELL_TICKS = 40;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a tile remembered while the circle hides it, and draws it again on the way back", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const watched = board.mark("T");
  const unlit = board.mark("S");
  const near = board.mark("H");
  const away = board.mark("A");
  const quiet = await denAllExcept(h);

  /** Rest the forager at a berth, put `G` back to zero, and let it draw. */
  const restAt = async (tile: TileRef): Promise<void> => {
    await parkForager(h, tile);
    await clearUnderfoot(h);
    await h.advance(SETTLE_TICKS);
  };

  // Reveal the watched tile from the berth beside it, then take up the near
  // station the readings are taken from.
  await restAt(board.mark("M"));
  if (visibilityAt(await h.snapshot(), watched) === "u") {
    // Whether the forager's light reveals the ground around it is
    // `fog/light-line-of-sight`'s verdict; with nothing revealed there is no
    // remembered tile for this point to hide and bring back.
    h.unmet(
      "the forager's light left the neighbouring corridor tile unrevealed, so " +
        "this scenario has no explored ground to hide — whether the light " +
        "reveals at all is the fog checks' verdict, not this one's",
    );
  }
  await restAt(near);
  const guard = await sceneGuard(h, quiet);

  const seen = await captureReplay(h, "memory", async () => {
    await h.advance(DWELL_TICKS);
    const atFirst = await h.snapshot();
    const drawn = await tileColor(h, atFirst, watched);
    const fog = await tileColor(h, atFirst, unlit);

    // Beyond the circle.
    await restAt(away);
    await h.advance(DWELL_TICKS);
    const beyond = await h.snapshot();
    const hidden = await tileColor(h, beyond, watched);

    // And back inside it.
    await restAt(near);
    await h.advance(DWELL_TICKS);
    const back = await h.snapshot();
    const redrawn = await tileColor(h, back, watched);

    return { atFirst, drawn, fog, beyond, hidden, back, redrawn };
  });

  assertNull(
    sceneHeld(await h.snapshot(), guard),
    "the scenario held to the end",
  );

  // The fixture's own geometry at each station, against the circle the build
  // reports there.
  const first = tileFromForager(seen.atFirst, watched);
  assertGreaterThan(
    first,
    seen.atFirst.visionRadius,
    `the logical units between the near station and the watched tile ` +
      `(${NEAR_TILES} tiles), which must exceed the light pocket V so the circle ` +
      "rather than the light is what draws it",
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
    `the ${AWAY_TILES} tiles from the away station to the watched tile, against ` +
      "the vision circle R reported there",
  );

  // 1. Drawn, inside the circle.
  assertEqual(
    visibilityAt(seen.atFirst, watched),
    "r",
    `the watched tile at (${watched.tx}, ${watched.ty}) from the near station`,
  );
  assertGreaterThan(
    colorDistance(seen.drawn, seen.fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the watched tile inside the circle and " +
      "unrevealed fog",
  );

  // 2. Hidden, not forgotten.
  assertEqual(
    visibilityAt(seen.beyond, watched),
    "r",
    `the watched tile at (${watched.tx}, ${watched.ty}) once the forager stands ` +
      "beyond the circle: the circle is a mask and forgets nothing",
  );
  assertLessThanOrEqual(
    colorDistance(seen.hidden, seen.fog),
    FOG_MATCH,
    "the RGB distance out of 441 between the watched tile beyond the circle and " +
      "unrevealed fog, which it is painted with while it is out there",
  );

  // 3. Drawn again, and drawn the same.
  assertGreaterThan(
    colorDistance(seen.redrawn, seen.fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the watched tile once the forager is " +
      "back inside the circle and unrevealed fog",
  );
  assertLessThanOrEqual(
    colorDistance(seen.redrawn, seen.drawn),
    FOG_MATCH,
    "the RGB distance out of 441 between the watched tile as it is redrawn and " +
      "as it was drawn before it was hidden, with any uneaten plankton still on it",
  );
});
