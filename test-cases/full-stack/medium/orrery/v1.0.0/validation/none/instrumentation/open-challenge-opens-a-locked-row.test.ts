// instrumentation/open-challenge-opens-a-locked-row — `openChallenge` opens a
// locked challenge like any other.
//
// THE RULE. "`openChallenge(mode, index)` — ... A locked row opens like any
// other" (`specs/instrumentation.md`, The challenge), and the same row's other
// half is what "like any other" means: the game moves to the editor "with an
// empty machine, empty histories, no run, and the tray derived from the
// challenge". Progress is not a placement rule here: "Neither operation touches
// progress: the unlocked count, the solved sets, the records, the per-challenge
// stashes, and both `last` figures stand as they are."
//
// WHAT LOCKED MEANS is `specs/modes/campaign.md`: challenges above the unlocked
// count are "locked — Not yet reached. Cannot be entered", and the screen refuses
// them — "`confirm` on a locked one does nothing". This surface is the exception
// the specification writes down, and this item is that exception.
//
// THE CONFIGURATION. A reset session with the unlocked count posed at `1`, so
// every campaign challenge but the first is locked, and the LAST row of the
// course opened from code — the furthest from what is open. The tray is read the
// way `specs/editor.md` makes it readable, by pressing entry `0`, which
// `specs/instrumentation.md` says is derived from the challenge.
//
// THE VERDICT. The locked row is open in the editor, reported under `campaign`
// and its own index, with the tray its challenge derives — and the unlocked count
// is still the `1` it was posed at, so opening it unlocked nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { traySlot } from "../field";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallenge,
  openTitle,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a campaign row above the unlocked count, and unlocks nothing", async () => {
  await openTitle(h);
  await h.debug.setUnlockedCount(1);
  const course = (await h.snapshot()).campaign.count;
  const locked = course - 1;
  assertGreaterThan(
    locked,
    0,
    "with the count at 1 the last row of the course is locked",
  );

  await openChallenge(h, "campaign", locked);
  await captureStill(h, "locked");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "editor",
    "a locked row opens the editor like any other",
  );
  assertNotNull(opened.challenge, "with its challenge open");
  assertEqual(
    opened.challenge?.source,
    "campaign",
    "reported under the campaign",
  );
  assertEqual(opened.challenge?.index, locked, "and under its own index");
  assertEqual(
    opened.campaign.unlockedCount,
    1,
    "and the unlocked count stands exactly where it was posed",
  );

  const entry = derivedTray(
    opened.challenge ?? {
      name: "",
      reagents: [],
      products: [],
      permitted: [],
      target: 1,
    },
  )[0];
  assertNotNull(entry, "the open challenge derives a tray with a first entry");
  await pressAt(h, centerOf(traySlot(0)));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  assertEqual(
    drag?.kind,
    "place",
    "the tray a locked row opens on is live: its first entry begins a placement",
  );
  assertEqual(
    drag?.kind === "place" ? drag.part : null,
    entry?.kind,
    "and that entry is the kind the open challenge derives there",
  );
});
