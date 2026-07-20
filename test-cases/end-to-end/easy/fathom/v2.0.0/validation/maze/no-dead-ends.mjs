// maze.no-dead-ends: every corridor tile has at least two open neighbors.
import { startPlaying, deadEnds } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.no-dead-ends");
  const snap = await startPlaying(api);
  check.expectEq(
    "no corridor tile is a dead end (every open tile has >=2 open neighbors)",
    deadEnds(snap).length,
    0,
  );
  await api.wait(120);
  await api.screenshot("board");
  return check.verdict();
}
