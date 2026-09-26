// materials/scanner-targets-what-is-missing — the scanner looks for what the
// satchel lacks.
//
// `specs/mining.md` fixes the targeting rule in two halves: "While the miner
// lacks Resonite the scanner targets the Resonite node, and while it lacks
// Cryenite it targets the Cryenite node." This point decides both halves by
// holding exactly one material at a time, so the third half of the rule — which
// node wins when BOTH are missing — never applies here; that is
// `materials/scanner-picks-the-nearer`.
//
// The two nodes are posed at deliberately different distances, both well inside
// tier 3's range, so a build that answered with the nearer node whatever the
// satchel held would be caught on the pose where the nearer one is the one
// already banked.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { minerCell, openScanner, poseNode, settled } from "./scanner-scene";

/** Both inside tier 3's range of 32 tiles, and far enough apart to tell apart. */
const RESONITE_TILES = 5;
const CRYENITE_TILES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("targets the node whose material is missing from the satchel", async () => {
  openScanner(h, 3);
  const me = minerCell(await settled(h));
  poseNode(h, { col: me.col, row: me.row + RESONITE_TILES }, "resonite");
  poseNode(h, { col: me.col, row: me.row + CRYENITE_TILES }, "cryenite");

  // Resonite banked, Cryenite missing: the far node is the one wanted.
  h.debug.setMaterial("resonite", 1);
  h.debug.setMaterial("cryenite", 0);
  const lacksCryenite = await settled(h);
  captureStill(h, "target");
  assertEqual(lacksCryenite.scanner.locked, true, "specs/mining.md");
  assertEqual(lacksCryenite.scanner.target, "cryenite", "specs/mining.md");

  // And the other way round: the near node is the one wanted.
  h.debug.setMaterial("resonite", 0);
  h.debug.setMaterial("cryenite", 1);
  const lacksResonite = await settled(h);
  assertEqual(lacksResonite.scanner.locked, true, "specs/mining.md");
  assertEqual(lacksResonite.scanner.target, "resonite", "specs/mining.md");
});
