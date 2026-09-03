// instrumentation/set-cleared-opens-the-next-site — the pose writes the one
// clear-flag it names, and the snapshot reports it.
//
// `specs/instrumentation.md` § The run and the screens: "`setCleared(index,
// cleared)` | Sets whether site `index` has been cleared this session, and with
// it which sites are open." The snapshot reports the flags as `cleared`, "one per
// site", and a `reset` leaves "every site uncleared".
//
// THIS CHECK DECIDES THE POSE, NOT WHAT FOLLOWS FROM IT. Which sites are open is
// derived from these flags (`specs/state.md`: "Site `0` is open, and site `n + 1`
// is open once site `n` is cleared"), and the screen that shows it is decided by
// its own review point; a validator that pressed `confirm` on the select screen
// to read it here would fail this item for a menu's defect. What is read here is
// the flag the operation is specified to write.
//
// SITE `2` IS THE ONE POSED because it is neither the first site nor the last, so
// a build that wrote a neighbouring index, or every index, is caught by the five
// flags that must not have moved. The pose is taken on the game as a reset leaves
// it, where every flag stands at `false`, so a flag that reads `true` afterwards
// was written by this call and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SITE_COUNT } from "../constants";
import { createHarness, type Harness } from "../harness";

/** Neither the first site nor the last, so a neighbour's flag reads apart. */
const SITE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the site it names cleared, and no other", async () => {
  const before = (await h.snapshot()).cleared;

  await h.debug.setCleared(SITE, true);
  const after = (await h.snapshot()).cleared;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(before, SITE_COUNT, "the clear flags, one per site");
  for (let site = 0; site < SITE_COUNT; site += 1) {
    assertEqual(
      before[site],
      false,
      `site ${site}'s clear flag before the pose, which a reset leaves false`,
    );
  }

  assertLength(after, SITE_COUNT, "the clear flags after the pose");
  for (let site = 0; site < SITE_COUNT; site += 1) {
    assertEqual(
      after[site],
      site === SITE,
      `site ${site}'s clear flag after setCleared(${SITE}, true), which sets ` +
        "whether that site has been cleared this session and nothing else " +
        "(specs/instrumentation.md)",
    );
  }
});
