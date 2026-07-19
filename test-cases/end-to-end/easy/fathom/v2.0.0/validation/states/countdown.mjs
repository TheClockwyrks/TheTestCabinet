// states.countdown: starting a dive opens on the pre-start dive countdown.
export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.countdown");
  await api.reset();
  await api.call("startDive");
  await api.wait(150);
  check.expectEq("starting a dive opens on the countdown", (await api.snapshot()).screen, "countdown");
  await api.screenshot("countdown");
  return check.verdict();
}
