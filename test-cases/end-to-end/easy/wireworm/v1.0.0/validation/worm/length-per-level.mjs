// Automated validation for worm.length-per-level: the worm lengthens with the level
// (10 at level 1, +2 each level: 10 + 2·(level−1)).
//
// setLevel spawns that level's worm through the real spawnWorm; the segment count is
// read back from the snapshot at three levels.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.length-per-level");

  for (const [level, expected] of [
    [1, 10],
    [6, 20],
    [12, 32],
  ]) {
    await api.reset({ seed: 1 });
    await api.call("setLevel", level);
    const len = (await api.snapshot()).worms[0].segments.length;
    check.expectEq(`level ${level} spawns a ${expected}-segment worm`, len, expected);
  }

  // A still of a longer, higher-level worm on the board.
  await api.reset({ seed: 1 });
  await api.call("setLevel", 8);
  await api.step(1.2); // let the worm wind onto the board
  await api.wait(120);
  await api.screenshot("lengths");

  return check.verdict();
}
