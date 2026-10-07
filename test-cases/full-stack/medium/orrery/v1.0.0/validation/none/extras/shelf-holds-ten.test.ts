// extras/shelf-holds-ten — the Extras shelf holds exactly ten challenges.
//
// THE RULE. "The Extras hold exactly `EXTRA_COUNT` (`10`) challenges, numbered
// `1` through `10`" (`specs/modes/extras.md`, The shelf), and the select screen
// "lists the ten challenges in order". The snapshot carries the figure:
// `extras: { count: 10, ... }`, and the table of derived fields says where it
// comes from — "`campaign.count`, `extras.count` | the length of each mode's
// challenge list" (`specs/instrumentation.md`). So `extras.count` is not a
// constant a build writes down beside its shelf; it is the shelf's own length,
// which is what makes reading it a reading of the shelf.
//
// EXACTLY TEN IS TWO CLAIMS, AND BOTH ARE DECIDED HERE. That the shelf is no
// SHORTER than ten — every index from `0` to `9` opens a challenge, one by one,
// through `openChallenge("extras", index)`, which "throws an `Error` naming the
// bounds" for "an `index` outside that mode's challenge count". And that it is no
// LONGER — the length it reports is `10` rather than eleven. A build with nine
// Extras fails the first; a build with twelve fails the second.
//
// WHAT IS DELIBERATELY NOT DECIDED HERE. WHICH challenge each row holds is the
// ten `challenge-N-…` items, one apiece, so this reads a name off each row only
// far enough to say a challenge is there at all. Whether the select screen draws
// ten rows is `select-lists-the-ten-in-order`'s.
//
// THE PICTURE is the Extras select screen, which is the shelf as a player meets
// it, taken before any assertion so a shelf of the wrong length is photographed
// rather than merely reported.
//
// THE VERDICT. `extras.count` is `EXTRA_COUNT`, and each of the ten indices `0`
// through `9` opens a challenge in the editor.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { EXTRA_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds EXTRA_COUNT challenges, every one of them openable", async () => {
  await openSelect(h, "extras");
  await captureStill(h, "shelf");

  const shelf = (await h.snapshot()).extras;
  assertEqual(
    shelf.count,
    EXTRA_COUNT,
    "the Extras hold exactly EXTRA_COUNT (10) challenges, and count is the length of that list",
  );

  // Numbered 1 through 10: every index of the shelf opens the challenge on it,
  // and a build one row short throws on the index it does not hold.
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    await openChallenge(h, "extras", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(
      view,
      `Extras ${index + 1} is a challenge on the shelf, so opening it leaves one in the editor`,
    );
    assertEqual(
      typeof view?.name,
      "string",
      `Extras ${index + 1} carries a name of its own, as every challenge does`,
    );
  }
});
