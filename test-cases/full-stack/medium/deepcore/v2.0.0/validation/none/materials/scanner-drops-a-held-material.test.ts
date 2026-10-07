// materials/scanner-drops-a-held-material — a banked node stops being a target.
//
// `specs/mining.md` states the targeting rule as a condition on the satchel:
// the scanner targets the Resonite node "while the miner lacks Resonite". So the
// moment the miner banks one, that node stops being a target and the scanner
// falls to the other missing material or to nothing.
//
// The change is driven by the game rather than posed: the Resonite node is put
// under the miner's drill and cut through, so what banks it is
// `specs/character.md`'s own rule that a broken material node banks its material
// into the satchel. The miner's travel is gated so the cut is all that happens;
// the drill is not, because the cut is the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  layMaterial,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { MINER_COL, MINER_ROW, settled } from "./scanner-scene";

/** The Cryenite node's row: the target the scanner falls to once Resonite is in. */
const CRYENITE_ROW = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the target off the Resonite node once its material is banked", async () => {
  await openScene(h);
  await pinMiner(h);
  await h.debug.setTier("scanner", 3);
  const resonite = { col: MINER_COL, row: MINER_ROW };
  const cryenite = { col: MINER_COL, row: CRYENITE_ROW };
  await layMaterial(h, resonite.col, resonite.row, "resonite");
  await layMaterial(h, cryenite.col, cryenite.row, "cryenite");
  await standOn(h, resonite.col, resonite.row);

  const before = await settled(h);
  assertEqual(before.satchel.resonite, 0, "specs/mining.md");
  assertEqual(before.scanner.target, "resonite", "specs/mining.md");

  const cut = await captureReplay(h, "switch", () =>
    driveCut(h, "down", resonite),
  );
  assertEqual(cut.broke, true, "specs/character.md");

  const after = await settled(h);
  assertEqual(after.satchel.resonite, 1, "specs/mining.md");
  assertEqual(after.scanner.target, "cryenite", "specs/mining.md");
  assertEqual(after.scanner.locked, true, "specs/mining.md");
});
