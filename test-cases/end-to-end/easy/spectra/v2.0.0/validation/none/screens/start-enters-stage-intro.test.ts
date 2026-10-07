// Spectra — screens/start-enters-stage-intro: the mode entry opens stage one.
//
// THE RULE. `specs/ui.md`, on what `confirm` does with the title menu's first
// entry: it "Opens a new run and moves to `stageIntro` at stage `1`, with
// `START_LIVES` lives and a score of `0`." This point decides the screen and the
// stage that opening reaches; the fresh run's own figures are
// `screens/pause-restart`'s and `screens/game-over-play-again`'s, which decide the
// same "a new run" requirement on the two other entries that open one.
//
// THE DISTINGUISHING POSE IS THE STAGE. A run always resets to stage `1`
// (`specs/instrumentation.md`), so a build that merely CHANGES SCREEN, carrying
// whatever stage the game already held, is indistinguishable from one that opens a
// new run — at stage `1`. So the stage is posed to `POSED_STAGE` first, and every
// wrong model then reads as a different number: a confirm wired to nothing leaves
// the game on `title`, a confirm that changes screen without opening a run reaches
// `stageIntro` still at `POSED_STAGE`, a confirm that skips the intro reaches
// `inWave`, and only the route `specs/ui.md` states reaches `stageIntro` at stage
// `1`.
//
// THE HIGHLIGHT IS WHERE A PLAYER FINDS IT. `specs/ui.md` rests it on the first
// item on arriving at the title, which is the mode entry, and `setMenuIndex(0)`
// pins it there so the pose above cannot have moved it.
//
// WHAT IS NOT ASSERTED. That `Enter` is one of `confirm`'s keys is
// `controls/confirm-enter`'s; how long the intro then holds is
// `screens/intro-gives-way`'s; what the intro DRAWS is
// `screens/stage-intro-names-stage`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, MODE_TITLE_ITEM, titleItems } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Which entry of `TITLE_ITEMS` is highlighted before the press. */
const MODE_INDEX = 0;

/**
 * The stage the game is posed at before the run is opened.
 *
 * Any stage but `1`, so "opened a new run" and "changed screen and left the run
 * alone" read as different numbers. `4` is a standard stage rather than a
 * challenge one (`CHALLENGE_EVERY` is `3`), so nothing about the pose depends on
 * the challenge rules.
 */
const POSED_STAGE = 4;

/** The stage a new run opens at (specs/ui.md). */
const FIRST_STAGE = 1;

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the stage-one intro when the mode entry is confirmed", async () => {
  await h.debug.setStage(POSED_STAGE);
  await h.debug.setMenuIndex(MODE_INDEX);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the game is on the title screen (specs/ui.md)",
  );
  assertEqual(
    before.stage,
    POSED_STAGE,
    "posed at a stage a new run would have to leave behind",
  );
  assertEqual(
    titleItems(before.mode)[MODE_INDEX],
    MODE_TITLE_ITEM[before.mode],
    "the first TITLE_ITEMS entry is the mode entry (specs/ui.md, specs/mode.md)",
  );
  assertEqual(
    before.menuIndex,
    MODE_INDEX,
    "the highlight rests on the mode entry before the press",
  );

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "intro");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "stageIntro",
    "confirming the mode entry moving the game to the stage-intro screen " +
      "(specs/ui.md)",
  );
  assertEqual(
    after.stage,
    FIRST_STAGE,
    `the stage the opened run is at — the mode entry opens a NEW run at stage ` +
      `${FIRST_STAGE} (specs/ui.md), so the ${POSED_STAGE} it was posed at is gone`,
  );
});
