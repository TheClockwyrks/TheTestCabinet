// Refract — screens/howto-copy: the how-to frame draws its explanation, and
// among the draws the key bound to `clear` is named.
//
// specs/ui.md's `howto` screen covers the rules "in a player's words" and, last
// on its list, "the controls, naming the key bound to the `clear` action" —
// which specs/controls.md fixes as `KeyR`, the one binding the case pins. What a
// script can decide is that the frame draws text at all and that a standalone
// `R`, matched at word boundaries, appears among it; whether the prose really
// teaches the game is the reviewer's, from the captured frame. The word
// boundary is what keeps `REFRACT`, `CRYSTAL`, or `CLEAR` from counting as
// naming the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";
import { reachHowto } from "./screens";

/** The clear key, named as a word of its own (specs/controls.md: `KeyR`). */
const NAMES_CLEAR_KEY = /\bR\b/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its text and names the clear key as a standalone R", async () => {
  await reachHowto(h);

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  const runs = drawnText(calls);
  assertGreaterThan(runs.length, 0, "the howto frame draws text");
  assertMatches(
    runs.join(" ").toUpperCase(),
    NAMES_CLEAR_KEY,
    "the key bound to clear, named at word boundaries",
  );
});
