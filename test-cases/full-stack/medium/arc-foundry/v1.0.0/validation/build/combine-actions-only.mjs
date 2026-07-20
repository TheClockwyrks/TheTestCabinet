// Automated validation for build.combine-actions-only: folding pieces together offers exactly
// two operations and no third. A matching same-type, same-quality pair COMBINEs one quality tier
// higher, and a cross-type set assembles a combination tower through COMBINE SPECIAL. There is
// no action that folds a pair into a result of the same type and quality, which would spend a
// piece for nothing.
//
// A fresh candidate is placed alongside a matching standing tower — the case where a redundant
// third fold action is most tempting — and the inspector's action set is read back.

import { startBuild, placeCandidate, towerAt, snap, clearWave, liveClip } from "../_helpers.mjs";

// The actions a selected base candidate may offer (specs/instrumentation.md). A fold beyond
// `combine` / `comborecipe` is exactly what this check exists to catch.
const CANDIDATE_ACTIONS = ["combine", "downgrade", "keep", "remove"];

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.combine-actions-only");

  await startBuild(api);
  await api.call("setIntegrity", 999);
  const standing = await placeCandidate(api, "capacitor", 3, 2, 7); // near entry: quick wave clear
  await api.call("keep", standing.id); // Wave 1
  await clearWave(api, 200); // reopen build

  const fresh = await placeCandidate(api, "capacitor", 3, 10, 7); // a matching fresh roll
  check.expectOk("a fresh roll matching the standing tower is placed", !!fresh);

  // The press re-arms after a placement; put the held rock away so the inspector shows.
  await api.call("rightClick", 640, 400);
  await api.call("select", fresh.id);
  await api.wait(80); // the panel is read from the last rendered frame
  const buttons = await api.call("panelButtons");
  const actions = [...new Set(buttons.map((b) => b.action))].sort();

  check.expectOk("the inspector offers a COMBINE action", actions.includes("combine"));
  check.expectEq("...and no fold action beyond COMBINE and COMBINE SPECIAL", actions.join(","), CANDIDATE_ACTIONS.join(","));

  const combineButton = buttons.find((b) => b.action === "combine");
  check.expectOk("the COMBINE control reads as a combine", /combine/i.test(String(combineButton?.label)));

  // The fold a redundant action would have duplicated: the pair climbs one quality tier.
  await api.call("combine", fresh.id);
  const s = await snap(api);
  check.expectEq("combining the pair produced one piece a quality tier higher", towerAt(s, 10, 7).quality, 4);
  check.expectEq("...as a firing component", towerAt(s, 10, 7).kind, "component");
  check.expectEq("the consumed footprint hardened into a blocker", towerAt(s, 2, 7).kind, "blocker");
  check.expectEq("consuming the fresh roll made it the harvest, launching the wave", s.phase, "wave");

  await liveClip(api);
  return check.verdict();
}
