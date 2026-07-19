// maze.openness-mazing: the board reads as corridors and junctions, not an open
// room. Asserts the FAIL lines (too open / no branching) so a valid maze never flakes.
import { startPlaying, avgOpenNeighbors, junctions } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.openness-mazing");
  const snap = await startPlaying(api);
  check.expectLt(
    "average openness is low (corridors, not an open field)",
    avgOpenNeighbors(snap),
    3.0,
  );
  check.expectGt(
    "the maze has real branching (junctions exist)",
    junctions(snap).length,
    0,
  );
  await api.wait(120);
  await api.screenshot("board");
  return check.verdict();
}
