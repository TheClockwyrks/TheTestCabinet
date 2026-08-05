// Automated validation for worm.quickens: the worm's step interval shortens each
// level (about 5% per level) down to a floor, so it moves faster on higher levels.
//
// setLevel sets the level through the real path; the level's step interval is read
// back from the snapshot at three levels and must strictly decrease and hold above
// the floor.

// How long each level is filmed winding, and how much of each level's worm entry
// is skipped (run instantly, unfilmed) so the clip opens on a worm already on the
// board rather than on an empty one.
const WATCH_TICKS = 300; // 2.5s per level
const ENTRY_SKIP_L1 = 200; // 10 segments at 0.14s a tile
const ENTRY_SKIP_L12 = 320; // 32 segments at ~0.08s a tile

export default function item() {
  let i1;
  let i6;
  let i12;

  return {
    id: "worm.quickens",

    // Every operand is an INSTANT read: `setLevel` sets the level through the real
    // path and `wormStepInterval` is available straight away, with no time to
    // advance. So the whole probe lives in `arrange`, which then leaves the board
    // posed on level 1 with its worm already wound on, for `act` to film at speed.
    //
    // Note the intervals are the sim's own SECONDS-valued state read out of the
    // snapshot, not durations to step — they are compared as-is against the spec's
    // ~0.14s and ~0.07s, and must not be converted to ticks.
    // `enterPlay` first is what makes the board LIVE for the recording.
    // specs/instrumentation.md is explicit that no control operation starts a run on
    // its own and that `step` only advances live play, so a `reset` + `setLevel`
    // alone leaves the build sitting on its title screen: the intervals below still
    // read correctly (`setLevel` sets the level either way), but `act` would advance
    // a frozen menu and film it.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("enterPlay");
      await api.call("setLevel", 1);
      i1 = (await api.snapshot()).wormStepInterval;
      await api.call("setLevel", 6);
      i6 = (await api.snapshot()).wormStepInterval;
      await api.call("setLevel", 12);
      i12 = (await api.snapshot()).wormStepInterval;

      await api.reset({ seed: 1 });
      await api.call("enterPlay");
      await api.call("setLevel", 1);
      // `skip` runs the entry instantly in BOTH passes, so the clip opens on a worm
      // that is already winding rather than on an empty board.
      await api.skip(ENTRY_SKIP_L1);
    },

    // A cadence is a SPEED, and a speed cannot be read off a still. The output used
    // to be one screenshot of a level-12 worm, which showed a long worm and told a
    // reviewer nothing about how fast it was moving — the very thing this item is
    // about. So the clip is a before/after instead: a couple of seconds of level 1
    // winding at its 0.14 s cadence, then the same stretch of level 12 at ~0.08 s,
    // with the HUD's level readout saying which is which. Watching the two back to
    // back is what makes the difference legible.
    //
    // `setLevel` spawns that level's worm for it, so the entry is skipped (instant
    // in both passes, unfilmed) exactly as it was for level 1 — the clip cuts from
    // one worm at speed to the other, with no empty board in between.
    async act(api) {
      await api.advance(WATCH_TICKS);
      await api.call("setLevel", 12);
      await api.skip(ENTRY_SKIP_L12);
      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      check.expectClose("level 1 step interval is ~0.14 s", i1, 0.14, 0.005);
      check.expectLt("the interval shortens from level 1 to 6", i6, i1);
      check.expectLt("the interval shortens from level 6 to 12", i12, i6);
      check.expectGe(
        "the interval holds at or above the ~0.07 s floor",
        i12,
        0.07,
      );
    },
  };
}
