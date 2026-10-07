// screens/nothing-advances-on-howto — the how-to is still: game time passes and
// every figure the snapshot reports stands, the page shown included, `simTime`
// alone excepted.
//
// THE RULE. `specs/ui.md` tabulates what each screen advances under What advances
// on each screen: for `title`, `howto` and `select` the entry is "Nothing." The
// page is turned by the player and by nobody else — "`state.howtoPage` names the
// page shown, `0` on arriving; `left` and `right` move it by one" — so a page
// that walked on its own would be advancing something the table says advances
// nothing. The one figure the table does not cover is stated in the line above
// it: "`state.simTime` accumulates the frame's delta time on every update,
// whatever the screen", which `specs/instrumentation.md` repeats over the
// snapshot: "`simTime` accumulates the delta time of every update, whatever the
// screen".
//
// THE POSE. The how-to, showing `MIDDLE_PAGE` (`2`) — a page in the MIDDLE of the
// `HOWTO_PAGES` (`5`), so a build that turned a page in either direction shows
// it, where the first and last pages would hide a turn against their own stop.
// Beside it, figures posed away from their resting values so that "holds its
// value" reads something rather than nothing: three campaign challenges
// unlocked, one solved and carrying a record, and that mode's select screen
// landing on a later row. No challenge is open on the how-to, so there is no
// machine and no run to hold still.
//
// THE DRIVE. `SECONDS` (`6`) of game time, divided into `FRAMES` (`180`) whole
// frames — many times the span any of `SPEEDS` needs to turn a cycle, so a build
// that advanced anything here has had ample room to show it.
//
// THE VERDICT. Field by field, the snapshot after the drive reports exactly what
// it reported before it, `simTime` alone excepted; the field list itself is
// unchanged; the screen is still `howto` and its page is still the posed one; and
// `simTime` has risen by exactly the span of game time that passed. That last
// reading is a NEAR one: `specs/instrumentation.md` carries `simTime` as a
// running sum of the frames' own delta times, which "agree to within the rounding
// of that sum rather than bit for bit", so it is never read for equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { FRACTION_TOLERANCE, HOWTO_PAGES } from "../constants";
import {
  captureReplay,
  createHarness,
  openHowto,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The span of game time the how-to is left to run for, and its frames. */
const SECONDS = 6;
const FRAMES = 180;

/** A page with a page on either side of it, so a turn either way is visible. */
const MIDDLE_PAGE = Math.floor((HOWTO_PAGES - 1) / 2);

/** The rest of the figures posed away from rest, so each is a real reading. */
const UNLOCKED = 3;
const SOLVED = 1;
const RECORD_CYCLES = 40;
const LANDS_ON = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every field the snapshot reports stands exactly as it stood, `simTime` apart.
 *
 * Read field by field rather than as one deep comparison of the whole object, so
 * a build that advanced one figure fails naming that figure. The field LIST is
 * compared as well, so a field that went missing or appeared is caught too.
 */
function assertHeld(
  after: OrrerySnapshot,
  before: OrrerySnapshot,
  where: string,
): void {
  const names = (snapshot: OrrerySnapshot): string[] =>
    Object.keys(snapshot)
      .filter((key) => key !== "simTime")
      .sort();
  assertDeepEqual(
    names(after),
    names(before),
    `${where}: the snapshot reports the same fields`,
  );
  for (const key of names(before)) {
    assertDeepEqual(
      (after as unknown as Record<string, unknown>)[key],
      (before as unknown as Record<string, unknown>)[key],
      `${where}: ${key}`,
    );
  }
}

it("holds every snapshot field but simTime while the how-to runs", async () => {
  await openHowto(h);
  await h.debug.setHowtoPage(MIDDLE_PAGE);
  await h.debug.setUnlockedCount(UNLOCKED);
  await h.debug.setSolved("campaign", SOLVED, true);
  await h.debug.setRecord("campaign", SOLVED, "cycles", RECORD_CYCLES);
  await h.debug.setLast("campaign", LANDS_ON);

  const before = await h.snapshot();
  assertEqual(before.screen, "howto", "the drive runs on the how-to screen");
  assertEqual(
    before.howtoPage,
    MIDDLE_PAGE,
    "the page is posed away from the one arriving leaves, with a page each side",
  );
  assertEqual(
    before.campaign.unlockedCount,
    UNLOCKED,
    "and the unlocked count is posed away from rest, so holding it reads something",
  );

  await captureReplay(h, "held", () => h.advanceSeconds(SECONDS, FRAMES));

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "howto",
    "the game is still on the how-to after the drive: nothing advances it off",
  );
  assertEqual(
    after.howtoPage,
    MIDDLE_PAGE,
    "the page is turned by left and right alone, so passing time turns none",
  );
  assertHeld(after, before, "on howto, over six seconds of game time");
  assertNear(
    after.simTime - before.simTime,
    SECONDS,
    FRACTION_TOLERANCE,
    "simTime accumulates the frame's delta time on the how-to like any screen",
  );
});
