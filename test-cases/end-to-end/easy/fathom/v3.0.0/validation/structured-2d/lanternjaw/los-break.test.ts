// lanternjaw/los-break — rock breaks its sense.
//
// specs/predators/lanternjaw.md requires all three conditions at once, and this
// point is the second of them: "in line of sight — the straight line between the
// two centers crosses no rock tile". So the pair stands WELL inside the range at
// both readings and nothing but the rock between them changes, which is what makes
// the two halves comparable: the same forager, the same hunter, the same
// separation, the same brightness, one line crossing rock and one not.
//
// THE ROCK IS A FULL BAND rather than one tile on the line. The hunter is still
// patrolling, so what has to be occluded is not one pair of tiles but every tile
// the hunter can reach; a single rock with a way around it leaves tiles at grazing
// angles where this check's idea of the line and a build's can honestly disagree,
// and the disagreement would then be read as a sense through rock. The fixture
// puts the hunter on its own corridor with a solid row of rock between the two, so
// no line from anywhere it can stand reaches the forager.
//
// AND THE CLEAR-LINE HALF IS THE SAME BOARD. The hunter is moved onto the
// forager's own corridor, the same number of tiles away, so the second reading
// differs from the first in the rock alone. Posing a second board instead would
// have changed the fog, the plankton and the den along with it.
//
// WHAT THIS DOES NOT DECIDE. Where the range boundary falls is
// `lanternjaw/light-range`'s, and what `detectRange` works out to at a given
// brightness is `brightness/widens-lanternjaw`'s. Both halves here stand at a
// fraction of the range so neither turns on either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import type { FathomSnapshot } from "../surface";
import { BRIGHT_HOLD } from "../../src/constants";

/**
 * How far apart the pair stands, in tiles, on either reading.
 *
 * Two tiles is `64` logical units, a fifth of the `320` a conforming build reaches
 * at `G = 1`, so "well inside detectRange" holds however a build rounds. It is
 * also the closest two tiles can stand with a full band of rock between them.
 */
const GAP_TILES = 2;

/** The brightness both halves are posed at, which `setBrightness` holds steady. */
const POSED_G = 1;

/**
 * How long the occluded pair is watched, in ticks.
 *
 * Eight tenths of a second, which the item calls "a window far longer than a
 * step": a hundred steps of the fixed timestep, so a build that acquires late
 * rather than never is caught rather than slipping between two samples.
 */
const BLIND_TICKS = ticksFor(0.8);

/** How often the occluded watch reads the state, in ticks. */
const BLIND_POLL = 6;

/**
 * How long the clear line is given to produce a fix, in ticks.
 *
 * A tenth of a second, a hard bound rather than a wait: the sense holds "on any
 * step where all three of these hold at once", so a build that needs longer FAILS.
 */
const ACQUIRE_TICKS = ticksFor(0.1);

/** Ticks run after every reading, purely so the clip shows the charge. */
const TAIL_TICKS = 24;

/** The distance between the forager's center and one predator's, in units. */
function gap(snapshot: FathomSnapshot, index: number): number {
  const p = snapshot.predators[index];
  return Math.hypot(p.x - snapshot.forager.x, p.y - snapshot.forager.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Rock breaks its sense", async () => {
  startPlaying(h);
  // The forager's corridor carries `C`, the clear-line standoff, `GAP_TILES` along
  // it; `P` sits the same number of ROWS below, with the rows between it and the
  // forager solid rock across the whole grid.
  const art = [
    `F${".".repeat(GAP_TILES - 1)}C...`,
    ...Array.from({ length: GAP_TILES - 1 }, () => ""),
    "P.....",
  ];
  const board = await poseMaze(h, art);
  const home = board.mark("F");
  const blind = board.mark("P");
  const clear = board.mark("C");
  const index = await spawnPredator(h, "lanternjaw", blind, {
    travel: false,
  });
  await parkForager(h, home);
  h.debug.setBrightness(POSED_G);
  h.debug.setBrightHold(BRIGHT_HOLD);
  const guard = await sceneGuard(h, { posesAgain: true });

  const read = await captureReplay(h, "blind", async () => {
    // Behind the band: inside the range, no line, so no fix at any step.
    h.debug.setPredatorTile(index, blind.tx, blind.ty);
    h.debug.setPredatorState(index, "wander");
    const seen: string[] = [];
    for (let spent = 0; spent < BLIND_TICKS; spent += BLIND_POLL) {
      await h.advance(BLIND_POLL);
      seen.push(h.snapshot().predators[index].state);
    }
    const occluded = h.snapshot();

    // The same separation on the forager's own corridor: open water between them,
    // and nothing else about the scenario different.
    h.debug.setPredatorState(index, "wander");
    h.debug.setPredatorTile(index, clear.tx, clear.ty);
    h.debug.setBrightness(POSED_G);
    h.debug.setBrightHold(BRIGHT_HOLD);
    const acquired = await h.until(
      (s) => s.predators[index].state === "chase",
      {
        maxFrames: ACQUIRE_TICKS,
        poll: 1,
      },
    );
    const openGap = gap(acquired.snapshot, index);
    await h.advance(TAIL_TICKS);
    return {
      seen,
      blindGap: gap(occluded, index),
      blindRange: occluded.predators[index].detectRange,
      acquired,
      openGap,
      end: h.snapshot(),
    };
  });

  requireSceneHeld(read.end, guard);

  // The fixture's own geometry: both standoffs are well inside the range the build
  // itself reports, so the rock is the only thing that differs.
  assertLessThan(
    read.blindGap,
    read.blindRange ?? 0,
    "the units between the two centers behind the rock band, which must be " +
      "inside the detectRange the Lanternjaw reports",
  );
  assertLessThan(
    read.openGap,
    read.acquired.snapshot.predators[index].detectRange ?? 0,
    "the units between the two centers on the open corridor, which must be " +
      "inside the detectRange the Lanternjaw reports",
  );

  assertTrue(
    read.seen.every((state) => state !== "chase"),
    `the states the Lanternjaw reported across ${BLIND_TICKS} ticks standing ` +
      `${read.blindGap.toFixed(0)} units away with a rock tile on the line ` +
      `between the two centers — it read [${read.seen.join(", ")}]`,
  );
  assertEqual(
    read.acquired.hit,
    true,
    "the same pair with open water between them acquires within " +
      `${ACQUIRE_TICKS} ticks, at ${read.openGap.toFixed(0)} units apart`,
  );
});
