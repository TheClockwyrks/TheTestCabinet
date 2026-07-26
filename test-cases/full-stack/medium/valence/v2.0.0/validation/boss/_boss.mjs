// Shared set-up for the Macromass checks (specs/matter.md "The boss — Macromass").
//
// The boss is 616 total shells behind a containment pool of 180, so no single tower — and
// no single tower's coverage window — gets anywhere near it. Every boss scenario therefore
// opens the same way: a run of upgraded Cleavers along the whole conduit, and the boss
// posed at the inlet so it travels the entire line under fire. Everything here only
// ESTABLISHES that situation; the real sim then runs and each check reads the outcome.

import {
  startRun,
  poseRun,
  pathGeom,
  battery,
  spawnAt,
  MAP,
} from "../_helpers.mjs";

export const BOSS_POOL = 180; // MATTER.macromass.bondHP — specs/matter.md
export const BOSS_NUCLEUS = 132; // MATTER.macromass.shells
export const BOSS_DAUGHTERS = 6; // "daughter" entries in its decay chain
export const ISOTOPE_SHELLS = 9; // MATTER.heavy.shells — what a daughter is born with

/** The shared body of `bossUnderFire` / `poseBossUnderFire`; `begin` opens the run. */
async function buildBossUnderFire(
  api,
  begin,
  { towers = 6, from = 0.08, to = 0.92 },
) {
  const snap = await begin(api, MAP.single, { integrity: 1e9 });
  const g = pathGeom(snap.paths[0]);
  const placed = await battery(
    api,
    "cleaver",
    g,
    g.length * from,
    g.length * to,
    towers,
  );
  for (const t of placed) {
    await api.call("upgradeTower", t.id); // -> tier II
    await api.call("upgradeTower", t.id, "B"); // -> tier III IMPACTOR (heavy specialist)
  }
  const bossId = await spawnAt(api, { type: "macromass", pathId: 0, s: 0 });
  return { g, towers: placed, bossId };
}

/**
 * ARRANGE-only. Begin a run with `n` tier-III Impactor Cleavers strung along the conduit
 * and one Macromass released at the inlet. Kinetic damage is the one the boss answers to
 * at every layer (its pool and, behind it, its heavy nucleus), and the Impactor branch is
 * what makes a battery small enough to place actually crack 312 points of it inside the
 * boss's transit. Returns `{ g, towers, bossId }`.
 */
export async function bossUnderFire(api, opts = {}) {
  return buildBossUnderFire(api, startRun, opts);
}

/**
 * Twin of `bossUnderFire` callable from EITHER phase (no `reset`, so it does not take the
 * clock back mid-recording). Same set-up and same return shape; see the `poseX` note in
 * `../_helpers.mjs`. The fission check opens its second boss run with this, from `act`.
 */
export async function poseBossUnderFire(api, opts = {}) {
  return buildBossUnderFire(api, poseRun, opts);
}

/**
 * Sell every built tower, so nothing on the board is dealing damage any more.
 * Control ops only — callable from either phase, which is what lets an item stop the
 * fire part-way through `act` and watch what the boss does unmolested.
 */
export async function clearBoard(api) {
  for (const t of (await api.snapshot()).towers)
    await api.call("sellTower", t.id);
}
