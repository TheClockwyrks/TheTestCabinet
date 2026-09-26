// Wireworm — screens/title-descend-starts: confirming the first title item opens
// a run.
//
// specs/ui.md's `title` table: `DESCEND`, the first entry of `TITLE_ITEMS`,
// "Opens a new run, as `specs/progression.md` states, and moves to `playing`."
// This item decides the move; what a NEW RUN carries — three lives, level 1, no
// score, a fresh scatter — is decided by the `progression` items that name each
// of those figures, so nothing but the screen is read here.
//
// The highlight is posed on the first item and the confirm is a real `Enter`
// through Chromium's input pipeline, so what is graded is the build's own
// handling of `confirm` on the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CONFIRM_KEY, poseTitle } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the game on the playing screen after ${TITLE_ITEMS[0]}`, async () => {
  await poseTitle(h, 0);

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "playing");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    `the screen ${TITLE_ITEMS[0]} opened`,
  );
});
