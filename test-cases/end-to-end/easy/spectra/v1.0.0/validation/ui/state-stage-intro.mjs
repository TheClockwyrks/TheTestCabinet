// Automated validation for the UI sub-item `state-stage-intro`: the stage-intro
// screen (shown before a wave begins) is reachable, and captured for the reviewer.
//
// From the title, LAUNCH is confirmed with injected keys, which begins the first
// stage — landing on the stage-intro hold. The screen is read back (without
// stepping, so the timed hold does not advance) and captured.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-stage-intro");

  await api.reset();
  await api.call("press", "Enter"); // confirm LAUNCH (the first menu entry)
  await api.wait(120);
  check.expectEq("starting the mode lands on the stage intro", (await api.snapshot()).screen, "stageIntro");
  await api.screenshot("intro");

  return check.verdict();
}
