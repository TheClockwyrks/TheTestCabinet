// instrumentation/snapshot-resting-values — unused fields rest, they do not vanish.
//
// `specs/instrumentation.md`: "The shape is fixed and every field is present on
// every screen. A field the current screen does not use reports its resting value
// rather than going missing: `summary` is `null` until the expedition ends,
// `coreTimer` and `coreGround` are `null` while no Sample is live, `panel` is
// `null` while no panel is open, `notice` is `null` while no card is armed or on
// screen, `nextTeleportHeight` and `nextTeleportSpeed` are `null` while no
// outcome is posed, `elapsedSeconds` rests at `0` until an expedition begins, and
// `menuIndex` rests at `0` on `in-mine`."
//
// WHY THIS IS ITS OWN POINT. A build that omits a field it is not using reads the
// same as a build that has the field and sets it wrongly: `snapshot.summary` is
// `undefined` either way to a caller that does not look. The distinction matters
// because every check in this project reads the state through one shape, and a
// shape whose keys come and go is one a check cannot compare against.
//
// TWO SCREENS ARE READ, and they are the two that use least of the shape: a fresh
// in-mine expedition, where none of the five is in use and `menuIndex` is
// explicitly at rest; and the title, where the expedition itself has not started.
// Each field is read for PRESENCE first, which is what separates a rest from an
// omission, and then for the value the specification rests it at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertHasProperty, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";

let h: Harness;

/** The fields the specification names, held at rest, plus the menu index. */
function assertResting(s: DeepcoreSnapshot, at: string): void {
  for (const field of [
    "summary",
    "coreTimer",
    "coreGround",
    "panel",
    "notice",
    "nextTeleportHeight",
    "nextTeleportSpeed",
    "elapsedSeconds",
    "menuIndex",
  ] as const) {
    assertHasProperty(s, field, `the snapshot on ${at}`);
  }
  assertNull(s.summary, `summary on ${at}`);
  assertNull(s.coreTimer, `coreTimer on ${at}`);
  assertNull(s.coreGround, `coreGround on ${at}`);
  assertNull(s.panel, `panel on ${at}`);
  assertNull(s.notice, `notice on ${at}`);
  assertNull(s.nextTeleportHeight, `nextTeleportHeight on ${at}`);
  assertNull(s.nextTeleportSpeed, `nextTeleportSpeed on ${at}`);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rests summary, coreTimer, coreGround, panel, notice, the teleport poses and the clock rather than dropping them", async () => {
  // A fresh expedition: nothing has ended, no Sample is live, no panel is open
  // and no card is armed, and the in-mine screen has no menu.
  openScene(h);
  await h.advance(2);
  const inMine = h.snapshot();
  captureStill(h, "resting");

  assertEqual(inMine.screen, "in-mine", "the screen the reading is taken on");
  assertResting(inMine, "in-mine");
  assertEqual(inMine.menuIndex, 0, "menuIndex on in-mine");
  assertEqual(
    inMine.satchel.coreSample,
    false,
    "the Sample the coreTimer rests without",
  );

  // And the title, where the expedition has not started at all.
  openScene(h, { screen: "title" });
  await h.advance(2);
  const title = h.snapshot();

  assertEqual(title.screen, "title", "the screen the reading is taken on");
  assertResting(title, "title");
  assertEqual(
    title.elapsedSeconds,
    0,
    "elapsedSeconds before an expedition has begun",
  );
});
