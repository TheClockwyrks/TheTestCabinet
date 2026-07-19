// controls.pause-key: Escape and P each pause a live dive.
import { startPlaying, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-key");

  await startPlaying(api);
  await api.call("press", "Escape");
  check.expectEq("Escape pauses a live dive", (await api.snapshot()).screen, "paused");

  await startPlaying(api);
  await api.call("press", "KeyP");
  check.expectEq("P pauses a live dive", (await api.snapshot()).screen, "paused");

  await clip(api, 700);
  return check.verdict();
}
