// materials/scanner-never-targets-the-core — the Core is not a material node.
//
// `specs/mining.md` says it in one line: "The scanner never targets the Core."
// The Core is the third source of an exotic material, and it is the one the
// scanner is not for, so the world is posed with the two node materials already
// banked, no material node anywhere, and the miner standing on the Core itself
// at the tier that reaches 32 tiles. Nothing needed is in range, so
// `specs/instrumentation.md`'s resting values are what the scanner must report.
//
// A build that swept the grid for anything that yields a material would lock on
// here, at a distance of about one tile, which is why the miner is posed as
// close to the Core as it can stand rather than merely within range.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { DEFAULT_WORLD_SIZE } from "../constants";
import {
  captureStill,
  coreCell,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { cellDistance, minerCell, settled } from "./scanner-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("locks onto nothing with both materials held and the Core underfoot", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setTier("scanner", 3);
  await h.debug.setMaterial("resonite", 1);
  await h.debug.setMaterial("cryenite", 1);

  const core = coreCell(DEFAULT_WORLD_SIZE);
  await standOn(h, core.col, core.row);

  const after = await settled(h);
  await captureStill(h, "core");

  assertEqual(
    (await h.tileAt(core.col, core.row)).kind,
    "core",
    "specs/world.md",
  );
  assertEqual(
    cellDistance(minerCell(after), core) < 3,
    true,
    "specs/mining.md, the miner is beside the Core",
  );
  assertEqual(after.scanner.locked, false, "specs/mining.md");
  assertNull(after.scanner.target, "specs/instrumentation.md");
  assertNull(after.scanner.distanceTiles, "specs/instrumentation.md");
});
