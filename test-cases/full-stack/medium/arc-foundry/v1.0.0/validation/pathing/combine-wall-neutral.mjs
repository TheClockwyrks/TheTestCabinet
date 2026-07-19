// Automated validation for pathing.combine-wall-neutral: a combine consumes its partner in
// place — the footprint hardens into a blocker rather than opening — so the maze route is
// unchanged across the combine.
//
// Two matching candidates are placed as walls; the maze length is read, then they are
// combined. The route length must be unchanged, the initiator footprint holds the combined
// component, and the consumed partner is a blocker (still a wall).

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.combine-wall-neutral");

  await startBuild(api);
  const a = await placeCandidate(api, "capacitor", 1, 6, 7);
  const b = await placeCandidate(api, "capacitor", 1, 6, 10);
  const lenBefore = (await snap(api)).mazeLength;

  await api.call("setCombineSet", [a.id, b.id]);
  await api.call("combine", a.id);
  const s1 = await snap(api);

  check.expectClose("the combine left the maze route unchanged (wall-neutral)", s1.mazeLength, lenBefore, 0.001);
  check.expectEq("the initiator footprint holds the combined component", towerAt(s1, 6, 7).kind, "component");
  check.expectEq("...one tier higher", towerAt(s1, 6, 7).quality, 2);
  check.expectEq("the consumed partner hardened into a blocker in place (no hole)", towerAt(s1, 6, 10).kind, "blocker");

  await liveClip(api);
  return check.verdict();
}
