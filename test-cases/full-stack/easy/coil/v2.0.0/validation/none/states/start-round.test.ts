// states/start-round — confirming the title's first item opens a round.
//
// specs/ui.md gives the title menu the mode's entry first and `HOW TO PLAY`
// second, and "`confirm` on it starts a round, which sets `screen` to `playing`".
// The title is opened fresh, so the highlight is on the first item as
// specs/ui.md requires of every menu-bearing screen, and `confirm` is a real key
// event: the transition is the build's own menu handling, driven through the
// keyboard layer specs/instrumentation.md leaves the build to write.
//
// What the round is laid out with is `states/round-lays-out-the-board`; this
// decides that the round opens at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the screen to playing on confirm at the mode entry", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the round is started from");
  assertEqual(title.menuIndex, 0, "the highlighted item");

  await h.tap(KEY.confirm);
  await captureStill(h, "playing");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen confirm on the mode entry opened",
  );
});
