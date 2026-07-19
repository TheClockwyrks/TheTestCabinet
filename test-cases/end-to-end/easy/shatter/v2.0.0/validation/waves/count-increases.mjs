// Automated validation for the Waves item `count-increases`: clearing every rock advances
// to a new wave with more rocks. A real game is started (wave 1) and its rock count read;
// the field is then cleared, and after the wave banner elapses the real spawner brings in
// the next, denser wave, whose number and count are read back.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("waves.count-increases");

  await api.reset({ seed: 3 });
  await api.call("startGame");
  await api.call("setInvuln", 99);
  const w1 = await api.snapshot();
  check.expectEq("wave 1 is the current wave", w1.wave, 1);
  check.expectEq("wave 1 fields four rocks", w1.rocks.length, 4);

  await api.call("clearRocks"); // as if every rock were destroyed
  await api.step(1.7); // let the WAVE banner elapse and the next wave spawn
  const w2 = await api.snapshot();

  check.expectEq("clearing the field advances to wave 2", w2.wave, 2);
  check.expectEq("wave 2 fields more rocks (five)", w2.rocks.length, 5);

  await api.call("setAutoStep", true);
  await api.wait(900);
  return check.verdict();
}
