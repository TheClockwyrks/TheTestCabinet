// maze.symmetry: the maze is mirror-symmetric about its vertical centerline.
import { startPlaying, symmetryMismatches } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.symmetry");
  const snap = await startPlaying(api);
  check.expectEq(
    "the maze is mirror-symmetric about its centerline (no wall/floor mismatches)",
    symmetryMismatches(snap),
    0,
  );
  await api.wait(120);
  await api.screenshot("board");
  return check.verdict();
}
