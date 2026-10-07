// cascade/launch-cycles-foundations — the launch order cycles the foundations.
//
// specs/victory.md: "The launch order cycles the four foundations, taking
// foundation `0`, then `1`, then `2`, then `3`, then `0` again, and skipping a
// foundation that has been emptied." The first four launches are therefore one
// card from each foundation, in slot order, and that is the whole of what this
// point reads.
//
// WHICH FOUNDATION LAUNCHED IS FOUND RATHER THAN ASSUMED. `readLaunches` reports
// the pile that lost a card between one launch and the next, so this reads the
// order the build actually used. A build that cycled the four in some other order
// fails here and nowhere else; a build that cycled correctly but launched the
// wrong CARD fails `launch-takes-top-card` and not this.
//
// The skip rule is not read here: with fifty-two cards home no foundation is
// empty over the first four launches, so there is nothing to skip and nothing to
// grade. `cascade-completes` is what says every card leaves in the end.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FOUNDATION_COUNT } from "../constants";
import { type Harness, captureStill, createHarness, pileOf } from "../harness";
import { openCascade, readLaunches } from "./flight";

/** How many cards each foundation holds once the board is complete. */
const FOUNDATION_DEPTH = 13;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes the first four launches from foundations 0, 1, 2 and 3 in turn", async () => {
  await openCascade(harness);

  const launches = await readLaunches(harness, FOUNDATION_COUNT);
  await captureStill(harness, "launches");

  for (const launch of launches) {
    assertEqual(
      launch.foundation,
      launch.ordinal - 1,
      `launch ${launch.ordinal} of the cascade to come from foundation ${launch.ordinal - 1}`,
    );
  }

  // And each of the four gave up exactly one card, which is the same fact read
  // from the other side: a build that took two from one slot and none from
  // another cannot satisfy both.
  const after = launches[launches.length - 1].after;
  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    assertEqual(
      pileOf(after, "foundation", index).length,
      FOUNDATION_DEPTH - 1,
      `cards left on foundation ${index} after the first four launches`,
    );
  }
});
