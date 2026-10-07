// towers/footprint-3x3 — a 3x3 tower blocks its nine tiles and no others.
//
// `specs/towers.md`, Footprints and rotation: "A tower occupies a square footprint
// of 2x2, 3x3, or 4x4 tiles", and the roster gives the Bloom a `size` of 3.
// `specs/mazing.md`: "A tower blocks every tile of its footprint from the frame it
// lands until the frame it leaves, whatever its size and whatever kind of tower it
// is." `specs/instrumentation.md` anchors an added tower by "its footprint's
// top-left at tile `(col, row)`", so a Bloom anchored at `(10, 10)` occupies
// `(10..12, 10..12)` — nine tiles — and nothing else.
//
// THE EXTENT IS READ THROUGH THE GAME'S OWN PLACEMENT CHECK, in both directions.
// `specs/instrumentation.md` states that "there is no operation that asks whether
// a footprint could be placed" and that `build.valid` answers it "through the same
// check", so a 2x2 preview held at each anchor around the tower reads invalid
// exactly on the anchors whose four tiles meet the tower's. The grid of those
// answers pins the extent from both sides at once.
//
// EVERY WRONG SIZE READS AS A DIFFERENT GRID, which is why the anchor and the
// probe are shared with `towers/footprint-2x2` and `towers/footprint-4x4`. A build
// that blocks a fixed 2x2 whatever the type leaves seven probes valid that this
// item requires invalid; a build that blocks the anchor tile alone leaves twelve;
// a build that centres the footprint on its anchor instead of hanging it
// south-east leaves the invalid band displaced a tile rather than shrunk. The
// failure therefore names which model the build implemented rather than merely
// that the count was wrong.
//
// A ROUTE LENGTH IS NOT WHAT IS READ. `mazing/towers-block-tiles` measures the
// three sizes by what they cost the surge, which says that something was blocked
// and how much; it cannot say WHICH tiles, and this item's requirement is which
// tiles.
//
// THE FLOOR HOLDS ONE TOWER AND NOTHING ELSE. `startRun` empties both rosters, so
// the placement check's surge clause cannot refuse a probe; the purse is far above
// the probe type's cost, so its money clause cannot; Containment fixes no build
// zone (`specs/modes.md`), so its zone clause cannot; and one 2x2 preview beside
// one tower in the middle of an open floor cannot seal the way to either exhaust,
// so the never-seal clause cannot either. The one condition left free to vary
// across the grid is the one this item is about: every tile of the footprint is
// open.
//
// THE GUNS ARE OFF, because walling is the only faculty this requirement
// exercises.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { type Tile } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
} from "../harness";
import { overlaps, scanOpenness } from "./probes";
import { sizeOf } from "./roster";

/** The tower under test, and where `test-case.toml` anchors it. */
const TYPE = "bloom";
const SIZE = sizeOf(TYPE);
const AT: Tile = { col: 10, row: 10 };

/** The type the openness grid is probed with: the smallest footprint there is. */
const PROBE = "arc";

/** Money far above the probe type's cost, so affordability refuses no probe. */
const PURSE = 2000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blocks every one of the nine tiles of its footprint and nothing outside it", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);
  const id = await poseIdleTower(h, TYPE, AT.col, AT.row);

  const cells = await scanOpenness(h, PROBE, AT, SIZE);

  await h.debug.setArmed(null);
  await h.debug.setSelected(id);
  await h.advance(1);
  await captureStill(h, "footprint");

  for (const cell of cells) {
    const meets = overlaps(
      { col: cell.col, row: cell.row, size: sizeOf(PROBE) },
      { col: AT.col, row: AT.row, size: SIZE },
    );
    assertEqual(
      cell.valid,
      !meets,
      `a ${sizeOf(PROBE)}x${sizeOf(PROBE)} footprint held at ` +
        `(${cell.col}, ${cell.row}) ${meets ? "meets" : "clears"} the ` +
        `${SIZE}x${SIZE} block at (${AT.col}, ${AT.row}), which covers ` +
        `(${AT.col}..${AT.col + SIZE - 1}, ${AT.row}..${AT.row + SIZE - 1})`,
    );
  }
});
