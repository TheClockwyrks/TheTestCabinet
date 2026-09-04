// Wick — instrumentation/set-screen-unlisted-inert: an unlisted `setScreen`
// row changes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen(name)`: "Any row not listed, `chest` from anywhere or `levelup`
// from `title` among them, leaves the state as it was." `paused` is listed
// from `playing` alone, so `paused` from `title` is unlisted too. `title`,
// `howto`, and `almanac` are each listed from any screen, so none of the three
// belongs here; each has its own item.
//
// THE POSES. `setScreen('chest')` on an isolated run with a moth on the field,
// then `setScreen('levelup')` and `setScreen('paused')` on the title reached by
// `reset`; each time the whole snapshot before is compared with the whole
// snapshot after, structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the state as it was for chest from playing and levelup or paused from title", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  const playing = h.snapshot();
  h.debug.setScreen("chest");
  assertDeepEqual(
    h.snapshot(),
    playing,
    "snapshot after setScreen('chest') on playing",
  );

  h.reset();
  const title = h.snapshot();
  h.debug.setScreen("levelup");
  assertDeepEqual(
    h.snapshot(),
    title,
    "snapshot after setScreen('levelup') on title",
  );
  h.debug.setScreen("paused");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");
  assertDeepEqual(after, title, "snapshot after setScreen('paused') on title");
});
