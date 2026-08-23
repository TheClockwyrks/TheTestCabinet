// navigation/title-howto — confirming HOW TO PLAY opens the how-to screen.
//
// specs/ui.md: on the title, `confirm` on `HOW TO PLAY` sets `screen = howto`.
// The selection is moved to the third entry with two real down presses and
// confirmed with a real Enter.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen from the title", async () => {
  await reachHowto(h);
  await captureStill(h, "howto");

  expect((await h.snapshot()).screen).toBe("howto");
});
