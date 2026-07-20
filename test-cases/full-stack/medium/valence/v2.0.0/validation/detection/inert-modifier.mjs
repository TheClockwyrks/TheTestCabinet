// Automated validation for the Detection sub-item `inert-modifier`.
//
// Inert is a MODIFIER, not a fixed property of three types. Any type may be released
// shielded, whichever traits it already carries, and while it is shielded nothing can
// touch it — a shielded Dimer is a Dimer that must be found before its bonds can even be
// chipped. The check proves the modifier on a type that is NOT inert by default:
//
//   * a Dimer released shielded carries the inert trait on top of its own bonded trait,
//     and starts unrevealed;
//   * an ordinary damage tower cannot see it — it never acquires it and the bond pool
//     does not move — while an identically-posed UNshielded Dimer under the same tower is
//     chipped straight away, so the tower plainly works;
//   * put a detector on it and it is revealed, and the same tower then chips it.
//
// The round table's own use of the modifier is checked too: Round 37 fields both plain
// and shielded Dimers, and the real wave system must release them that way.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, towerById, focusOnParent, liveClip, FIXED, MAP } from "../_helpers.mjs";

const SHIELDED_SECONDS = 3; // long enough for an Emitter to fire repeatedly
const MAX_WAVE_SECONDS = 90; // generous: game time on the manual clock, not wall clock

// Pose a Dimer (optionally shielded) under an Emitter and run the real sim over it,
// reporting what the tower managed to do to it.
async function dimerUnderEmitter(api, { inert }) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.25;
  const tower = await placeCovering(api, "emitter", g, s0);
  await focusOnParent(api);
  const id = await spawnAt(api, { type: "dimer", inert, pathId: 0, s: s0 - 40 });
  const born = unitById(await api.snapshot(), id);

  let everTargeted = false;
  for (let i = 0; i < Math.round(SHIELDED_SECONDS * 60); i += 1) {
    await api.step(FIXED);
    const s = await api.snapshot();
    if (towerById(s, tower.id).targetId === id) everTargeted = true;
    if (unitById(s, id) == null) break;
  }
  const after = unitById(await api.snapshot(), id);
  return { g, s0, id, born, everTargeted, bondNow: after?.bond ?? 0, revealed: after?.revealed ?? false };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.inert-modifier");

  // A Dimer is not inert by default — the control that shows the tower works at all.
  const plain = await dimerUnderEmitter(api, { inert: false });
  check.expectEq("a Dimer is not inert by default", plain.born.traits.inert, false);
  check.expectOk("an ordinary tower chips an unshielded Dimer straight away", plain.bondNow < plain.born.maxBond);

  // The same Dimer, released shielded.
  const shielded = await dimerUnderEmitter(api, { inert: true });
  check.expectEq("a shielded Dimer keeps its own bonded trait", shielded.born.traits.bonded, true);
  check.expectEq("...and carries the inert trait on top of it", shielded.born.traits.inert, true);
  check.expectEq("it starts undetected", shielded.born.revealed, false);
  check.expectEq("an undetected shielded Dimer stays hidden with no detector present", shielded.revealed, false);
  check.expectEq("its bond pool is untouched — nothing can chip what it cannot see", shielded.bondNow, shielded.born.maxBond);
  check.expectOk("the tower never even targets it", shielded.everTargeted === false);

  // Reveal it, and the tower that could do nothing to it gets to work. The Dimer has
  // travelled on during the shielded window, so the detector and a stripper are placed
  // over where it is NOW rather than where it started.
  const here = unitById(await api.snapshot(), shielded.id).progress;
  await placeCovering(api, "catalyst", shielded.g, here + 60);
  await placeCovering(api, "emitter", shielded.g, here + 60);
  const revealHit = await stepUntil(api, (s) => unitById(s, shielded.id)?.revealed === true, 6, FIXED);
  check.expectOk("a detector reveals the shielded Dimer", revealHit.hit);
  const bondAtReveal = unitById(revealHit.snap, shielded.id).bond;
  const chipped = await stepUntil(api, (s) => {
    const u = unitById(s, shielded.id);
    return u == null || u.bond < bondAtReveal;
  }, 8, FIXED);
  check.expectOk("once revealed, a stripper chips its bonds", chipped.hit);

  // The round table applies the modifier for itself: Round 37 sends plain AND shielded
  // Dimers, released by the real wave system.
  await startRun(api, MAP.single, { round: 37, integrity: 1e9 });
  await api.call("startRound");
  let sawPlain = false;
  let sawShielded = false;
  await stepUntil(api, (s) => {
    for (const u of s.matter) {
      if (u.type !== "dimer") continue;
      if (u.traits.inert) sawShielded = true;
      else sawPlain = true;
    }
    return sawPlain && sawShielded;
  }, MAX_WAVE_SECONDS, 0.25);
  check.expectOk("the round table releases plain Dimers", sawPlain);
  check.expectOk("...and shielded ones, from the same roster entry", sawShielded);

  await liveClip(api, 1200);
  return check.verdict();
}
