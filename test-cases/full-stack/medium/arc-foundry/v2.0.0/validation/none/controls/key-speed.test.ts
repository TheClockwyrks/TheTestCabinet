// controls/key-speed — `KeyF` cycles the speed multiplier.
//
// THE REQUIREMENT. `specs/controls.md` binds `speed` to `KeyF` and fixes the cycle
// exactly: "The speed control cycles the multiplier through `1`, `2`, `4`, `8`,
// and back to `1`, one step per activation. It applies to the whole simulation and
// persists until changed."
//
// HOW IT IS DECIDED. A run is opened on an empty yard, the multiplier it stands at
// is read, and `KeyF` is pressed five times as a player presses it — real browser
// key events through the build's own keyboard layer. The multiplier is read after
// each press against the next entry of the stated order, so the fifth press has to
// bring it back round. It is then left alone across a stretch of simulation and
// read once more, which is the "persists until changed" half of the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SPEEDS, keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Frames the multiplier is left alone for, to see whether it holds. */
const HOLD_FRAMES = 240; // 2 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the multiplier one place per press and wraps back to 1", async () => {
  await openYard(h);

  const start = (await h.snapshot()).speed;
  const from = SPEEDS.indexOf(start);
  assertGreaterThanOrEqual(
    from,
    0,
    `the speed multiplier to be one of ${SPEEDS.join(", ")} ` +
      "(specs/instrumentation.md)",
  );

  for (let press = 1; press <= SPEEDS.length + 1; press += 1) {
    await h.tap(keyFor("speed"));
    if (press === 1) await captureStill(h, "cycle");

    assertEqual(
      (await h.snapshot()).speed,
      SPEEDS[(from + press) % SPEEDS.length],
      `the multiplier after ${press} press${press === 1 ? "" : "es"} of ` +
        `${keyFor("speed")}, stepping through 1, 2, 4, 8 and back to 1 ` +
        "(specs/controls.md)",
    );
  }

  // And it persists until changed: nothing but another activation moves it.
  const held = (await h.snapshot()).speed;
  await h.advance(HOLD_FRAMES);
  assertEqual(
    (await h.snapshot()).speed,
    held,
    "the multiplier after two seconds with the key untouched, which persists " +
      "until it is changed (specs/controls.md)",
  );
});
