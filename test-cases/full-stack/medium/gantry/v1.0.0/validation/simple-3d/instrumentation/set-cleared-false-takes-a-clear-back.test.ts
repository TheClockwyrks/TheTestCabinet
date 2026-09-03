// instrumentation/set-cleared-false-takes-a-clear-back — the pose takes a clear
// back as readily as it grants one.
//
// `specs/instrumentation.md` § The run and the screens: "`setCleared(index,
// cleared)` | Sets whether site `index` has been cleared this session, and with
// it which sites are open." `cleared` is the argument, so `false` is as much a
// value it sets as `true` is: the flag it names reads `false` afterwards, and
// with it the site after this one is closed again (`specs/state.md`: "Site `0` is
// open, and site `n + 1` is open once site `n` is cleared").
//
// THE DIRECTION THIS CHECK DECIDES IS THE `false` ONE, which is why the flag is
// granted first: a build that only ever wrote `true`, or that read its argument
// as "clear it", passes every reading a `setCleared(index, true)` takes and fails
// only here. Site `0` is the one posed, so what the pose closes again is site `1`
// — the first site a clear ever opens.
//
// What a closed site does to the select screen is decided by its own review
// point, which is where the menu's `confirm` belongs; this check reads the flag
// the operation is specified to write, and reads the other five to show that the
// call put nothing back that it had not taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SITE_COUNT } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The first site: the one whose clear is what opens the site after it. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks a cleared site uncleared again", async () => {
  await h.debug.setCleared(SITE, true);
  const granted = (await h.snapshot()).cleared;

  await h.debug.setCleared(SITE, false);
  const taken = (await h.snapshot()).cleared;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    granted[SITE],
    true,
    `site ${SITE}'s clear flag after setCleared(${SITE}, true), which is the ` +
      "clear this check takes back",
  );
  assertEqual(
    taken[SITE],
    false,
    `site ${SITE}'s clear flag after setCleared(${SITE}, false), which sets ` +
      "whether that site has been cleared this session " +
      "(specs/instrumentation.md)",
  );
  for (let site = 0; site < SITE_COUNT; site += 1) {
    if (site === SITE) continue;
    assertEqual(
      taken[site],
      false,
      `site ${site}'s clear flag, which neither call names`,
    );
  }
});
