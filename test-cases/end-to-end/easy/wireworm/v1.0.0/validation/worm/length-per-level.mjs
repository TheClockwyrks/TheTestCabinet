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
    async arrange(api) {
      for (const [level] of LEVELS) {
        await api.reset({ seed: 1 });
        await api.call("setLevel", level);
        lengths.push((await api.snapshot()).worms[0].segments.length);
      }

      await api.reset({ seed: 1 });
      await api.call("setLevel", STILL_LEVEL);
    },

    async act(api) {
      await api.advance(144); // 144 ticks = the old 1.2s, letting the worm wind onto the board
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
