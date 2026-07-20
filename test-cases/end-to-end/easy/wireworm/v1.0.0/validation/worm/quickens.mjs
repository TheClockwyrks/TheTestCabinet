// Automated validation for worm.quickens: the worm's step interval shortens each
// level (about 5% per level) down to a floor, so it moves faster on higher levels.
//
// setLevel sets the level through the real path; the level's step interval is read
// back from the snapshot at three levels and must strictly decrease and hold above
// the floor.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.quickens");

  await api.reset({ seed: 1 });
  await api.call("setLevel", 1);
  const i1 = (await api.snapshot()).wormStepInterval;
  await api.call("setLevel", 6);
  const i6 = (await api.snapshot()).wormStepInterval;
  await api.call("setLevel", 12);
  const i12 = (await api.snapshot()).wormStepInterval;

  check.expectClose("level 1 step interval is ~0.14 s", i1, 0.14, 0.005);
  check.expectLt("the interval shortens from level 1 to 6", i6, i1);
  check.expectLt("the interval shortens from level 6 to 12", i12, i6);
  check.expectGe("the interval holds at or above the ~0.07 s floor", i12, 0.07);

  // A still of a high-level worm at speed.
  await api.reset({ seed: 1 });
  await api.call("setLevel", 12);
  await api.step(1.0);
  await api.wait(120);
  await api.screenshot("cadence");

  return check.verdict();
}
