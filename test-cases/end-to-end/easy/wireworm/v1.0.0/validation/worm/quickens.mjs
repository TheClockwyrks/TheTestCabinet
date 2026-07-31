// Automated validation for worm.quickens: the worm's step interval shortens each
// level (about 5% per level) down to a floor, so it moves faster on higher levels.
//
// setLevel sets the level through the real path; the level's step interval is read
// back from the snapshot at three levels and must strictly decrease and hold above
// the floor.

export default function item() {
  let i1;
  let i6;
  let i12;

  return {
    id: "worm.quickens",

    // Every operand is an INSTANT read: `setLevel` sets the level through the real
    // path and `wormStepInterval` is available straight away, with no time to
    // advance. So the whole probe lives in `arrange`, which then leaves the board
    // posed on level 12 for `act` to film at speed.
    //
    // Note the intervals are the sim's own SECONDS-valued state read out of the
    // snapshot, not durations to step — they are compared as-is against the spec's
    // ~0.14s and ~0.07s, and must not be converted to ticks.
    // `enterPlay` first is what makes the board LIVE for the still.
    // specs/instrumentation.md is explicit that no control operation starts a run on
    // its own and that `step` only advances live play, so a `reset` + `setLevel`
    // alone leaves the build sitting on its title screen: the intervals below still
    // read correctly (`setLevel` sets the level either way), but `act` would advance
    // a frozen menu and film it, which is exactly what the still used to show.
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
      await api.call("setLevel", 12);
    },

    // Level 12's worm is 32 segments entering one per tile step at about 0.079 s a
    // step, so 300 ticks (2.5 s) is what carries the whole of it onto the board —
    // the still is meant to show the longest, fastest worm the run has, and half of
    // it still off the edge would show neither.
    async act(api) {
      await api.advance(300);
      await api.settle(120); // a real pause so the wound-on worm has painted
      await api.screenshot("cadence");
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
