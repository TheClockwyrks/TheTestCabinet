// screens/title-visit-keeps-stashed-machines — a visit to the title throws no
// machine away.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "Reaching `title` discards nothing:
// progress, records, and the per-challenge machines of `specs/editor.md` are
// unchanged by the visit." What a per-challenge machine IS, and what "unchanged"
// buys the player, is `specs/editor.md`, Entering and leaving: "The first visit
// in a session opens an empty field; leaving by any route keeps the machine, and
// every later visit in the session restores it exactly, tapes included. Each
// challenge carries its own machine." The snapshot reports which challenges hold
// one as "`stashed`: [<number>], // ascending indices with a stashed machine"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION is one Extras challenge with a machine on it that a careless
// stash would visibly damage: three parts, each carrying a tape of its own, so a
// machine restored without its tapes, or with its parts in another order, is a
// different document. The Extras shelf is used because "Every challenge is
// unlocked from the start" there (`specs/modes/extras.md`), so the later visit
// can be made the way `specs/editor.md` writes the restoring rule about — a
// select row and `confirm` — without posing any progress first.
//
// THE VISIT IS A REAL ONE. The title is reached with `setScreen`, which "Enters
// the screen `name` ... exactly as the real transition into it enters it" and,
// leaving the editor, "leaves it exactly as leaving it in play does: a live run
// is stopped, the open challenge's machine is stashed as `specs/editor.md`
// states, and the challenge is closed" (`specs/instrumentation.md`). Frames are
// then run ON the title, and the highlight moved, so the machine survives a stay
// rather than an instantaneous bounce.
//
// THE VERDICT. At the title the challenge's row is listed among its mode's
// `stashed`, and reopening that row from the select screen hands back the very
// document that was built, part for part and tape for tape.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  openChallenge,
  openTitle,
  partIds,
  pressAction,
  readMachine,
  type Harness,
} from "../harness";

/** The Extras row this check builds a machine on. */
const ROW = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a challenge's machine across a visit to the title", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.extras.count,
    ROW + 1,
    "the Extras shelf holds the row this point builds its machine on",
  );

  await h.debug.setMode("extras");
  await openChallenge(h, "extras", ROW);
  await h.debug.clearMachine();
  await h.debug.placePart("arm", -2, 0, 0);
  await h.debug.placePart("arm", 0, -2, 2);
  await h.debug.placePart("wheel", 2, 0, 0);

  const [first, second, third] = await partIds(h);
  await h.debug.setTapeCell(first ?? -1, 0, "grab");
  await h.debug.setTapeCell(first ?? -1, 1, "rotate-cw");
  await h.debug.setTapeCell(second ?? -1, 2, "drop");
  await h.debug.setTapeCell(third ?? -1, 0, "rotate-ccw");

  const built = await readMachine(h);
  assertEqual(
    built.parts.length,
    3,
    "the machine standing on the challenge is the three parts placed",
  );

  const atTitle = await captureReplay(h, "machine-restored", async () => {
    await h.debug.setScreen("title");
    await h.advance(1);
    await h.debug.setMenuIndex(1);
    await h.advance(2);
    const seen = await h.snapshot();
    await h.debug.setScreen("select");
    await h.debug.setSelectIndex(ROW);
    await pressAction(h, "confirm");
    await h.advance(1);
    return seen;
  });

  assertEqual(
    atTitle.screen,
    "title",
    "the session really visited the title between the two editings",
  );
  assertContains(
    atTitle.extras.stashed,
    ROW,
    "the visit leaves the challenge's machine stashed under its own row",
  );

  const revisited = await h.snapshot();
  assertEqual(
    revisited.screen,
    "editor",
    "the select row opens the challenge again after the visit",
  );
  assertEqual(
    revisited.challenge?.index,
    ROW,
    "the challenge reopened is the one the machine was built on",
  );
  assertDeepEqual(
    await readMachine(h),
    built,
    "the visit to the title discarded no machine, so the challenge reopens with " +
      "its parts and tapes exactly",
  );
});
