// visibility/pellet-apart-from-board — the pellet is drawn on the cell it
// occupies.
//
// WHAT THE SPECIFICATION FIXES. `specs/board.md` puts exactly one pellet on the
// board during a round and draws it one cell in size, and `specs/overview.md`
// requires a player to see it there. The palette is the build's and what the
// pellet looks like is the presentation domain's aesthetic rating, so the one
// thing a check may read off the picture is PRESENCE: whether the build painted
// the cell the pellet sits on at all.
//
// HOW PRESENCE IS READ. The same point, twice. The pellet is posed on a cell of
// the check's choosing and the cell's centre is sampled; the pellet is then taken
// off the board with `clearPellet` (`specs/instrumentation.md`) and the same
// point is sampled again. A build that drew the pellet renders two different
// pixels; a build that left the cell as the empty field renders one. Nothing else
// on the board changes between the two frames, so the difference is the pellet.
//
// THE WORLD THIS POSES. The pellet, the snake laid far from it (it cannot be
// taken off the board, `specs/instrumentation.md`), the obstacle course cleared,
// and travel switched off — so nothing walks into the pellet's cell between the
// two readings, and no eat replaces it somewhere the check did not choose.
//
// WHERE IT SAMPLES. The pellet cell's centre. A cell is `CELL` (32) units across,
// so its centre is sixteen units from the nearest edge — outside any anti-aliased
// rim, and out of reach of a build's own per-cell ruling.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import {
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Cell,
  type Harness,
  type Rgb,
} from "../harness";

/** Where the pellet is placed: an interior cell clear of the posed chain. */
const PELLET_CELL: Cell = { col: 20, row: 5 };

/** A sampled colour as one string, so a failure names the reading plainly. */
function shows(color: Rgb): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the pellet's cell, and leaves it unpainted once the pellet is gone", async () => {
  poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: PELLET_CELL,
    travel: false,
  });
  // One frame, so what is sampled is the picture this posed world drew.
  await h.advance(1);
  captureStill(h, "scene");

  const [withPellet] = sampleCells(h, [PELLET_CELL]);

  h.debug.clearPellet();
  await h.advance(1);
  const [withoutPellet] = sampleCells(h, [PELLET_CELL]);

  assertNotEqual(
    shows(withPellet),
    shows(withoutPellet),
    "the pellet cell's centre with the pellet on the board, against the same point with it cleared",
  );
});
