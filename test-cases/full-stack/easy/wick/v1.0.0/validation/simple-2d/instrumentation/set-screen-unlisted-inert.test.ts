// instrumentation/set-screen-unlisted-inert — `setScreen('chest')` from
// playing, `setScreen('levelup')` from title, and `setScreen('paused')` from
// title each leave the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Any
// row not listed, `chest` from anywhere or `levelup` from `title` among them,
// leaves the state as it was"; the `paused` row is from `playing` alone.
//
// THE POSE. Each unlisted pair from its own fresh scene, the whole snapshot
// read before and after the call and compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type Screen,
} from "../harness";

const UNLISTED: readonly { from: "title" | "playing"; name: Screen }[] = [
  { from: "playing", name: "chest" },
  { from: "title", name: "levelup" },
  { from: "title", name: "paused" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the state untouched by every unlisted row", async () => {
  for (const { from, name } of UNLISTED) {
    if (from === "playing") isolate(h, { keepTaper: true });
    else h.reset();
    const before = h.snapshot();

    h.debug.setScreen(name);

    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot across setScreen('${name}') from ${from}`,
    );
  }
  await h.tick(1);
  captureStill(h, "inert");
});
