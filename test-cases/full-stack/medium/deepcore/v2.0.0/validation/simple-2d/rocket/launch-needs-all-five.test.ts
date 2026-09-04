// Deepcore — rocket/launch-needs-all-five: nothing lifts off an unfinished
// rocket.
//
// `specs/rocket.md`: "With all five components installed the Launch Pad shows
// `LAUNCH`", and launching "takes the game to the Victory screen". So below five
// there is no `LAUNCH` to press, and a launch attempted anyway must change
// nothing.
//
// The pad's own `LAUNCH` is called at every installed count from none to four,
// and the game is run on a moment after each: the screen must still be `in-mine`,
// the checklist must still hold exactly what it held, and — the reading that
// really bites — the `launch` cue must never have sounded. `specs/rocket.md` says
// launching "plays the rocket lifting off the pad", so a build that committed to
// a lift-off announces it on the frame it committed, several seconds before the
// Victory screen would show; watching the cue BY NAME catches that at once, where
// waiting for the screen to change would need the whole animation to play out.
// Then the fifth is posed and the pad is read as having nothing left to
// fabricate, which `specs/instrumentation.md` reports as `nextComponent` at
// `null` — the state `specs/rocket.md` says the pad shows `LAUNCH` in.
//
// What launching then does is a requirement of its own, and has a validator of
// its own; this one stops at the offer.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, ROCKET_COMPONENT_IDS } from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  sounded,
  watchCues,
  type Harness,
} from "../harness";
import { elapse, openPadScene } from "./pad-scene";

/** Driven after each refused launch, so a delayed lift-off would still show. */
const AFTER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a launch below five components and offers it at five", async () => {
  openPadScene(h);
  const played = watchCues(h);

  for (let count = 0; count < ROCKET_COMPONENT_IDS.length; count += 1) {
    h.debug.setRocketInstalled(count);
    const before = h.snapshot();
    assertNotNull(
      before.rocket.nextComponent,
      `a component still to build with ${count} installed`,
    );

    h.debug.launch();
    await elapse(h, AFTER);
    const after = h.snapshot();

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
    assertEqual(
      sounded(played, CUES.launch),
      false,
      `specs/rocket.md: a lift-off begun with ${count} components installed`,
    );
  }

  h.debug.setRocketInstalled(ROCKET_COMPONENT_IDS.length);
  await h.advance(2);
  captureStill(h, "ready");

  const ready = h.snapshot();
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
