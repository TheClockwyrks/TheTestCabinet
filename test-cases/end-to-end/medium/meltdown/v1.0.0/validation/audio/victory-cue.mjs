// Automated validation for the Audio item `victory-cue`: the Victory sting plays when
// the final wave is cleared. Audio is read from the Web Audio sources the build starts
// (see `api.audio`).
//
// WHAT A COUNTING PROBE CAN AND CANNOT SETTLE.
//
// `api.audio` reports that a source started and when; it cannot say which cue started
// one. The run is won on the tick the final wave's last unit leaves the floor, and that
// departure plays its own leak cue and clears its own wave, so "the log grew as the run
// was won" is true of a build with no Victory sting at all. Everything below is
// differencing against windows that hold the same events minus the win.
//
// Three windows, each opened on a single departure and each read settled:
//
//   1. A plain leak — one Mote walking out in the opening build phase. No wave to
//      clear, nothing won.
//   2. An ordinary wave clear — the mid-run milestone Core wave (`round(N / 2)`,
//      specs/gameplay.md) run down to its last unit, which leaks and clears it.
//   3. The win — the final wave, the same Core boss wave, run down to its last unit,
//      which leaks, clears it, and ends the run.
//
// What is asserted is that (3) plays MORE than (1) — so the win is audibly marked
// beyond an ordinary departure — and NO LESS than (2) — so a build that has a wave-clear
// cue and then falls silent on the one clear that matters fails.
//
// The honest limit: a build that plays exactly the same cues on the winning clear as on
// any other clear passes both, because a counter cannot tell two same-sized cues apart.
// That case is what this item's CLIP is for, and it is why the item keeps one. Naming
// the limit here rather than pretending to a sharper claim, because the sharper version
// is what previously broke this item — see below.
//
// WHY THE CONTROL IS NOT TAKEN FROM THE FINAL WAVE ITSELF.
//
// It used to be: leak one of the final wave's units for the control, then let the rest
// of it finish for the win. That silently assumed the final wave fields more than one
// unit, and `specs/surge.md` leaves "the per-wave count, spawn timing, and vent split"
// to the build. Three of the four builds this was re-checked against send a single Core
// into wave 20 — an entirely reasonable reading of "the final wave is a Core boss wave"
// — and on every one of them the first leak WAS the win, so the control window swallowed
// the sting and the measured window was empty. The item reported a missing Victory sting
// on builds that play one.
//
// And every window is opened at the same point in a departure's life — the last unit on
// the floor, already on its final approach — so each holds exactly one departure whatever
// the wave's size.
//
// Lives are posed far above what either wave can take, so the whole thing leaking past
// still clears it with lives in hand — which is what Victory requires
// (specs/gameplay.md) — and nothing has to be built or killed.

import {
  newGame,
  spawn,
  armAudio,
  audioSettled,
  skipToApproach,
  nearlyOut,
  giveClockToBuild,
  untilOnOwnClock,
  TICK,
} from "../_helpers.mjs";

/**
 * Pose wave `wave` released and run it, unfilmed, down to its last unit on final
 * approach — the point at which one departure is left to come, whatever the wave's size.
 * Returns the snapshot it stopped on.
 *
 * Polled every 6 ticks rather than 12: on a build whose milestone wave fields two Cores
 * they arrive close together, and a coarse sweep can step over the moment there is
 * exactly one left and land past the clear instead. The caller asserts it stopped
 * somewhere useful.
 */
async function skipToLastUnit(api, wave) {
  await api.call("setWave", wave);
  await api.call("setLives", 1000000);
  await api.call("startWave");
  // Get the wave genuinely under way first. `skipUntil` tests its predicate BEFORE it
  // advances, so a sweep aimed straight at the last unit would match the empty floor of
  // the build phase `startWave` was just pressed from.
  await api.skipUntil((s) => s.phase === "wave", { max: 120, poll: TICK });
  const r = await api.skipUntil(
    (s) =>
      s.screen !== "playing" ||
      (s.surge.length === 1 && s.surge.every(nearlyOut)),
    { max: 3600, poll: 6 },
  );
  return r.snap;
}

export default function item() {
  let onLeak;
  let onClear;
  let onWin;
  let clearOpen;
  let winOpen;
  let leaked;
  let cleared;
  let won;

  return {
    id: "audio.victory-cue",

    // Three departures, each walked up to unfilmed — at a Core's 30 px/s that is minutes
    // of floor-crossing and none of it is a cue — so what is filmed is the departures
    // themselves and the screens they land on.
    clipMs: 12000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      // Window 1's subject: one Mote in the opening build phase, walked to the brink.
      const moteId = await spawn(api, "mote", "left");
      await skipToApproach(api, moteId);
      await armAudio(api);
    },

    // Each window ends on the state change it is about. 600 ticks = 10 s covers any of
    // the filmed approaches; both counts of a window are taken after its skip, so no
    // window carries any walking and the three remain comparable.
    async act(api) {
      const lives0 = (await api.snapshot()).lives;
      await giveClockToBuild(api);
      const leakBefore = await audioSettled(api);
      const plain = await untilOnOwnClock(api, (s) => s.lives < lives0, {
        maxMs: 10000,
      });
      onLeak = (await audioSettled(api)) - leakBefore;
      leaked = plain.hit;

      const s = await api.snapshot();
      clearOpen = await skipToLastUnit(api, Math.round(s.waveCount / 2));
      await giveClockToBuild(api);
      const clearBefore = await audioSettled(api);
      const clear = await untilOnOwnClock(
        api,
        (s2) => s2.phase === "building",
        {
          maxMs: 10000,
        },
      );
      onClear = (await audioSettled(api)) - clearBefore;
      cleared = clear.hit;

      winOpen = await skipToLastUnit(api, s.waveCount);
      await giveClockToBuild(api);
      const winBefore = await audioSettled(api);
      const end = await untilOnOwnClock(api, (s2) => s2.screen === "victory", {
        maxMs: 10000,
      });
      onWin = (await audioSettled(api)) - winBefore;
      won = end.hit;
      await api.advance(120); // 2 s on the Victory screen the sting belongs to
    },

    async assert(api, check) {
      // The premise for the two wave windows: each opened with exactly one unit still to
      // leave, so each holds one departure and one wave clear. Without this a window that
      // overran its own event would report a missing sting.
      check.expectEq(
        "the control window opened on the milestone wave's last unit",
        clearOpen.surge.length,
        1,
      );
      check.expectEq(
        "the win window opened on the final wave's last unit",
        winOpen.surge.length,
        1,
      );

      check.expectOk("a Mote leaks with no wave running", leaked);
      check.expectOk(
        "the milestone wave clears without ending the run",
        cleared,
      );
      check.expectOk("clearing the final wave reaches Victory", won);

      check.expectGt(
        "winning plays more than an ordinary departure does",
        onWin,
        onLeak,
      );
      // A build is free to let the Victory sting stand IN PLACE of the wave-clear cue on
      // the wave that wins — nothing in specs/ui.md orders the two — so this is `>=`,
      // not `>`. What it still catches is a build that marks every other clear and then
      // goes quiet on the one that ends the run.
      check.expectGe(
        "and at least as much as an ordinary wave clear (the Victory sting)",
        onWin,
        onClear,
      );
    },
  };
}
