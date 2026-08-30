// Deepcore — core-run/jettisoned-blast-spares-a-miner-clear-of-it: a miner beyond
// the radius walks away.
//
// `specs/hazards.md`: a ground detonation "leaves a miner beyond that radius
// unharmed", which `specs/items.md` calls the whole point of jettisoning —
// "dropping it onto its current cell as a ground item so the player can move
// clear of the detonation."
//
// A Sample is placed on a floored corridor with a short timer and the miner is
// stood FIVE tiles away, well beyond `CORE_BLAST_TILES`, with its travel held so
// it stays there. The expedition must still be running afterwards with the hull
// exactly as it was posed.
//
// The detonation is read as HAVING HAPPENED before the hull is judged: the timer
// gone and the ground cell empty, because `specs/hazards.md` says the Sample "is
// destroyed either way". Without that a build whose Sample never went off at all
// would pass a check that only looked for an unharmed miner.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_BLAST_TILES } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
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
import { elapse, tilesFromCell } from "./core-scene";

/** The corridor the Sample and the miner stand in. */
const FLOOR_ROW = 11;
const SAMPLE_COL = 10;
const SAMPLE_ROW = FLOOR_ROW - 1;

/** Five tiles along the corridor: clear of `CORE_BLAST_TILES` by a wide margin. */
const MINER_COL = SAMPLE_COL + 5;

/** Short enough to run out inside the drive. */
const SHORT_TIMER = 2;

/** Comfortably past the timer, so the detonation has certainly happened. */
const DRIVEN = SHORT_TIMER + 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a miner beyond CORE_BLAST_TILES unharmed by the detonation", async () => {
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
  assertGreaterThan(
    tilesFromCell(staged, SAMPLE_COL, SAMPLE_ROW),
    CORE_BLAST_TILES,
    "tiles between the miner's centre and the Sample's cell",
  );

  const after = await captureReplay(h, "clear", async () => {
    await elapse(h, DRIVEN);
    return h.snapshot();
  });

  // The Sample really went off: it is destroyed either way.
  assertNull(after.coreTimer, "a timer still running after the detonation");
  assertNull(
    after.coreGround,
    "a Sample still on the ground after it detonated",
  );

  assertEqual(
    after.screen,
    "in-mine",
    "the screen after a blast clear of the miner",
  );
  assertEqual(
    after.miner.hull,
    staged.miner.hull,
    "hull across a detonation beyond the radius",
  );
});
