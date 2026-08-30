// controls/key-speed — `KeyF` cycles the speed multiplier.
//
// THE REQUIREMENT. `specs/controls.md` binds `speed` to `KeyF` and fixes the cycle
// exactly: "The speed control cycles the multiplier through `1`, `2`, `4`, `8`,
// and back to `1`, one step per activation. It applies to the whole simulation and
// persists until changed."
//
// HOW IT IS DECIDED. A run is opened on an empty yard, the multiplier it stands at
// is read, and `KeyF` is pressed five times as a player presses it — real key
// events dispatched at the engine's own surface. The multiplier is read after each
// press against the next entry of the stated order, so the fifth press has to
// bring it back round. It is then left alone across a stretch of simulation and
// read once more, which is the "persists until changed" half of the requirement.

import { afterEach, beforeEach, it } from "vitest";

import { SPEEDS } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openYard,
  pressAction,
  ticks,
  type Harness,
} from "../harness";

/** Seconds the multiplier is left alone for, to see whether it holds. */
const HOLD_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("steps the multiplier one place per press and wraps back to 1", async () => {
  openYard(h);

  const start = h.snapshot().speed;
  const from = SPEEDS.indexOf(start as (typeof SPEEDS)[number]);
  assertGreaterThanOrEqual(
    from,
    0,
    `the speed multiplier to be one of ${SPEEDS.join(", ")} ` +
      "(specs/instrumentation.md)",
  );

  for (let press = 1; press <= SPEEDS.length + 1; press += 1) {
    await pressAction(h, "speed");
    if (press === 1) captureStill(h, "cycle");

    assertEqual(
      h.snapshot().speed,
      SPEEDS[(from + press) % SPEEDS.length],
      `the multiplier after ${press} press${press === 1 ? "" : "es"} of ` +
        `${keyFor("speed")}, stepping through 1, 2, 4, 8 and back to 1 ` +
        "(specs/controls.md)",
    );
  }

  // And it persists until changed: nothing but another activation moves it.
  const held = h.snapshot().speed;
  await h.advance(ticks(HOLD_SECONDS));
  assertEqual(
    h.snapshot().speed,
    held,
    "the multiplier after two seconds with the key untouched, which persists " +
      "until it is changed (specs/controls.md)",
  );
});
