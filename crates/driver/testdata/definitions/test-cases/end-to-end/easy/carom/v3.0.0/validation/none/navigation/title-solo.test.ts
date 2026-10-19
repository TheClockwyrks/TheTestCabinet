// navigation/title-solo — confirming SOLO starts a Solo match.
//
// specs/ui.md: on the title, `confirm` on `SOLO` starts a Solo match, which sets
// `mode`, `screen = countdown`, both scores 0 and `winner` null. The selection is
// posed on `SOLO` — where `reset` leaves it — and the confirm is a real `Enter`
// pressed through Chromium's own input pipeline, so what is graded is the confirm
// alone and not the arrow keys that would otherwise have reached the item.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { TITLE_SOLO, selectTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a Solo match on its countdown", async () => {
  await selectTitle(h, TITLE_SOLO);

  await h.tap("Enter");
  await captureStill(h, "countdown");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "solo");
  assertDeepEqual(opened.score, { p1: 0, p2: 0 });
  assertNull(opened.winner);
});
