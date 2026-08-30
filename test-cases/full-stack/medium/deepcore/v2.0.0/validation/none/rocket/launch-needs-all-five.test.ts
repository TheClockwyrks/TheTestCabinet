// Deepcore — rocket/launch-needs-all-five: nothing lifts off an unfinished
// rocket.
//
// `specs/rocket.md`: "With all five components installed the Launch Pad shows
// `LAUNCH`", and launching "takes the game to the Victory screen". So below five
// there is no `LAUNCH` to press, and a launch attempted anyway must change
// nothing.
//
// The pad's own `LAUNCH` is called at every installed count from none to four,
// and the game is run on a moment after each: the screen must still be `in-mine`
// and the checklist must still hold exactly what it held. Then the fifth is posed
// and the pad is read as having nothing left to fabricate, which
// `specs/instrumentation.md` reports as `nextComponent` at `null` — the state
// `specs/rocket.md` says the pad shows `LAUNCH` in.
//
// What launching then does is a requirement of its own, and has a validator of
// its own; this one stops at the offer.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { ROCKET_COMPONENT_IDS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { elapse, openPadScene } from "./pad-scene";

/** Driven after each refused launch, so a delayed lift-off would still show. */
const AFTER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a launch below five components and offers it at five", async () => {
  await openPadScene(h);

  for (let count = 0; count < ROCKET_COMPONENT_IDS.length; count += 1) {
    await h.debug.setRocketInstalled(count);
    const before = await h.snapshot();
    assertNotNull(
      before.rocket.nextComponent,
      `a component still to build with ${count} installed`,
    );

    await h.debug.launch();
    await elapse(h, AFTER);
    const after = await h.snapshot();

    assertEqual(
      after.screen,
      "in-mine",
      `the screen after launching with ${count} installed`,
    );
    assertDeepEqual(
      after.rocket.installed,
      ROCKET_COMPONENT_IDS.slice(0, count),
      `the checklist after launching with ${count} installed`,
    );
  }

  await h.debug.setRocketInstalled(ROCKET_COMPONENT_IDS.length);
  await h.advance(2);
  await captureStill(h, "ready");

  const ready = await h.snapshot();
  assertDeepEqual(
    ready.rocket.installed,
    [...ROCKET_COMPONENT_IDS],
    "the checklist with all five installed",
  );
  assertNull(
    ready.rocket.nextComponent,
    "a component still to build with all five installed",
  );
});
