// Automated validation for worm.length-per-level: the worm lengthens with the level
// (10 at level 1, +2 each level: 10 + 2·(level−1)).
//
// setLevel spawns that level's worm through the real spawnWorm; the segment count is
// read back from the snapshot at three levels.

const LEVELS = [
  [1, 10],
  [6, 20],
  [12, 32],
];

// The level the still is taken at — mid-table, so the worm is visibly longer than a
// level-1 one without filling the board.
const STILL_LEVEL = 8;

export default function item() {
  const lengths = [];

  return {
    id: "worm.length-per-level",

    // Every operand is an INSTANT read: `setLevel` spawns the level's worm through
    // the real spawnWorm and the segment count is available straight away, with no
    // time to advance. So the whole probe lives in `arrange` — `api.reset` is
    // arrange-only anyway, and this item needs one per level. The board is then left
    // posed at the still's level for `act` to film.
    //
    // `enterPlay` before each `setLevel` is what makes the board LIVE.
    // specs/instrumentation.md is explicit that no control operation starts a run on
    // its own and that `step` only advances live play, so a `reset` + `setLevel`
    // alone leaves the build sitting on its title screen: the segment counts below
    // still read correctly (the worm is spawned either way), but `act` would advance
    // a frozen menu and film it, which is exactly what the still used to show.
    async arrange(api) {
      for (const [level] of LEVELS) {
        await api.reset({ seed: 1 });
        await api.call("enterPlay");
        await api.call("setLevel", level);
        lengths.push((await api.snapshot()).worms[0].segments.length);
      }

      await api.reset({ seed: 1 });
      await api.call("enterPlay");
      await api.call("setLevel", STILL_LEVEL);
    },

    // The worm enters from a side edge along row 0, one segment per tile step, so
    // the whole of it is only on the board once it has taken as many steps as it has
    // segments. Level 8's 24-segment worm steps about every 0.097 s, so 288 ticks
    // (2.4 s) carries all 24 on and leaves the head well clear of the far edge —
    // which is the entire point of the still, a worm visibly longer than level 1's.
    async act(api) {
      await api.advance(288);
      await api.settle(120); // a real pause so the wound-on worm has painted
      await api.screenshot("lengths");
    },

    async assert(api, check) {
      LEVELS.forEach(([level, expected], i) => {
        check.expectEq(
          `level ${level} spawns a ${expected}-segment worm`,
          lengths[i],
          expected,
        );
      });
    },
  };
}
