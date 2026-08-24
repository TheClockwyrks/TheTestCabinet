// navigation/howto-back — Escape leaves the how-to screen for the title.
//
// specs/ui.md: on `howto`, `back` returns to the title with `menuIndex = 0`.
// The snapshot does not report `menuIndex`, so the index is read by confirming
// once back on the title: index 0 is `SOLO`, so the match that opens is Solo.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title, with SOLO selected, on Escape", async () => {
  await reachHowto(h);
  await h.tap("Escape");
  await captureStill(h, "title");
  assertEqual((await h.snapshot()).screen, "title");

  await h.tap("Enter");
  const opened = await h.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(opened.mode, "solo");
});
