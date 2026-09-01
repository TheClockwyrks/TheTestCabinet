// cascade/launch-vx-both-signs — cards launch to both sides.
//
// specs/victory.md's launch table gives a launch's `vx` "a sign chosen with equal
// probability". Over the fifty-two launches of a whole cascade both signs
// therefore occur, and cards leave the table past both edges rather than all
// drifting one way. That is what this point reads, and the SIZE of the speed is
// `launch-vx-magnitude`'s.
//
// WHY BOTH SIGNS AND NOT A BALANCE. "Equal probability" is a statement about a
// distribution, and fifty-two draws cannot decide one: any ratio a check demanded
// would fail some conformant builds by chance. What fifty-two draws CAN say, at a
// chance of one in 2^51 of being wrong, is that a build which always sends cards
// the same way is not drawing a sign at all — a build that dropped the sign, or
// took `Math.abs`, or used a constant, reads one sign fifty-two times.
//
// A flyer's `vx` never changes after the launch, so each reading is the value the
// launch drew.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { DECK_SIZE } from "../constants";
import { type Harness, captureStill, createHarness } from "../harness";
import { openCascade, readLaunches } from "./flight";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("launches cards to the left and to the right over one cascade", async () => {
  await openCascade(harness);

  const launches = await readLaunches(harness, DECK_SIZE);
  await captureStill(harness, "launches");

  const signs = launches.map((launch) => Math.sign(launch.flyer.vx));
  const left = signs.filter((sign) => sign < 0).length;
  const right = signs.filter((sign) => sign > 0).length;

  assertTrue(
    left > 0,
    `at least one of the ${DECK_SIZE} launches to send its card left, and ${left} did`,
  );
  assertTrue(
    right > 0,
    `at least one of the ${DECK_SIZE} launches to send its card right, and ${right} did`,
  );
});
