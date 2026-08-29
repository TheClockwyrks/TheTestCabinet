// states/countdown — a dive opens on the countdown, and holds everything still.
//
// `specs/ui.md` routes `DIVE` confirmed from the title menu to `"countdown"`, at
// the start of a fresh dive; gives that screen as "the maze view and the HUD,
// with a short `DIVE` countdown drawn over them"; times it — "The dive countdown
// holds for at least `1 s` and at most `3 s` before play begins ... timed on the
// simulation's own accumulated time rather than on the wall clock"; and fixes
// what advances while it runs: "The countdown's own remaining time, and the light
// the forager casts on the maze around it. The forager, the predators, the
// drifters, the cooldowns, the sonar wavefronts and the ink clouds all hold
// still."
//
// THE FREEZE IS MADE A REAL READING, not a trivially true one. A dive opens with
// both cooldowns ready and every predator in the den, so comparing those as they
// stand would compare `0` against `0`. Instead the two cooldowns are POSED to
// values that are plainly mid-run (`specs/instrumentation.md`: each "runs down
// from the posed value on the ordinary curve"), and a movement key is HELD for
// the whole countdown — `specs/movement.md` has the forager travel while one is
// held, and `specs/ui.md` says the countdown screen reads `mute` and nothing
// else. On a build that keeps simulating, one second of countdown moves the
// forager `128` units and drops each cooldown by a second; on a conforming one
// neither moves at all.
//
// AND THE TICKS REALLY RAN. `simTime` "accumulates on every screen"
// (`specs/state.md`), so the same watch that finds nothing moved also reads the
// clock moving, and a build that simply ignored `advance` cannot pass by
// standing still.
//
// THE READING IS TAKEN FROM THE LAST COUNTDOWN TICK, never from the first tick of
// live play: on the tick play resumes the game is entitled to move everything at
// once, and that tick is `"playing"`'s business rather than this point's.
//
// WHAT THIS DOES NOT DECIDE. What the countdown draws over the maze, which is the
// aesthetic rating's; and the HUD's six readouts, which `presentation` and the
// scoring points own. All that is read of the frame here is that the maze's HUD
// is drawn behind the countdown at all, through the depth readout `specs/ui.md`
// fixes the wording of.

import { afterEach, beforeEach } from "vitest";
import { TICK_HZ } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, ticks, type Harness } from "../harness";
import { check } from "../scene";
import {
  CONFIRM_KEY,
  MOVE_KEY,
  assertDrew,
  frameOps,
  watchScreen,
} from "./screens";

/**
 * The window `specs/ui.md` gives the dive countdown, in seconds: "The dive
 * countdown holds for at least `1 s` and at most `3 s` before play begins."
 */
const HOLD_MIN = 1;
const HOLD_MAX = 3;

/**
 * The sonar cooldown posed before the countdown is watched, in seconds.
 *
 * Comfortably short of `SONAR_COOLDOWN` (`1.5`) and comfortably above zero, so a
 * build that kept running the cooldown down would land on a different number
 * well before the countdown's own `3 s` ceiling.
 */
const POSED_SONAR_COOLDOWN = 1.2;

/**
 * The ink cooldown posed alongside it, in seconds. Under `INK_COOLDOWN` (`8`) and
 * far above the countdown's ceiling, so a build that ran it down would still be
 * mid-cooldown and simply report a smaller number.
 */
const POSED_INK_COOLDOWN = 5;

/**
 * The ceiling on the watch, in frames.
 *
 * `specs/ui.md` gives the countdown at most `3 s`. A tick past that is a failure
 * of this point rather than an inconclusive run, so the budget is that bound plus
 * the slack below and nothing more.
 */
const MAX_HOLD_TICKS = ticks(HOLD_MAX) + 2;

/**
 * The uncertainty in the measured hold, in seconds.
 *
 * The countdown begins DURING the frame that delivers the confirm, and gives way
 * DURING the frame after the last one this watch sampled, so the span read below
 * is the true hold to within two ticks either way. Two ticks is `1/60 s` against
 * a window two seconds wide.
 */
const TICK_SLACK = 2 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "opens the dive on the countdown, holds 1-3 s, and freezes the maze behind it",
  async () => {
    h.debug.reset();
    const title = h.snapshot();
    await h.tap(CONFIRM_KEY); // DIVE, the first item of the title menu.
    const entered = h.snapshot();

    // Two clocks that are plainly mid-run, so "the cooldowns hold still" is a
    // reading of something rather than of two zeroes.
    h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
    h.debug.setInkCooldown(POSED_INK_COOLDOWN);
    const before = h.snapshot();

    const ops = await frameOps(h);
    // Before the assertions, so a failing check still leaves the screen it read.
    captureStill(h, "countdown");

    // A movement key held for the whole countdown: on a build that keeps
    // simulating the forager travels, on a conforming one it cannot.
    const watch = await watchScreen(h, "countdown", MAX_HOLD_TICKS, MOVE_KEY);

    assertEqual(
      entered.screen,
      "countdown",
      "the screen DIVE confirmed from the title menu reaches (specs/ui.md)",
    );
    assertDrew(
      ops,
      `DEPTH ${String(before.depth)}`,
      "the HUD's depth readout, drawn behind the countdown because the HUD is " +
        "drawn whenever a maze is on screen (specs/ui.md)",
    );

    assertEqual(
      watch.hit,
      true,
      `the countdown gives way to live play inside ${String(HOLD_MAX)} s of ` +
        "simulated time (specs/ui.md)",
    );
    assertEqual(
      watch.after.screen,
      "playing",
      "the screen the countdown running out reaches (specs/ui.md)",
    );
    assertBetween(
      watch.after.simTime - title.simTime,
      HOLD_MIN - TICK_SLACK,
      HOLD_MAX + TICK_SLACK,
      "seconds of the simulation's own accumulated time the dive countdown " +
        "held for (specs/ui.md)",
    );

    // The ticks really ran, so nothing below is vacuous.
    assertGreaterThan(
      watch.last.simTime - before.simTime,
      0,
      "simulated seconds accumulated while the countdown ran, which every tick " +
        "adds to whatever the screen (specs/state.md)",
    );

    assertEqual(
      watch.last.forager.x,
      before.forager.x,
      "the forager's x while the countdown ran with a movement key held, which " +
        "holds it still (specs/ui.md)",
    );
    assertEqual(
      watch.last.forager.y,
      before.forager.y,
      "the forager's y while the countdown ran with a movement key held",
    );
    assertEqual(
      watch.last.sonar.cooldown,
      before.sonar.cooldown,
      "the sonar cooldown while the countdown ran, which holds it still " +
        "(specs/ui.md)",
    );
    assertEqual(
      watch.last.ink.cooldown,
      before.ink.cooldown,
      "the ink cooldown while the countdown ran, which holds it still " +
        "(specs/ui.md)",
    );
    assertEqual(
      watch.last.predators
        .map((one) => `${String(one.x)},${String(one.y)}`)
        .join(" "),
      before.predators
        .map((one) => `${String(one.x)},${String(one.y)}`)
        .join(" "),
      "where the predators stood while the countdown ran, which holds them " +
        "still (specs/ui.md)",
    );
  },
);
