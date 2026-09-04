// check/check-result-cleared-by-an-undo — an undo sends the shown check result
// back to none.
//
// specs/structure.md § The static check: "The result the action leaves stands
// until the structure or the tape changes, when it goes back to none." An undo is
// a structure change like any other — § The editor's rules: "undo restores the
// structure to what it was before the most recent structure-changing edit" — so
// the result it leaves behind describes a crane that is no longer on screen, and
// must go.
//
// This is the edge a build that cleared the result from its placement and removal
// paths alone would miss, which is why it is its own point: the undo restores a
// structure rather than editing one.
//
// The scenario places one member on a ready crane and takes the reading with it
// standing, so the undo has something to reverse and the reading it clears is a
// reading of the crane the undo is about to discard. Both acts are the player's
// own: `KeyC` for the `check` action and `KeyZ` for `undo`, which specs/controls.md
// binds on the build screen, and the `check` READING would set nothing
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

const CHECK_KEY = BINDINGS.check[0]!;
const UNDO_KEY = BINDINGS.undo[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the shown result when an undo reverses the last edit", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.addMember(0, 0, 0, 0, 0, 2, "strut");

  await h.press(CHECK_KEY);
  const before = await h.snapshot();
  assertNotNull(
    before.checkResult,
    "the result the `check` action leaves the build screen showing " +
      "(specs/structure.md § The static check)",
  );

  await h.press(UNDO_KEY);
  const after = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "check-result-around-the-undo",
    "The check result and the history depth, around the undo",
  );
  console.log(
    `gantry: historyDepth ${before.historyDepth} before the undo, ` +
      `${after.historyDepth} after; the crane holds ` +
      `${after.structure.members.length} members`,
  );

  assertNull(
    after.checkResult,
    "the shown check result once an undo changed the structure " +
      "(specs/structure.md § The static check)",
  );
});
