// Automated validation for the Audio item `victory-cue`: the Victory sting plays when
// the final wave is cleared. Audio is read from the Web Audio sources the build starts
// (see `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. The run is won on the
// tick the final wave's last unit leaves the floor, and that departure plays its own
// leak cue, so "the log grew as the run was won" is true of a build with no Victory
// sting at all. The two are separated by differencing: both windows below contain
// exactly ONE unit leaving through an exhaust, and only the second one wins the run.
//
// Lives are posed far above what the wave can take, so the whole wave leaking past
// still clears it with lives in hand — which is what Victory requires
// (specs/gameplay.md) — and nothing has to be built or killed.

//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot or a
// leak is itself audible belongs to `audio.fire-cue` and `audio.leak-cue`; requiring
// it here too would fail this item for a defect another item already owns, and the
// comparison below is sound either way — a build that plays nothing at all fails it,
// because then neither window grows.

import { newGame, armAudio, audioCount, nearlyOut } from "../_helpers.mjs";

export default function item() {
  let onLeak;
  let onWin;
  let leaked;
  let won;

  return {
    id: "audio.victory-cue",

    // Posed onto the final wave of a standard run, and then run through unfilmed to
    // the first departure's final approach. The whole of this scenario is units
    // walking a floor — a first leak, the wave grinding down to its last unit, that
    // unit's own crossing — and at Core pace that is minutes. None of it is a cue, so
    // only the two departures are filmed.
    async arrange(api) {
      const s = await newGame(api, "containment", "medium", 100000);
      await api.call("setWave", s.waveCount);
      await api.call("setLives", 1000000);
      await api.call("startWave");
      await api.skipUntil((s2) => s2.surge.some(nearlyOut), {
        max: 3600,
        poll: 12,
      });
      await armAudio(api);
    },

    // Window 1 ends on the first leak of the final wave — a departure that wins
    // nothing. Window 2 opens once a single unit is left and ends at Victory: the
    // same one departure, plus the win it completes. 600 ticks = 10s covers each
    // filmed approach; 3600 ticks = 60s stays the ceiling on the skips between them.
    //
    // Both counts are taken after their skip, so neither window carries any walking
    // and the two remain comparable.
    async act(api) {
      const lives0 = (await api.snapshot()).lives;
      const leakBefore = await audioCount(api);
      const first = await api.until((s) => s.lives < lives0, {
        max: 600,
        poll: 6,
      });
      onLeak = (await audioCount(api)) - leakBefore;
      leaked = first.hit;

      // Wait for the wave to come down to its last unit, so the measured window holds
      // exactly one departure — the one that ends the run — and bring that unit to its
      // own final approach before opening the window.
      await api.skipUntil(
        (s) =>
          s.screen === "victory" ||
          (s.waveRemaining <= 1 &&
            s.surge.length > 0 &&
            s.surge.every(nearlyOut)),
        { max: 3600, poll: 12 },
      );
      const winBefore = await audioCount(api);
      const end = await api.until((s) => s.screen === "victory", {
        max: 600,
        poll: 6,
      });
      onWin = (await audioCount(api)) - winBefore;
      won = end.hit;
      await api.advance(120); // 2 s on the Victory screen the sting belongs to
    },

    async assert(api, check) {
      check.expectOk(
        "a unit of the final wave leaks without ending it",
        leaked,
      );
      check.expectOk("clearing the final wave reaches Victory", won);
      check.expectGt(
        "the winning departure plays more than an ordinary one (the Victory sting)",
        onWin,
        onLeak,
      );
    },
  };
}
