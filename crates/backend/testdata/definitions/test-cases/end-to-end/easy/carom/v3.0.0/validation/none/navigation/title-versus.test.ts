// navigation/title-versus — confirming VERSUS starts a Versus match.
//
// specs/ui.md: on the title, `confirm` on `VERSUS` starts a Versus match, which
// sets `mode`, `screen = countdown`, both scores 0 and `winner` null. The
// selection is posed on `VERSUS` and the confirm is a real `Enter` pressed
// through Chromium's own input pipeline: the down edge that would otherwise have
// reached the item is `title-down`'s point, and posing the selection keeps this
// point on the confirm alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_VERSUS, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a Versus match on its countdown", async () => {
  await selectTitle(h, TITLE_VERSUS);

  await h.tap("Enter");
  await captureStill(h, "countdown");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "versus");
  assertDeepEqual(opened.score, { p1: 0, p2: 0 });
  assertNull(opened.winner);
});
