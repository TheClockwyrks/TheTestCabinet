// screens/nothing-advances-on-select — the select screen is still: game time
// passes and every figure the snapshot reports stands, the highlighted row
// included, `simTime` alone excepted.
//
// THE RULE. `specs/ui.md` tabulates what each screen advances under What advances
// on each screen: for `title`, `howto` and `select` the entry is "Nothing." The
// highlight is moved by the player and by nobody else — `specs/ui.md`'s Menu
// navigation: "Menus and select lists are worked from the keyboard alone, through
// the registered actions of `specs/controls.md`: `up` and `down` move the
// highlight" — so a row that walked on its own would be advancing something the
// table says advances nothing. The one figure the table does not cover is stated
// in the line above it: "`state.simTime` accumulates the frame's delta time on
// every update, whatever the screen", which `specs/instrumentation.md` repeats
// over the snapshot: "`simTime` accumulates the delta time of every update,
// whatever the screen".
//
// THE POSE. The `extras` select screen, which `specs/modes/extras.md` leaves
// entirely unlocked, so the row the check holds still is a row the screen would
// let a player stand on. `selectIndex` is posed to `ROW` (`3`) — away from the
// `0` the snapshot names as its resting value, and with rows on either side of
// it, so a highlight that walked in either direction shows rather than being
// hidden against an end. Beside it, figures posed away from their resting values
// so that "holds its value" reads something rather than nothing: three campaign
// challenges unlocked, one extras challenge solved and carrying a record. No
// challenge is open on the select screen, so there is no machine and no run to
// hold still.
//
// THE DRIVE. `SECONDS` (`6`) of game time, divided into `FRAMES` (`180`) whole
// frames — many times the span any of `SPEEDS` needs to turn a cycle, so a build
// that advanced anything here has had ample room to show it.
//
// THE VERDICT. Field by field, the snapshot after the drive reports exactly what
// it reported before it, `simTime` alone excepted; the field list itself is
// unchanged; the screen is still `select` and its highlight is still the posed
// row; and `simTime` has risen by exactly the span of game time that passed. That
// last reading is a NEAR one: `specs/instrumentation.md` carries `simTime` as a
// running sum of the frames' own delta times, which "agree to within the rounding
// of that sum rather than bit for bit", so it is never read for equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  openSelect,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The span of game time the select screen is left to run for, and its frames. */
const SECONDS = 6;
const FRAMES = 180;

/** A row with rows on either side of it, so a walk either way is visible. */
const ROW = 3;

/** The rest of the figures posed away from rest, so each is a real reading. */
const UNLOCKED = 3;
const SOLVED = 1;
const RECORD_AREA = 9;

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

it("holds every snapshot field but simTime while the select screen runs", async () => {
  await openSelect(h, "extras");
  await h.debug.setSelectIndex(ROW);
  await h.debug.setUnlockedCount(UNLOCKED);
  await h.debug.setSolved("extras", SOLVED, true);
  await h.debug.setRecord("extras", SOLVED, "area", RECORD_AREA);

  const before = await h.snapshot();
  assertEqual(before.screen, "select", "the drive runs on the select screen");
  assertEqual(before.mode, "extras", "on the mode that locks nothing");
  assertEqual(
    before.selectIndex,
    ROW,
    "the highlight is posed away from row 0, with a row on either side of it",
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
    "select",
    "the game is still on select after the drive: nothing advances it off",
  );
  assertEqual(
    after.selectIndex,
    ROW,
    "the highlight is moved by up and down alone, so passing time moves none",
  );
  assertHeld(after, before, "on select, over six seconds of game time");
  assertNear(
    after.simTime - before.simTime,
    SECONDS,
    FRACTION_TOLERANCE,
    "simTime accumulates the frame's delta time on select like any screen",
  );
});
