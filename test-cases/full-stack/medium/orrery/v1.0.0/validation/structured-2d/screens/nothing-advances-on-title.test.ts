// screens/nothing-advances-on-title — the title screen is still: game time passes
// and every figure the snapshot reports stands, `simTime` alone excepted.
//
// THE RULE. `specs/ui.md` tabulates what each screen advances under What advances
// on each screen: for `title`, `howto` and `select` the entry is "Nothing." The
// one figure that is not covered by it is stated in the line above the table —
// "`state.simTime` accumulates the frame's delta time on every update, whatever
// the screen" — which `specs/instrumentation.md` repeats over the snapshot:
// "`simTime` accumulates the delta time of every update, whatever the screen".
// So on the title the whole snapshot is frozen but for that one running sum.
//
// THE POSE. The title, reached by `reset` as the game's own opening reaches it,
// with figures deliberately AWAY FROM THEIR RESTING VALUES so that "holds its
// value" is a reading of something rather than a reading of nothing: the
// highlight on the last of `TITLE_ITEMS`, the mode on `extras`, three campaign
// challenges unlocked, one of them solved and carrying a record, and that mode's
// select screen landing on a later row. Nothing else is on the field: no
// challenge is open on the title, so there is no machine and no run to hold
// still, and no faculty gate is needed for a screen that runs nothing.
//
// THE DRIVE. `SECONDS` (`6`) of game time, divided into `FRAMES` (`180`) whole
// frames, which is many times the span any of `SPEEDS` needs to turn a cycle —
// so a build that advanced anything at all on the title has had ample room to
// show it.
//
// THE VERDICT. Field by field, the snapshot after the drive reports exactly what
// it reported before it, `simTime` alone excepted; the field list itself is
// unchanged; the screen is still `title`; and `simTime` has risen by exactly the
// span of game time that passed. That last reading is a NEAR one:
// `specs/instrumentation.md` carries `simTime` as a running sum of the frames'
// own delta times, which "agree to within the rounding of that sum rather than
// bit for bit", so it is never read for equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { FRACTION_TOLERANCE, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The span of game time the title is left to run for, and its frames. */
const SECONDS = 6;
const FRAMES = 180;

/** The figures posed away from rest, so every one of them is a real reading. */
const HIGHLIGHT = TITLE_ITEMS.length - 1;
const UNLOCKED = 3;
const SOLVED = 1;
const RECORD_COST = 12;
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

it("holds every snapshot field but simTime while the title screen runs", async () => {
  await openTitle(h);
  await h.debug.setMode("extras");
  await h.debug.setMenuIndex(HIGHLIGHT);
  await h.debug.setUnlockedCount(UNLOCKED);
  await h.debug.setSolved("campaign", SOLVED, true);
  await h.debug.setRecord("campaign", SOLVED, "cost", RECORD_COST);
  await h.debug.setLast("campaign", LANDS_ON);

  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the drive runs on the title screen");
  assertEqual(
    before.menuIndex,
    HIGHLIGHT,
    "the highlight is posed away from its resting value before the drive",
  );
  assertEqual(
    before.campaign.unlockedCount,
    UNLOCKED,
    "and so is the unlocked count, so holding it is a reading of something",
  );

  await captureReplay(h, "held", () => h.advanceSeconds(SECONDS, FRAMES));

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the game is still on the title after the drive: nothing advances it off",
  );
  assertHeld(after, before, "on title, over six seconds of game time");
  assertNear(
    after.simTime - before.simTime,
    SECONDS,
    FRACTION_TOLERANCE,
    "simTime accumulates the frame's delta time on the title like any screen",
  );
});
