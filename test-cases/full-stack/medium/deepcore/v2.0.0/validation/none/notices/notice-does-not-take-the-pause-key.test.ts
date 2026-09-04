// notices/notice-does-not-take-the-pause-key — the card has no claim on `pause`.
//
// `specs/controls.md` binds `pause` in the mine to "Open the pause menu, or
// close an open panel", with no exception for a notice. `specs/hazards.md` gives
// the card exactly two ends: "A click on the card dismisses it at once" and it
// "fades on its own after `NOTICE_FADE` (`8`) seconds". A key that took the card
// away instead of opening the pause menu would be a third end the specification
// does not give it, and a control that stops doing what the table says it does.
//
// TWO INSTANTS, ONE EDGE CASE. The card "appears `NOTICE_DELAY` (`1.5`) seconds
// after the hit", so there is a window in which the notice is armed and nothing
// is on screen. Both instants are read here rather than in two points, because
// they exercise the same requirement the same way — the first is simply the one
// where a build that eats the key also burns the one-time card without the
// player ever having seen it.
//
// The pause menu is left by posing the screen back rather than by pressing
// anything, so the second half reads a key struck into live play rather than a
// key struck into whatever the build does with a menu.
//
// ISOLATION. The notice scene's own world: an empty mine, one gas pocket, a hull
// big enough to survive it and a miner whose body is held still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** Comfortably past the delay, and still far short of the fade. */
const SHOWN_AT = NOTICE_DELAY + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the pause menu while the card is armed and while it is shown", async () => {
  await openNoticeScene(h);
  const row = gasRow(await h.snapshot());

  const run = await captureReplay(h, "paused", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    const armed = await h.snapshot();

    // The card is armed and not yet drawn.
    await h.tap(ACTION_KEY.pause);
    const pausedEarly = await h.snapshot();

    // Back to live play without pressing anything, then on past the delay.
    await h.debug.setScreen("in-mine");
    await elapse(h, SHOWN_AT);
    const shown = await h.snapshot();

    await h.tap(ACTION_KEY.pause);
    const pausedLate = await h.snapshot();
    return { blast, armed, pausedEarly, shown, pausedLate };
  });

  assertEqual(run.blast.cut.broke, true, "the pocket detonated");
  assertNotNull(run.armed.notice, "specs/hazards.md: the hit arms the notice");
  assertEqual(
    run.armed.notice?.shown,
    false,
    "specs/hazards.md: the card appears NOTICE_DELAY after the hit",
  );

  assertEqual(
    run.pausedEarly.screen,
    "paused",
    "specs/controls.md: pause opens the pause menu while the card is armed",
  );
  assertNotNull(
    run.pausedEarly.notice,
    "specs/hazards.md: the key did not take the armed card away",
  );

  assertEqual(
    run.shown.notice?.shown,
    true,
    "specs/hazards.md: the card is drawn once the delay has passed",
  );
  assertEqual(
    run.pausedLate.screen,
    "paused",
    "specs/controls.md: pause opens the pause menu while the card is shown",
  );
  assertEqual(
    run.pausedLate.notice?.shown,
    true,
    "specs/hazards.md: the key did not take the shown card away",
  );
});
