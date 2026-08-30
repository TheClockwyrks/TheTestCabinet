// Deepcore — core-run/jettisoned-blast-kills-inside-its-radius: a ground
// detonation reaches a miner standing close by.
//
// `specs/hazards.md`: "A detonation while the Sample lies jettisoned on the
// ground kills a miner whose center is within `CORE_BLAST_TILES` (`3`) tiles of
// the ground cell's center." `specs/modes.md` gives the cause,
// `core-detonation`, and says the death ends the expedition at the Game Over
// screen.
//
// A Sample is placed on a cell of a floored corridor with a short timer, and the
// miner is stood two tiles from it — comfortably inside the radius, and far
// enough from the edge that a build rounding the distance either way is judged on
// the rule rather than on the boundary. The distance is measured from the
// snapshot rather than assumed, so the check reads the arrangement the game
// reports.
//
// The miner's hull is left FULL and its travel held off: full, so a death can
// only be the blast; held, so the miner is still at the distance the check posed
// it at when the Sample goes off.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_BLAST_TILES } from "../../src/constants";
import { assertEqual, assertLessThan, assertNotNull } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { runUntilOver, tilesFromCell } from "./core-scene";

/** The corridor the Sample and the miner stand in. */
const FLOOR_ROW = 11;
const SAMPLE_COL = 10;
const SAMPLE_ROW = FLOOR_ROW - 1;

/** Two tiles along the corridor: inside `CORE_BLAST_TILES`, clear of its edge. */
const MINER_COL = SAMPLE_COL + 2;

/** Short enough to run out inside the drive, long enough not to be instant. */
const SHORT_TIMER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("kills a miner inside CORE_BLAST_TILES of a jettisoned Sample", async () => {
  openScene(h);
  layFloor(h, FLOOR_ROW);
  standOn(h, MINER_COL, FLOOR_ROW);
  pinMiner(h);
  pinDrill(h);

  const posed = h.snapshot();
  h.debug.setHull(posed.miner.maxHull);
  h.debug.placeCoreSample(SAMPLE_COL, SAMPLE_ROW);
  h.debug.setCoreTimer(SHORT_TIMER);

  const staged = h.snapshot();
  assertLessThan(
    tilesFromCell(staged, SAMPLE_COL, SAMPLE_ROW),
    CORE_BLAST_TILES,
    "tiles between the miner's centre and the Sample's cell",
  );

  const over = await captureReplay(h, "close", () => runUntilOver(h));

  assertEqual(
    over.screen,
    "game-over",
    "the screen the blast left the game on",
  );
  assertNotNull(over.summary, "an expedition summary after the blast");
  assertEqual(
    over.summary?.deathCause,
    "core-detonation",
    "the cause the summary reports",
  );
});
