// states.paused: a live dive can be paused.
import { startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.paused");
  await startPlaying(api);
  await api.call("press", "Escape");
  await api.wait(150);
  check.expectEq("a live dive pauses", (await api.snapshot()).screen, "paused");
  await api.screenshot("paused");
  return check.verdict();
}
