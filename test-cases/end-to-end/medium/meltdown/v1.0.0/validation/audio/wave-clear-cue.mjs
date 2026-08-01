// Automated validation for the Audio item `wave-clear-cue`: a distinct cue plays when
// a wave clears. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. A wave clears on the
// tick its last unit dies or leaks, and both of those play their own cue, so "the log
// grew as the wave cleared" is true of a build with no wave-clear cue at all. The two
// are separated by differencing: each window below contains exactly ONE unit leaving
// the floor through an exhaust, and only the second one also clears a wave.
//
// The milestone wave is what makes the windows comparable. Containment's midpoint
// wave is a single Core (specs/surge.md), so the wave's last unit is also its only
// one and the clear is reachable with exactly one leak in the window. The control
// leaks the same unit type with no wave running at all — a Core injected during the
// untimed opening phase walks the same floor to the same exhaust, and the run has no
// wave to clear.
//
// THE CLEAR IS DETECTED BY `phase`, NOT BY THE WAVE NUMBER.
//
// This used to wait for `wave >= 11`, and what a build reports as the current `wave`
// while it is sitting in a build phase is not something the specs settle.
// `snapshot.wave` is "current wave number; 0 in the opening phase before wave 1"
// (specs/instrumentation.md), which makes a build phase report the wave just finished —
// but `setWave(n)` "sets the current wave and rebuilds the run to the build phase just
// before wave `n`", which makes that same build phase report the wave about to run. A
// build that clears wave 10 into a build phase still reading `wave: 10` is honouring
// the first of those, and this item would wait out its ceiling and report the clear as
// never having happened.
//
// `phase` names the state without the ambiguity — "opening" | "building" | "wave"
// (specs/instrumentation.md) — and the wave-clear cue is attached to exactly that
// transition, out of "wave" and into the build phase that clearing it begins
// (specs/gameplay.md). Window 1 runs in "opening", so there is no way for it to be
// confused with the clear either.

//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot or a
// leak is itself audible belongs to `audio.fire-cue` and `audio.leak-cue`; requiring
// it here too would fail this item for a defect another item already owns, and the
// comparison below is sound either way — a build that plays nothing at all fails it,
// because then neither window grows.

import {
  newGame,
  spawn,
  armAudio,
  audioCount,
  skipToApproach,
  nearlyOut,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let onLeak;
  let onClear;
  let leaked;
  let cleared;

  return {
    id: "audio.wave-clear-cue",

    // Nothing is built, so a unit released here walks straight out an exhaust. A Core
    // is the slowest unit in the game (30 px/s, so around 32 s to cross), and both
    // windows are one Core doing exactly that — over a minute of walking, none of it
    // the cue. Each crossing is run through unfilmed to its final approach, so the two
    // measured windows are the two departures themselves and nothing else.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      const coreId = await spawn(api, "core", "left");
      await skipToApproach(api, coreId);
      await armAudio(api);
    },

    // Window 1: the opening build phase, one Core walking out. A leak, and no wave to
    // clear. Window 2: the midpoint milestone wave, whose single Core walks out the
    // same way — the same one leak, plus the clear it completes. 600 ticks = 10s,
    // ample for the approach each skip stopped on; 3600 ticks = 60s stays the skip's
    // ceiling, enough for a Core to cross after the wave's spawn delay.
    //
    // Both counts are taken after their skip, so neither window carries any of the
    // walking and the two remain comparable.
    async act(api) {
      const lives0 = (await api.snapshot()).lives;
      const leakBefore = await audioCount(api);
      const out = await api.until((s) => s.lives < lives0, {
        max: 600,
        poll: 6,
      });
      onLeak = (await audioCount(api)) - leakBefore;
      leaked = out.hit;

      await api.call("setWave", 10); // the midpoint Core wave (specs/surge.md)
      await api.call("setLives", 1000000);
      await api.call("startWave");
      // Get the wave genuinely under way before sweeping for its clear. `skipUntil`
      // tests its predicate BEFORE it advances, so a sweep aimed straight at "building"
      // would match the build phase `startWave` was just pressed from, on any build
      // that flips the phase on the next tick rather than inside the call — and the
      // measured window would then contain no wave at all.
      await api.skipUntil((s) => s.phase === "wave", { max: 120, poll: TICK });
      await api.skipUntil(
        (s) =>
          s.phase === "building" ||
          (s.surge.length > 0 && s.surge.every(nearlyOut)),
        { max: 3600, poll: 12 },
      );
      const clearBefore = await audioCount(api);
      const done = await api.until((s) => s.phase === "building", {
        max: 600,
        poll: 6,
      });
      onClear = (await audioCount(api)) - clearBefore;
      cleared = done.hit;
      await api.advance(120); // 2 s on the cleared wave the cue belongs to
    },

    async assert(api, check) {
      check.expectOk(
        "a Core walks out an exhaust with no wave running",
        leaked,
      );
      check.expectOk("the milestone wave's Core leaks and clears it", cleared);
      check.expectGt(
        "a leak that clears a wave plays more than one that does not (the wave-clear cue)",
        onClear,
        onLeak,
      );
    },
  };
}
