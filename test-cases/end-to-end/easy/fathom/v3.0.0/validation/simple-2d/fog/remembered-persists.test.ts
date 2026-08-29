// fog/remembered-persists — revealed terrain is remembered.
//
// specs/sensing.md gives the remembered state as a tile "revealed earlier and not
// lit this instant", reported `r` and "drawn dim: rock as dark stone, corridor as
// faint open water, and any plankton on it as a faint mote", and it fixes how long
// that lasts: "Once a tile has been revealed by any source it stays remembered for
// the rest of the current maze, across losing a life included."
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
// tile this item is about.
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
// grazes as it swims, and `G` drives `V` (specs/sensing.md), so a forager that
// arrives bright is still lighting the tile it left. `setBrightness(0)` poses `G`
// at the zero a dive opens on and arms the hold in full
// (specs/instrumentation.md), so the light is `VISION_MIN` (`96`) for the whole
// reading — narrower than the `131.9` the alcove stands at, and narrower than the
// `192` the kindle circle covers at that same `G`.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, VISION_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { poseMaze } from "../fixtures";
import {
  DIR_KEY,
  captureReplay,
  centerOf,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  ticks,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  denAll,
  fromForager,
  graded,
  parkForager,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
  unmetPrecondition,
} from "../scene";
import type { Tile } from "../maze";

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
 * so a build whose forager crawls is stood down by {@link requireSwim} rather than
 * waited for indefinitely.
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
 * The review item's bound. It is a floor rather than a match: every palette is the
 * build's (specs/overview.md fixes only that the trench is dark), so what is
 * asserted is that a remembered tile is drawn as SOMETHING and not painted back
 * into the fog.
 */
const DRAWN_MIN_DISTANCE = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Revealed terrain is remembered", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const board = await poseMaze(h, ART);
    const alcove: Tile = board.mark("A");
    // The rock face directly above the alcove: the same light lands on it, so it
    // is remembered too, and it draws terrain alone.
    const rock: Tile = { tx: alcove.tx, ty: alcove.ty - 1 };
    const start: Tile = board.mark("S");
    const fog: Tile = board.mark("D");
    const quiet = await denAll(h);
    h.debug.setForagerTile(start.tx, start.ty);
    h.debug.setForagerDir("right");
    h.debug.setBrightness(0);
    // The forager travels here, so the guard watches the board rather than the
    // tile it was parked on.
    const watch = await sceneGuard(h, quiet, { foragerParked: false });

    await h.advance(SETTLE_TICKS);
    const opened = h.snapshot();

    const reading = await captureReplay(h, "memory", async () => {
      const before = h.snapshot();
      h.hold(DIR_KEY.right);
      const swum = await h.until(
        (s) => s.forager.x - before.forager.x >= SWIM_TILES * TILE,
        { maxFrames: SWIM_MAX_TICKS, poll: 1 },
      );
      h.release(DIR_KEY.right);
      // Whether the forager swims at all is `controls/*` and `maze-movement/*`'s
      // verdict; this point has nothing to say about a build whose forager stayed
      // where it was put.
      if (!swum.hit) {
        requireSwim(
          before.forager,
          swum.snapshot.forager,
          `swim ${SWIM_TILES} tiles clear of the tile its light revealed`,
        );
        unmetPrecondition(
          `the forager covered only ${(swum.snapshot.forager.x - before.forager.x).toFixed(1)} ` +
            `of the ${SWIM_TILES * TILE} logical units this scenario needs in ` +
            `${SWIM_MAX_TICKS} ticks, so the light never left the tile it revealed; ` +
            `how fast the forager travels is maze-movement/constant-speed's verdict`,
        );
      }

      // Parked on the tile it reached, with the pellet under it taken off the
      // board rather than eaten (specs/instrumentation.md: `setPlankton` "scores
      // nothing and clears no maze"), and the light back at its narrowest. None of
      // that touches the alcove.
      await parkForager(h);
      const parked = h.snapshot();
      h.debug.setPlankton(parked.forager.tx, parked.forager.ty, false);
      h.debug.setBrightness(0);
      await h.advance(SETTLE_TICKS);
      const moved = h.snapshot();

      // The same question a stretch of real simulation later.
      await h.advance(PERSIST_TICKS);
      const later = h.snapshot();
      return { moved, later };
    });

    requireSceneHeld(reading.later, watch);

    // The antecedent: the light did reveal the alcove before the forager left.
    for (const [name, tile] of [
      ["alcove", alcove],
      ["rock face above it", rock],
    ] as const) {
      assertEqual(
        visibilityOf(opened, tile),
        "l",
        `the ${name} at (${tile.tx}, ${tile.ty}), within reach of where the ` +
          `forager started, while its light was on it`,
      );
    }

    // The fixture's own geometry, from the specification's figures rather than
    // from the build's: at `G = 0` the light reaches `VISION_MIN` and no further,
    // and the alcove stands beyond that.
    const alcoveCenter = centerOf(reading.moved, alcove);
    const gap = fromForager(reading.moved, alcoveCenter.x, alcoveCenter.y);
    assertGreaterThan(
      gap,
      VISION_MIN,
      "the logical units between the forager and the alcove once it has swum on, " +
        `which must exceed V at G = 0 (VISION_MIN = ${VISION_MIN})`,
    );
    // A build whose light still reaches that far is one `brightness/widens-vision`
    // fails; this point cannot read a remembered tile through a light that never
    // left it.
    if (visibilityOf(reading.moved, alcove) === "l") {
      unmetPrecondition(
        `the forager's light still holds the alcove ${gap.toFixed(1)} units away, ` +
          `where the build reports a radius of ${reading.moved.visionRadius}; the ` +
          `light's radius is brightness/widens-vision's verdict, not this one's`,
      );
    }

    for (const [name, tile] of [
      ["alcove", alcove],
      ["rock face above it", rock],
    ] as const) {
      assertEqual(
        visibilityOf(reading.moved, tile),
        "r",
        `the ${name} at (${tile.tx}, ${tile.ty}) once the light has moved off it`,
      );
      assertEqual(
        visibilityOf(reading.later, tile),
        "r",
        `the ${name} ${(PERSIST_TICKS / 120).toFixed(1)} s later, which stays ` +
          "remembered for the rest of the maze",
      );
    }

    // The control the drawn reading is measured against: a tile in the same frame
    // that nothing has ever revealed.
    assertEqual(
      visibilityOf(reading.later, fog),
      "u",
      `the sealed pocket at (${fog.tx}, ${fog.ty}), which no light, pulse or ` +
        "flare can reach",
    );
    const fogCenter = centerOf(reading.later, fog);
    const fogGap = fromForager(reading.later, fogCenter.x, fogCenter.y);

    const fogColor = sampleTile(h, reading.later, fog);
    for (const [name, tile, drawn] of [
      [
        "alcove",
        alcove,
        "corridor as faint open water, and any plankton on it as a faint mote",
      ],
      ["rock face above it", rock, "rock as dark stone"],
    ] as const) {
      const range = fromForager(
        reading.later,
        centerOf(reading.later, tile).x,
        centerOf(reading.later, tile).y,
      );
      assertLessThan(
        Math.abs(fogGap - range),
        TILE,
        `how much further the fog control stands from the forager than the ` +
          `remembered ${name} does, in logical units, so the two are read at the ` +
          `same range`,
      );
      assertGreaterThan(
        colorDistance(sampleTile(h, reading.later, tile), fogColor),
        DRAWN_MIN_DISTANCE,
        `the RGB distance, out of 441, between the remembered ${name} and the ` +
          `unrevealed fog the same distance away: a remembered tile is drawn dim, ` +
          `${drawn} (specs/sensing.md)`,
      );
    }
  });
});
