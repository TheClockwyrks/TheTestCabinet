// instrumentation/set-screen-unlisted-inert — `setScreen('chest')` from
// playing, `setScreen('levelup')` from title, and `setScreen('paused')` from
// title each leave the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Any
// row not listed, `chest` from anywhere or `levelup` from `title` among them,
// leaves the state as it was"; the `paused` row is from `playing` alone. Of the
// nine screens only `chest` has no row of its own: `almanac` is listed, from
// "any", so it is not one of the pairs read here.
//
// THE POSE. Each unlisted pair from its own fresh scene, the whole snapshot
// read before and after the call and compared field for field, which carries
// `almanacTab`, `almanacScroll`, and `run.hurtFlash` with the rest.

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
