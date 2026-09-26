// Wireworm — screens/howto-copy: the how-to screen writes something, and among
// what it writes it names the fire key and the movement keys.
//
// specs/ui.md's `howto` screen lists what the copy covers and then fixes exactly
// three tokens of it: "The controls it names include the fire key, written as
// the standalone word `SPACE`, and the movement keys, written as the standalone
// words `ARROWS` and `WASD`." Those are `HOWTO_FIRE_KEY` and `HOWTO_MOVE_KEYS`,
// and they are all this asserts.
//
// STANDALONE, at word boundaries, is the whole point of the match: a screen
// reading "press the spacebar" contains `space` and has not named the key the
// specification named. Everything else the screen carries — the goal, the
// charge, the dive, the three foes — is prose, and whether that prose really
// teaches the game is not a question a script can decide, so the frame is
// captured and the wording is the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOWTO_FIRE_KEY, HOWTO_MOVE_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drewWord,
  type Harness,
} from "../harness";
import { poseHowto } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes its explanation and names the fire and movement keys", async () => {
  await poseHowto(h);

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  assertGreaterThan(
    drawnText(calls).length,
    0,
    "the how-to screen writes something",
  );

  for (const word of [HOWTO_FIRE_KEY, ...HOWTO_MOVE_KEYS]) {
    assertEqual(
      drewWord(calls, word),
      true,
      `names "${word}" as a standalone word`,
    );
  }
});
