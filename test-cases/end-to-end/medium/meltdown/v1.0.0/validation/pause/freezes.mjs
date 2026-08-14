// Automated validation for the Pause sub-item `freezes`.
//
// While paused the simulation does not advance — the surge holds its position, and the
// floor is "visible but frozen behind the pause menu" (`specs/ui.md`, `specs/controls.md`).
//
// THIS IS MEASURED ON THE BUILD'S OWN CLOCK, NOT THROUGH `step`.
//
// The obvious way to check a freeze is to pause and then advance: `advance` bottoms out in
// the debug API's `step`, and on the reference build `step` runs the fixed-timestep update
// through a gate that is closed while the game is not playing, so the unit holds. That is
// what this item used to do, and it was reading the wrong half of the build.
//
// Where a build puts its pause gate is its own business. `specs/gameplay.md` requires the
// simulation be decoupled from rendering, and pause is a SCREEN (`specs/ui.md` lists Paused
// as its own screen, with its own menu) — so a build is equally entitled to hold the pause
// in the shell that drives the clock, feeding its simulation no time at all while the
// pause menu is up, as to hold it inside the simulation's own update. Both freeze the floor
// for the player, which is the whole of what this item's claim says; they differ only in
// what a debug `step` does while the pause menu is up, and `specs/instrumentation.md`
// leaves that ambiguous ("stepping only advances the live game; it has no effect on a menu
// screen" — the pause menu is a required menu, and the paused screen is not the live one).
// A build that gates in the shell walked its Mote right through the old check while its
// clip, filmed in real time, showed the Mote stopping dead exactly as the item asks. The
// verdict contradicted its own evidence.
//
// It was also the wrong measurement in the other direction, which matters more: a build
// whose pause menu opens over a floor that KEEPS RUNNING — the actual defect this item
// exists to catch — passes the old check outright, as long as its `step` happens to be
// gated. The old check could not see the clock a player is on, so it could neither fail
// the defect nor spare the conformant build.
//
// So the freeze is measured where the player experiences it: the clock is handed to the
// build and the sim is watched in REAL TIME, once with the game running and once with it
// paused, and nothing here calls `step` at all. That is the same technique
// `controls.advances-in-real-time` uses to prove the game advances itself, turned around.
//
// TWO LEGS, ON ONE CLOCK, SO NEITHER CAN PASS VACUOUSLY. A frozen unit is also what a
// build that never moves anything looks like — a still of a Mote on the floor cannot tell
// them apart, and neither can a single window. So the SAME unit is measured over the SAME
// window twice: once before the pause, where it must genuinely travel, and once after,
// where it must not. The running leg is what stops a dead build from passing the freeze;
// the paused leg is what stops a live one from passing a broken pause. The clip shows both
// halves in order, which is the contrast the item's video output is named for.

import { newGame, spawn, press, giveClockToBuild } from "../_helpers.mjs";

/**
 * The real-time window each leg is measured over.
 *
 * A Mote covers 60 px/s (`specs/surge.md`), so 1.5 s is about 90 px of travel — a clear
 * fraction of the floor to see moving, and a beat long enough that the stopping afterwards
 * reads as stopping rather than as a hitch.
 */
const WINDOW_MS = 1500;

/**
 * How far the Mote must travel in the running leg to count as walking.
 *
 * Deliberately far below the ~90 px a conformant build covers: the claim being established
 * is only that the sim was live and this measurement can see it, and a build that clamps
 * its per-frame delta (ordinary spiral-of-death protection) legally loses time to the
 * handover stall. A build managing a fifth of real time still clears this; a frozen one
 * reports 0.
 */
const MIN_TRAVEL = 20;

/**
 * How far the Mote may drift in the paused leg and still count as held.
 *
 * Not zero, because the pause and the position are read a round trip apart and a build may
 * resolve an injected key on its next frame rather than inside the call. At a Mote's
 * 1 px/tick that is a pixel per frame of latency, so 4 px is a few frames of slack —
 * twenty times under what the running leg has just shown a live sim covering, so nothing
 * that keeps running can slip through it.
 */
const MAX_DRIFT = 4;

/**
 * How far the simulation clock may move while paused, in seconds.
 *
 * `simTime` is "accumulated simulation time" (`specs/instrumentation.md`), so a frozen sim
 * accumulates none. The same few frames of key latency apply, hence a small allowance
 * rather than an exact zero — against the 1.5 s a running clock gains over the window.
 */
const MAX_CLOCK_DRIFT = 0.1;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export default function item() {
  let mote;
  let walked;
  let paused;
  let held;
  let clockGained;
  let onFloor;

  return {
    id: "pause.freezes",

    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
      mote = await spawn(api, "mote", "left");
    },

    // Both legs run on the build's own clock, so `settle` (real time in both passes) is
    // what spends the window and `advance`/`step` is never called. The record pass is
    // already on that clock; the validate pass is handed it here, which costs this item
    // three real seconds and is the price of measuring the thing the item actually claims.
    async act(api) {
      await giveClockToBuild(api);
      const at = async () => {
        const snap = await api.snapshot();
        return { snap, u: snap.surge.find((x) => x.id === mote) ?? null };
      };

      // Leg one: the game running, under its own power.
      const start = await at();
      await api.settle(WINDOW_MS);
      const running = await at();
      onFloor = Boolean(start.u && running.u);
      walked = onFloor ? dist(start.u, running.u) : 0;

      // Leg two: the same window, paused. Both the position and the clock come from the
      // ONE snapshot taken on the press, so the pair spans the paused window and nothing
      // else — a second round trip here would bill its own latency to the freeze.
      await press(api, "KeyP");
      const atPause = await at();
      paused = atPause.snap.screen;
      await api.settle(WINDOW_MS);
      const after = await at();
      held = atPause.u && after.u ? dist(atPause.u, after.u) : Infinity;
      clockGained = after.snap.simTime - atPause.snap.simTime;

      await api.screenshot("frozen");
    },

    async assert(api, check) {
      check.expectOk(
        "the Mote stayed on the floor for both measurements",
        onFloor,
      );
      check.expectGt(
        "the Mote was walking before the pause, on the build's own clock",
        walked,
        MIN_TRAVEL,
      );
      check.expectEq("the match is paused", paused, "paused");
      check.expectLt(
        "...and the Mote holds its position through the same window while paused",
        held,
        MAX_DRIFT,
      );
      check.expectLt(
        "...and the simulation clock does not advance while paused",
        clockGained,
        MAX_CLOCK_DRIFT,
      );
    },
  };
}
