// maze.connected: every open corridor tile is reachable from the forager's start.
import { startPlaying, floodReachable, openTiles } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.connected");
  const snap = await startPlaying(api);
  const total = openTiles(snap).length;
  const reached = floodReachable(snap, snap.forager.tx, snap.forager.ty).size;
  check.expectEq(
    "every open corridor tile is reachable from the forager's start (one connected region)",
    reached,
    total,
  );
  await api.wait(120);
  await api.screenshot("board");
  return check.verdict();
}
