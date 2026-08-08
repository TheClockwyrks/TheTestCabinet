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
// The round table's own use of the modifier is a separate item — `inert-round-table`,
// which drives the real Round 37 wave. This one is about the modifier itself, so it runs
// entirely on posed matter over a scenario round.
//
// TWO runs. Only the first is arranged (it opens from a seeded reset); the shielded
// comparison is posed inside `act` with `poseScenario`, since `api.reset` throws there.

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  placeCoveringNear,
  spawnAt,
  unitById,
  towerById,
  focusOnParent,
  clipBudget,
  TAIL_TICKS,
  TICK,
  MAP,
} from "../_helpers.mjs";

const SHIELDED_TICKS = 180; // 180 ticks = the old 3 s — long enough for an Emitter to fire repeatedly
const MAX_REVEAL_TICKS = 360;
const MAX_CHIP_TICKS = 480;

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
  // A single swept `until` rather than 180 separate `advance(1)` + `snapshot()` pairs. The
  // loop cost two driver round trips per tick — 360 of them per scenario, and two scenarios
  // — which on the record pass is a great deal of wall clock spent on nothing, and it is
  // that overhead (not the game) that was eating the filming budget before the reveal this
  // item builds to was reached.
  await api.until(
    (s) => {
      if (towerById(s, posed.tower.id)?.targetId === posed.id) {
        everTargeted = true;
      }
      return unitById(s, posed.id) == null;
    },
    { max: SHIELDED_TICKS, poll: TICK },
  );
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

  return {
    id: "detection.inert-modifier",

    clipMs: clipBudget(
      2 * SHIELDED_TICKS + MAX_REVEAL_TICKS + MAX_CHIP_TICKS + TAIL_TICKS,
    ),

    // A Dimer is not inert by default — the control that shows the tower works at all.
    // It is the run this item arranges; the rest are posed.
    async arrange(api) {
      posedPlain = await poseDimerUnderEmitter(api, startScenario, {
        inert: false,
      });
    },

    async act(api) {
      plain = await actDimerUnderEmitter(api, posedPlain);

      // The same Dimer, released shielded — a fresh run, posed with control ops only.
      const posedShielded = await poseDimerUnderEmitter(api, poseScenario, {
        inert: true,
      });
      shielded = await actDimerUnderEmitter(api, posedShielded);

      // Reveal it, and the tower that could do nothing to it gets to work. The Dimer has
      // travelled on during the shielded window, so the detector and a stripper are placed
      // over where it is NOW rather than where it started.
      //
      // Placed NEAR that point rather than at one exact arc length: where the Dimer has got
      // to is decided by the simulation, and a build whose map has no legal tower position
      // beside that particular spot made the whole item inconclusive — which produces no
      // media at all, and is very likely what "the Opus build produced nothing" was.
      const here = unitById(await api.snapshot(), shielded.id).progress;
      const at = here + 60;
      await placeCoveringNear(api, "catalyst", shielded.g, at);
      await placeCoveringNear(api, "emitter", shielded.g, at);
      // 360 ticks = the old 6 s cap, polled every TICK — the reveal is the instant the
      // detector's field reaches it.
      revealHit = await api.until(
        (s) => unitById(s, shielded.id)?.revealed === true,
        {
          max: MAX_REVEAL_TICKS,
          poll: TICK,
        },
      );
      // Guarded: if the Dimer never got revealed (or is gone), the assertions below report
      // that; an unguarded read would throw and be reported as a broken debug API.
      const atReveal = unitById(revealHit.snap, shielded.id);
      const bondAtReveal = atReveal ? atReveal.bond : 0;
      // 480 ticks = the old 8 s cap, polled every TICK for the first chip.
      chipped = await api.until(
        (s) => {
          const u = unitById(s, shielded.id);
          return u == null || u.bond < bondAtReveal;
        },
        { max: MAX_CHIP_TICKS, poll: TICK },
      );
      // Held on the revealed cluster being chipped, so the change the item builds to is on
      // the recording rather than the frame it ended on.
      await api.advance(TAIL_TICKS);
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
    },
  };
}
