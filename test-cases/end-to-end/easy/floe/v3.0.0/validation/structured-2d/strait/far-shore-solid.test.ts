// strait/far-shore-solid — every column of the bay row that no bay covers is
// solid, and a hop up from row 2 into it is refused.
//
// The other half of `bay-columns`, and the half that closes the row. specs/
// strait.md: "Every column of row `1` outside those ten is solid far shore".
// specs/hopping.md refuses a hop whose target tile "is on row `1` at a column no
// bay covers", and fixes what a refusal leaves behind: "A refused hop leaves
// everything as it was: the critter stays where it stands with the same facing,
// the cooldown is untouched, no life is lost, and nothing is scored."
//
// So the item reads two things after the hop — the critter did not move, and it
// lost no life — and both are read on every one of the THIRTY columns the five
// bays do not cover. Ten columns accept a hop up and thirty refuse one; between
// this point and `bay-columns` every column of row `1` is decided, and a build
// that put its bays anywhere but where the table puts them is caught from one
// side or the other.
//
// EACH COLUMN IS ITS OWN CASE, on its own strait, so a failed grade names the
// column the far shore let through rather than reporting that one of thirty did.
// A fresh strait per column also means the hop is offered a critter whose
// cooldown is at `0` — `addCritter` starts it there (specs/instrumentation.md)
// and no frame has run since — so a hop the build's rules would have ACCEPTED
// really would have happened, and a refusal read here is the rule rather than
// the cadence.
//
// LOSING NO LIFE IS READ AS PART OF THE REFUSAL, because the two failures it
// separates are different builds: one that lets the critter onto the solid shore
// and one that kills it for trying. The critter is standing on a still one-tile
// floe at the mouth (`mouth.ts`) — row `2` is the top row of the water band and
// open water drowns it on the tick (specs/water.md) — so the only thing on the
// strait that could cost a life is the hop itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  BAYS,
  COLS,
  ROW_BAYS,
  START_LIVES,
  WATER_TOP,
} from "../../src/constants";
import {
  bayAtColumn,
  captureReplay,
  createHarness,
  critterTile,
  hop,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";
import { poseOnRowTwo } from "./mouth";

/** The thirty columns of the bay row no bay covers (specs/strait.md). */
const SOLID_COLUMNS: readonly number[] = Array.from(
  { length: COLS },
  (_unused, col) => col,
).filter((col) => bayAtColumn(col) === null);

/**
 * The column the replay is recorded on: the column immediately left of the
 * leftmost bay.
 *
 * One of the thirty, because the output is one clip. It is the column where the
 * shore's edge is, so the clip shows the critter refused one tile from an
 * opening it could have gone through.
 */
const RECORDED_COLUMN = BAYS[0][0] - 1;

/**
 * Frames recorded after the hop, for the replay alone.
 *
 * A quarter of a second of the critter standing exactly where it was, which is
 * what the refusal looks like. Every reading is taken before it runs.
 */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("covers every column of the bay row between the bays", () => {
  // The thirty and the ten together are the whole row: a guard on the arithmetic
  // above, not a reading of the build.
  assertEqual(
    SOLID_COLUMNS.length + BAYS.length * 2,
    COLS,
    "the columns of row 1, the ten a bay covers and the rest (specs/strait.md)",
  );
});

it.each(SOLID_COLUMNS)(
  "refuses a hop up from row 2 into the solid shore at column %i",
  async (col) => {
    assertNull(bayAtColumn(col), `no bay covers column ${col}`);

    startCrossing(h);
    poseOnRowTwo(h, col);
    const before = h.snapshot();

    const drive = async (): Promise<FloeSnapshot> => {
      await hop(h, "up");
      const refused = h.snapshot();
      await h.advance(AFTER_FRAMES);
      return refused;
    };
    const after =
      col === RECORDED_COLUMN
        ? await captureReplay(h, "refuse", drive)
        : await drive();

    assertDeepEqual(
      critterTile(after),
      { col, row: WATER_TOP },
      `a hop up into row ${ROW_BAYS} at column ${col} leaves the critter ` +
        `where it stood (specs/hopping.md)`,
    );
    assertEqual(
      after.lives,
      before.lives,
      `a refused hop at column ${col} costs no life (specs/hopping.md)`,
    );
    assertEqual(
      after.lives,
      START_LIVES,
      `the lives a fresh crossing carries, unspent (specs/progression.md)`,
    );
  },
);
