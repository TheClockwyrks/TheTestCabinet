// materials/material-spare — a second unit of a held material is kept.
//
// `specs/mining.md` fixes it in one line: "Collecting a material already held
// banks a spare." So a miner already carrying Resonite cuts a second Resonite
// node and the satchel count rises to two, rather than the second unit being
// dropped on the floor of a satchel that already has one.
//
// The second unit is banked by the game's own rule rather than posed: the node
// goes under the drill and `specs/character.md`'s "A material node banks its
// material into the satchel" is what does the banking. Travel is gated so the
// miner cuts where it was put; the drill is what the point exercises.

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

/** The cell the second node is posed in, and the cell the miner stands on. */
const COL = 8;
const ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the satchel count to two rather than discarding the second unit", async () => {
  await openScene(h);
  await pinMiner(h);
  await h.debug.setMaterial("resonite", 1);
  await layMaterial(h, COL, ROW, "resonite");
  await standOn(h, COL, ROW);

  const before = await h.snapshot();
  assertEqual(before.satchel.resonite, 1, "specs/instrumentation.md");

  const cut = await captureReplay(h, "spare", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  assertEqual(cut.broke, true, "specs/character.md");
  assertEqual(cut.tile.kind, "tunnel", "specs/world.md");
  assertEqual(cut.snapshot.satchel.resonite, 2, "specs/mining.md");
});
