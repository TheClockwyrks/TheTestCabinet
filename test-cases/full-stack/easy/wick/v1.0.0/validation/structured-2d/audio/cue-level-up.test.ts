// Wick — audio/cue-level-up: every opening of a level-up overlay plays
// `level-up`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `level-up` to "A level-up overlay opens", and "Each is played on the tick
// its event happens, or on the frame for a menu event, and at most once on
// that tick." `specs/progression.md`, The level-up overlay: "A `playing` tick
// that ends with `pendingLevelUps` above `0` runs to completion and then
// opens the overlay", and, under Choosing: "When level-ups remain queued the
// next overlay opens immediately, with a fresh pool". `specs/ui.md`'s
// `levelup` section says the same of the acceptance frame: "Then, if another
// level-up is queued, the next overlay opens with a fresh set of offers".
// Both openings are the same event, so each is exactly one `level-up`.
//
// WHY BOTH OPENINGS ARE DRIVEN HERE. The requirement is "a level-up overlay
// opens", and the second opening reaches it by a different route: not the end
// of a `playing` tick but the frame an offer was accepted on. A build that
// sounds only the first has met the requirement on one route and missed it on
// the other, and one point decides one requirement, so both routes belong to
// this check.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no weapon and no
// passive, with `pendingLevelUps` posed to `2` and one tick run. Holding
// nothing leaves every base weapon and every passive a candidate
// (`specs/progression.md`, The candidate pool), so both overlays fill their
// draw and neither falls back to lamp oil. The world holds no enemy,
// projectile, zone, gem, or pickup and every driver switch is off, so the
// opening tick raises no other cue and nothing advances beneath the overlay.
//
// The second opening is reached with a real `Enter`, not with `choose`: "A
// pose changes the state alone and sounds nothing" and `choose` "Sounds
// nothing" (`specs/instrumentation.md`), so the acceptance the cue belongs to
// has to be the frame a key press makes. `Enter` carries `confirm`
// (`specs/controls.md`).
//
// THE TOLERANCE. None: each opening is one play by the stated rule, and the
// collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, OFFER_COUNT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  tap,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** Two queued level-ups: one overlay from a tick, one from an acceptance. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays level-up on the tick that opens the overlay and on the frame that opens the next", async () => {
  await isolatedRun(h);
  h.debug.setPendingLevelUps(QUEUED);

  await captureReplay(h, "levelup", async () => {
    const opened = await cuesOf(h, () => advanceTicks(h, 1));

    // The premise: the tick really opened a level-up overlay with offers.
    assertEqual(
      opened.result.screen,
      "levelup",
      "the screen the tick with a level-up queued ended on",
    );
    assertEqual(
      opened.result.run.offers.length,
      OFFER_COUNT,
      "the offers the first overlay drew (specs/progression.md, The draw)",
    );
    assertEqual(
      heard(opened.played, CUES.levelUp),
      1,
      "level-up cues on the tick the overlay opened (specs/ui.md, Audio)",
    );

    const accepted = await cuesOf(h, () => tap(h, "Enter"));

    // The premise: the acceptance really opened the queued second overlay.
    assertEqual(
      accepted.result.screen,
      "levelup",
      "the screen the acceptance left, with a level-up still queued",
    );
    assertEqual(
      accepted.result.run.pendingLevelUps,
      QUEUED - 1,
      "the level-ups left queued after the acceptance",
    );
    assertEqual(
      heard(accepted.played, CUES.levelUp),
      1,
      "level-up cues on the frame the next overlay opened (specs/ui.md, Audio)",
    );
  });
});
