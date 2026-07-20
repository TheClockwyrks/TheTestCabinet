// maze.corridors-one-wide: no 2x2 block of open corridor exists.
import { startPlaying, count2x2Open } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.corridors-one-wide");
  const snap = await startPlaying(api);
  check.expectEq(
    "no 2x2 block of open corridor (corridors are one tile wide)",
    count2x2Open(snap),
    0,
  );
  await api.wait(120);
  await api.screenshot("board");
  return check.verdict();
}
