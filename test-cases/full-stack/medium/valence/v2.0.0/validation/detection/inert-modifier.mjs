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
//
// THREE runs. Only the first is arranged (it opens from a seeded reset); the shielded
// comparison and the Round 37 sweep are posed inside `act` with `poseRun`, since
// `api.reset` throws there.

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  towerById,
  focusOnParent,
  TICK,
  MAP,
} from "../_helpers.mjs";

const SHIELDED_TICKS = 180; // 180 ticks = the old 3 s — long enough for an Emitter to fire repeatedly
const MAX_WAVE_TICKS = 5400; // 5400 ticks = the old 90 s cap — game time, not wall clock

/** Pose a Dimer (optionally shielded) under an Emitter; `begin` opens the run. */
async function poseDimerUnderEmitter(api, begin, { inert }) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.25;
  const tower = await placeCovering(api, "emitter", g, s0);
  await focusOnParent(api);
  const id = await spawnAt(api, {
    type: "dimer",
    inert,
    pathId: 0,
    s: s0 - 40,
  });
  const born = unitById(await api.snapshot(), id);
  return { g, s0, id, tower, born };
}

/** Run the real sim over a posed Dimer, reporting what the tower managed to do to it. */
async function actDimerUnderEmitter(api, posed) {
  let everTargeted = false;
  for (let i = 0; i < SHIELDED_TICKS; i += 1) {
    await api.advance(TICK);
    const s = await api.snapshot();
    if (towerById(s, posed.tower.id).targetId === posed.id) everTargeted = true;
    if (unitById(s, posed.id) == null) break;
  }
  const after = unitById(await api.snapshot(), posed.id);
  return {
    ...posed,
    everTargeted,
    bondNow: after?.bond ?? 0,
    revealed: after?.revealed ?? false,
  };
}

export default function item() {
  let posedPlain;
  let plain;
  let shielded;
  let revealHit;
  let chipped;
  let sawPlain;
  let sawShielded;

  return {
    id: "detection.inert-modifier",

    // A Dimer is not inert by default — the control that shows the tower works at all.
    // It is the run this item arranges; the rest are posed.
    async arrange(api) {
      posedPlain = await poseDimerUnderEmitter(api, startRun, { inert: false });
      sawPlain = false;
      sawShielded = false;
    },

    async act(api) {
      plain = await actDimerUnderEmitter(api, posedPlain);

      // The same Dimer, released shielded — a fresh run, posed with control ops only.
      const posedShielded = await poseDimerUnderEmitter(api, poseRun, {
        inert: true,
      });
      shielded = await actDimerUnderEmitter(api, posedShielded);

      // Reveal it, and the tower that could do nothing to it gets to work. The Dimer has
      // travelled on during the shielded window, so the detector and a stripper are placed
      // over where it is NOW rather than where it started.
      const here = unitById(await api.snapshot(), shielded.id).progress;
      await placeCovering(api, "catalyst", shielded.g, here + 60);
      await placeCovering(api, "emitter", shielded.g, here + 60);
      // 360 ticks = the old 6 s cap, polled every TICK — the reveal is the instant the
      // detector's field reaches it.
      revealHit = await api.until(
        (s) => unitById(s, shielded.id)?.revealed === true,
        {
          max: 360,
          poll: TICK,
        },
      );
      const bondAtReveal = unitById(revealHit.snap, shielded.id).bond;
      // 480 ticks = the old 8 s cap, polled every TICK for the first chip.
      chipped = await api.until(
        (s) => {
          const u = unitById(s, shielded.id);
          return u == null || u.bond < bondAtReveal;
        },
        { max: 480, poll: TICK },
      );

      // The round table applies the modifier for itself: Round 37 sends plain AND shielded
      // Dimers, released by the real wave system. A third posed run.
      await poseRun(api, MAP.single, { round: 37, integrity: 1e9 });
      await api.call("startRound");
      // poll 15 = the old 0.25 s chunk.
      await api.until(
        (s) => {
          for (const u of s.matter) {
            if (u.type !== "dimer") continue;
            if (u.traits.inert) sawShielded = true;
            else sawPlain = true;
          }
          return sawPlain && sawShielded;
        },
        { max: MAX_WAVE_TICKS, poll: 15 },
      );
    },

    async assert(api, check) {
      check.expectEq(
        "a Dimer is not inert by default",
        plain.born.traits.inert,
        false,
      );
      check.expectOk(
        "an ordinary tower chips an unshielded Dimer straight away",
        plain.bondNow < plain.born.maxBond,
      );

      check.expectEq(
        "a shielded Dimer keeps its own bonded trait",
        shielded.born.traits.bonded,
        true,
      );
      check.expectEq(
        "...and carries the inert trait on top of it",
        shielded.born.traits.inert,
        true,
      );
      check.expectEq("it starts undetected", shielded.born.revealed, false);
      check.expectEq(
        "an undetected shielded Dimer stays hidden with no detector present",
        shielded.revealed,
        false,
      );
      check.expectEq(
        "its bond pool is untouched — nothing can chip what it cannot see",
        shielded.bondNow,
        shielded.born.maxBond,
      );
      check.expectOk(
        "the tower never even targets it",
        shielded.everTargeted === false,
      );

      check.expectOk("a detector reveals the shielded Dimer", revealHit.hit);
      check.expectOk("once revealed, a stripper chips its bonds", chipped.hit);

      check.expectOk("the round table releases plain Dimers", sawPlain);
      check.expectOk(
        "...and shielded ones, from the same roster entry",
        sawShielded,
      );
    },
  };
}
