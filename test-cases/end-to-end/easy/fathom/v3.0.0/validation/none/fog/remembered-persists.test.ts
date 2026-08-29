// fog/remembered-persists — revealed terrain is remembered.
//
// `specs/sensing.md` gives the remembered state as a tile "revealed earlier and
// not lit this instant", reported `r` and "drawn dim: rock as dark stone, corridor
// as faint open water, and any plankton on it as a faint mote", and it fixes how
// long that lasts: "Once a tile has been revealed by any source it stays
// remembered for the rest of the current maze, across losing a life included."
//
// So there are three claims and a build can hold any two: the tile turns `r` when
// the light leaves it, it is STILL `r` a long stretch later, and it is still
// DRAWN. The third is the one no `visibility` reading can answer, so it is read
// off the canvas the build painted, against a tile in the same frame that nothing
// has ever revealed.
//
// THE WATCHED TILE IS A ONE-TILE ALCOVE off the corridor the forager swims down.
// It is inside the light pocket at the start, so the light reveals it; the forager
// never enters it, so the plankton the maze laid on it is still there when the
// reading is taken, which is the "any plankton on it as a faint mote" half of what
// a remembered tile draws. Everything on the corridor itself is grazed away by a
// forager swimming along it, and a tile whose contents the scenario ate is not the
// tile this point is about.
//
// THE FOG CONTROL IS THE SAME DISTANCE AWAY. `D` is a sealed pocket the forager
// can neither reach nor light, posed so that it stands almost exactly as far from
// where the forager ends up as the alcove does. Both variants draw a distance-
// dependent picture around the forager — under `kindle` the maze is drawn only
// inside a circle of `KINDLE_VISION_MIN` (`192`) at `G = 0`, with a soft glow
// filling it — so a comparison between two tiles at the same range is the one that
// says something about the fog rather than about the range.
//
// AND THE LIGHT IS PUT BACK TO ITS NARROWEST BEFORE THE READING. The forager
// grazes as it swims, and `G` drives `V` (`specs/sensing.md`), so a forager that
// arrives bright is still lighting the tile it left. `setBrightness(0)` poses `G`
// at the zero a dive opens on and arms the hold in full
// (`specs/instrumentation.md`), so the light is `VISION_MIN` (`96`) for the whole
// reading — narrower than the `131.9` the alcove stands at, and narrower than the
// `192` the kindle circle covers at that same `G`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { ARROW_KEY, TILE, VISION_MIN } from "../constants";
import {
  placeForager,
  poseMaze,
  tileCenterOf,
  tileGap,
  visibilityAt,
} from "../fixtures";
import {
  captureReplay,
  colorDistance,
  createHarness,
  sampleTiles,
  ticks,
  type Harness,
} from "../harness";
import {
  denAllExcept,
  parkForager,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
  startPlaying,
} from "../scene";
import type { TileRef } from "../maze";

/**
 * The board.
 *
 * `A` is the alcove the light reveals and the forager never enters, and the `#`
 * above it is the rock face the same light lands on. `S` is where the forager
 * starts, directly below the alcove. `D` is a sealed pocket four rows down and
 * four columns along, which is where the forager ends up standing above.
 *
 * TWO REMEMBERED TILES ARE READ, because a remembered tile is drawn as two
 * different things and a build can hold either alone: `A` is "corridor as faint
 * open water, and any plankton on it as a faint mote" — its pellet survives
 * because the forager never swims over it — and the rock above it is "rock as dark
 * stone" (specs/sensing.md). Both must still be drawn.
 */
const ART = ["#", "A", "S.........", "", "", "", "    D.."] as const;

/** How many tiles along the corridor the forager swims before the reading. */
const SWIM_TILES = 4;

/**
 * How long the swim is given, in ticks.
 *
 * `SWIM_TILES` tiles is `128` logical units, which `FORAGER_SPEED` (`128`) covers
 * in one second. Three seconds is a wide margin on that and still a hard ceiling,
 * so a build whose forager crawls is stood down rather than waited for.
 */
const SWIM_MAX_TICKS = ticks(3);

/** Ticks run after a pose, so the frame that is read was drawn under it. */
const SETTLE_TICKS = 2;

/**
 * How long the tile is watched after it turns remembered, in ticks.
 *
 * "For the rest of the current maze" has no end this check can wait for, so it
 * asks the same question again after a stretch of real simulation long enough for
 * a build that decays its memory to have decayed it.
 */
const PERSIST_TICKS = ticks(1.5);

/**
 * How far apart the remembered tile and the unrevealed fog must be drawn, as an
 * RGB distance out of the `441` (`sqrt(3) * 255`) that separates black from white.
 *
 * The review point's bound. It is a floor rather than a match: every palette is
 * the build's (`specs/overview.md` fixes only that the trench is dark), so what is
 * asserted is that a remembered tile is drawn as SOMETHING and not painted back
 * into the fog.
 */
const DRAWN_MIN_DISTANCE = 25;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a revealed tile remembered and drawn once the light has moved on", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const alcove: TileRef = board.mark("A");
  // The rock face directly above the alcove: the same light lands on it, so it is
  // remembered too, and it draws terrain alone.
  const rock: TileRef = { tx: alcove.tx, ty: alcove.ty - 1 };
  const start: TileRef = board.mark("S");
  const fog: TileRef = board.mark("D");
  const quiet = await denAllExcept(h);
  await placeForager(h, start, "right");
  await h.debug.setBrightness(0);
  // The forager travels here, so the guard watches the board rather than the tile
  // it was parked on.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  await h.skip(SETTLE_TICKS);
  const opened = await h.snapshot();

  const reading = await captureReplay(h, "memory", async () => {
    const before = await h.snapshot();
    await h.hold(ARROW_KEY.right);
    const swum = await h.until(
      (s) => s.forager.x - before.forager.x >= SWIM_TILES * TILE,
      { maxTicks: SWIM_MAX_TICKS, poll: 1 },
    );
    await h.release(ARROW_KEY.right);
    // Whether the forager swims at all is `controls/*` and `maze-movement/*`'s
    // verdict; this point has nothing to say about a build whose forager stayed
    // where it was put.
    if (!swum.hit) {
      requireSwim(
        h,
        before.forager,
        swum.snapshot.forager,
        `swim ${SWIM_TILES} tiles clear of the tile its light revealed`,
      );
      h.unmet(
        `the forager covered only ` +
          `${(swum.snapshot.forager.x - before.forager.x).toFixed(1)} of the ` +
          `${SWIM_TILES * TILE} logical units this scenario needs in ` +
          `${SWIM_MAX_TICKS} ticks, so the light never left the tile it revealed — ` +
          `how fast the forager travels is maze-movement/constant-speed's verdict`,
      );
    }

    // Parked on the tile it reached, with the pellet under it taken off the board
    // rather than eaten (`specs/instrumentation.md`: `setPlankton` "scores nothing
    // and clears no maze"), and the light back at its narrowest. None of that
    // touches the alcove.
    const parked = await parkForager(h);
    await h.debug.setPlankton(parked.forager.tx, parked.forager.ty, false);
    await h.debug.setBrightness(0);
    await h.advance(SETTLE_TICKS);
    const moved = await h.snapshot();

    // The same question a stretch of real simulation later.
    await h.advance(PERSIST_TICKS);
    const later = await h.snapshot();
    return { moved, later };
  });

  requireSceneHeld(h, reading.later, guard);

  // The antecedent: the light did reveal the alcove before the forager left.
  const remembered = [
    [
      "alcove",
      alcove,
      "corridor as faint open water, and any plankton on it as a faint mote",
    ],
    ["rock face above it", rock, "rock as dark stone"],
  ] as const;
  for (const [name, tile] of remembered) {
    assertEqual(
      visibilityAt(opened, tile),
      "l",
      `the ${name} at (${tile.tx}, ${tile.ty}), within reach of where the ` +
        `forager started, while its light was on it`,
    );
  }

  // The fixture's own geometry, from the specification's figures rather than from
  // the build's: at `G = 0` the light reaches `VISION_MIN` and no further, and the
  // alcove stands beyond that.
  const alcoveCenter = tileCenterOf(reading.moved.grid, alcove);
  const gap = Math.hypot(
    alcoveCenter.x - reading.moved.forager.x,
    alcoveCenter.y - reading.moved.forager.y,
  );
  assertGreaterThan(
    gap,
    VISION_MIN,
    `the logical units between the forager and the alcove once it has swum on, ` +
      `which must exceed V at G = 0 (VISION_MIN = ${VISION_MIN})`,
  );
  // A build whose light still reaches that far is one `brightness/widens-vision`
  // fails; this point cannot read a remembered tile through a light that never
  // left it.
  if (visibilityAt(reading.moved, alcove) === "l") {
    h.unmet(
      `the forager's light still holds the alcove ${gap.toFixed(1)} units away, ` +
        `where the build reports a radius of ${reading.moved.visionRadius} — the ` +
        `light's radius is brightness/widens-vision's verdict, not this one's`,
    );
  }

  for (const [name, tile] of remembered) {
    assertEqual(
      visibilityAt(reading.moved, tile),
      "r",
      `the ${name} at (${tile.tx}, ${tile.ty}) once the light has moved off it`,
    );
    assertEqual(
      visibilityAt(reading.later, tile),
      "r",
      `the ${name} ${(PERSIST_TICKS / 120).toFixed(1)} s later, which stays ` +
        `remembered for the rest of the maze`,
    );
  }

  // The control the drawn reading is measured against: a tile in the same frame
  // that nothing has ever revealed.
  assertEqual(
    visibilityAt(reading.later, fog),
    "u",
    `the sealed pocket at (${fog.tx}, ${fog.ty}), which no light, pulse or flare ` +
      `can reach`,
  );
  const fogGap = tileGap(reading.later.grid, fog, {
    tx: reading.later.forager.tx,
    ty: reading.later.forager.ty,
  });

  const sampled = await sampleTiles(h, reading.later.grid, [
    ...remembered.map(([, tile]) => tile),
    fog,
  ]);
  const fogColor = sampled[sampled.length - 1];
  for (const [index, [name, tile, drawn]] of remembered.entries()) {
    const center = tileCenterOf(reading.later.grid, tile);
    const range = Math.hypot(
      center.x - reading.later.forager.x,
      center.y - reading.later.forager.y,
    );
    assertLessThan(
      Math.abs(fogGap - range),
      TILE,
      `how much further the fog control stands from the forager than the ` +
        `remembered ${name} does, in logical units, so the two are read at the ` +
        `same range`,
    );
    assertGreaterThan(
      colorDistance(sampled[index], fogColor),
      DRAWN_MIN_DISTANCE,
      `the RGB distance, out of 441, between the remembered ${name} and the ` +
        `unrevealed fog the same distance away: a remembered tile is drawn dim, ` +
        `${drawn} (specs/sensing.md)`,
    );
  }
});
