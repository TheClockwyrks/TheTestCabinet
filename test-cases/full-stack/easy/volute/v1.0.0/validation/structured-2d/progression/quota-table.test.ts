// progression/quota-table — each level runs its own quota.
//
// THE SPEC LINE. `specs/progression.md` — "Levels" fixes one quota per level:
//
//   | Level | Quota |
//   | 1 | 45 |  | 2 | 55 |  | 3 | 65 |  | 4 | 75 |  | 5 | 90 |
//
// and says what the number counts: "The quota is the total number of cores the
// level delivers to the channel, counting the cores standing on it at level
// start". What a level start leaves behind is therefore the quota less those
// cores: "A level begins with the channel seeded as `specs/channel.md` states ...
// and the quota at the level's full value less the cores the channel opens with",
// with `specs/channel.md` fixing that seed at "`12` cores already on the channel"
// (`SEED_COUNT`).
//
// THE DRIVE. `startLevel(n)` for each of the five, which
// `specs/instrumentation.md` defines as opening the level "exactly as the
// interlude before it opens it: ... the quota is what a level start leaves it".
// The snapshot is read with nothing stepped, so no emission can have moved the
// count off what the level opened with.
//
// WHY THE SEEDED TWELVE IS A CONSTANT HERE RATHER THAN A READ. Reading the
// channel back and adding its length would fold a build that seeds the wrong
// number of cores into this point, and that build already fails
// `channel/seeded-twelve`. The figure the specification fixes is the constant, so
// the constant is what the expected value is built from, and this point fails for
// its own reason alone.
//
// TOLERANCES. None. A quota is a count, and the standing tolerances make a count
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVELS, SEED_COUNT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens each level with that level's quota, less the cores it seeds", async () => {
  // The evidence first, so a level that answers wrongly below still leaves a
  // picture of a hall the moment it opened. One tick is stepped only so the frame
  // on the canvas is the opened level's; it moves the train by a third of a unit
  // and cannot reach the inlet's emission condition.
  h.debug.startLevel(LEVELS[0].level);
  await h.step(1);
  captureStill(h, "quota");

  const observed: number[] = [];
  for (const level of LEVELS) {
    h.debug.startLevel(level.level);
    // One frame, because "A pose that opens a level takes effect no later than the
    // end of the next advanced frame" (specs/instrumentation.md), so a caller
    // advances one before it poses or reads further.
    observed.push((await h.step(1)).quotaRemaining);
  }

  LEVELS.forEach((level, index) => {
    assertEqual(
      observed[index],
      level.quota - SEED_COUNT,
      `the cores level ${level.level} has left to emit as it opens, ` +
        `its quota of ${level.quota} less the ${SEED_COUNT} it seeds`,
    );
  });
});
