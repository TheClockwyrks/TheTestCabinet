// Automated validation for the Boss sub-item `fission-daughters`.
//
// Cracking the Macromass is a fission chain, not a health bar, and the daughters are what
// makes it one. Six of its 55 decay steps put a DAUGHTER on the path: a lighter but still
// radioactive Isotope, which is heavy in its own right — energy does nothing to it — and
// which decays into its own alpha and beta particles as it in turn is cracked. That is
// what forces a kinetic/nuclear line to be held against a cascade while the strippers
// behind it clear the loose particles.
//
// The check proves all three properties of a daughter against the real simulation:
//
//   1. Fission sheds them. Driving the boss all the way down releases exactly the six
//      daughters its chain names, each born a full Isotope (9 shells).
//   2. A daughter is heavy. The board is stripped bare the moment the first daughter
//      appears and an ENERGY tower is put over it: its shells do not move, and the tower
//      never even acquires it.
//   3. A daughter decays. A kinetic battery is then put on that same daughter, and the
//      atoms it emits are attributed to it by position — credited only while it is
//      unambiguously the nearest heavy — until it is finally neutralized.
//
// TWO boss runs. The second is opened with `poseBossUnderFire` — the twin of
// `bossUnderFire` that uses control ops alone — because `api.reset` throws inside `act`.

import {
  unitById,
  towerById,
  pathGeom,
  placeCovering,
  battery,
  TICK,
} from "../_helpers.mjs";
import {
  bossUnderFire,
  poseBossUnderFire,
  clearBoard,
  BOSS_DAUGHTERS,
  ISOTOPE_SHELLS,
} from "./_boss.mjs";

const MAX_FISSION_TICKS = 9000; // 9000 ticks = the old 150 s cap — game time, not wall clock
const MAX_DECAY_TICKS = 2400; // 2400 ticks = the old 40 s cap
const ENERGY_TICKS = 240; // 240 ticks = the old 4 s
const CREDIT_RADIUS = 60; // a decay particle is emitted just behind its parent

const isDaughter = (u, bossId) => u.type === "isotope" && u.id !== bossId;

export default function item() {
  let bossId;
  let r;
  let daughters; // id -> the snapshot entry it was first seen in
  let firstDaughterId;
  let hpBefore;
  let afterEnergy;
  let everTargeted;
  let everInRange;
  let decay;
  let alpha;
  let beta;

  return {
    id: "boss.fission-daughters",

    // Run one: a battery of Impactor Cleavers with the boss released at the inlet.
    async arrange(api) {
      ({ bossId } = await bossUnderFire(api));
      daughters = new Map();
      alpha = 0;
      beta = 0;
    },

    async act(api) {
      // ---- 1. Fission sheds daughter isotopes ------------------------------------
      // poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          for (const u of s.matter)
            if (isDaughter(u, bossId) && !daughters.has(u.id))
              daughters.set(u.id, u);
          return unitById(s, bossId) == null;
        },
        { max: MAX_FISSION_TICKS, poll: 3 },
      );

      // ---- 2. A daughter is energy-immune ----------------------------------------
      // Re-run to the FIRST daughter, then strip the board so nothing else is firing.
      // Posed, not reset: this is a second run opened from inside `act`.
      const second = await poseBossUnderFire(api);
      firstDaughterId = null;
      await api.until(
        (s) => {
          const d = s.matter.find((u) => isDaughter(u, second.bossId));
          if (d) firstDaughterId = d.id;
          return firstDaughterId != null;
        },
        { max: MAX_FISSION_TICKS, poll: 3 },
      );

      await clearBoard(api);
      await api.call("setEnergy", 100000);
      const g2 = pathGeom((await api.snapshot()).paths[0]);
      const at = unitById(await api.snapshot(), firstDaughterId);
      const emitter = await placeCovering(api, "emitter", g2, at.progress + 40);
      hpBefore = unitById(await api.snapshot(), firstDaughterId).hp;

      // Sample every fixed step, so "never targeted" is a claim about the whole window
      // rather than one lucky frame — and record that the daughter really was inside the
      // tower's range, so a pass cannot come from the two simply never meeting.
      everTargeted = false;
      everInRange = false;
      for (let i = 0; i < ENERGY_TICKS; i += 1) {
        await api.advance(TICK);
        const s = await api.snapshot();
        const u = unitById(s, firstDaughterId);
        if (u == null) break;
        const tw = towerById(s, emitter.id);
        if (tw.targetId === firstDaughterId) everTargeted = true;
        if (Math.hypot(u.x - tw.x, u.y - tw.y) <= tw.range) everInRange = true;
      }
      afterEnergy = unitById(await api.snapshot(), firstDaughterId);

      // ---- 3. A daughter decays into its own particles ----------------------------
      await clearBoard(api);
      await api.call("setEnergy", 100000);
      const from = unitById(await api.snapshot(), firstDaughterId).progress;
      await battery(
        api,
        "cleaver",
        g2,
        from + 30,
        Math.min(g2.length - 30, from + 400),
        3,
      );

      const known = new Set((await api.snapshot()).matter.map((u) => u.id));
      // Poll every TICK: an emitted particle can be stripped between coarser reads, and
      // the credit rule depends on reading it while it is still beside its parent.
      decay = await api.until(
        (s) => {
          const d = unitById(s, firstDaughterId);
          for (const u of s.matter) {
            if (known.has(u.id)) continue;
            known.add(u.id);
            if (u.type !== "atom" || d == null) continue;
            // Credit an emission to this daughter only when the daughter is unambiguously
            // the heavy it came off: close by, and closer than any other heavy on the board.
            const dist = Math.hypot(u.x - d.x, u.y - d.y);
            if (dist > CREDIT_RADIUS || u.pathId !== d.pathId) continue;
            const nearerHeavy = s.matter.some(
              (o) =>
                o.id !== d.id &&
                o.traits.heavy &&
                Math.hypot(u.x - o.x, u.y - o.y) <= dist,
            );
            if (nearerHeavy) continue;
            if (u.electrons >= 6) alpha += 1;
            if (u.electrons === 2) beta += 1;
          }
          return d == null;
        },
        { max: MAX_DECAY_TICKS, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("the boss was cracked all the way down", r.hit);
      check.expectEq(
        "its fission chain sheds exactly six daughter isotopes",
        daughters.size,
        BOSS_DAUGHTERS,
      );
      const born = [...daughters.values()];
      check.expectOk(
        "every daughter is heavy in its own right",
        born.every((u) => u.traits.heavy === true),
      );
      check.expectOk(
        "no daughter arrives bonded — it is a bare isotope",
        born.every((u) => u.traits.bonded === false),
      );
      check.expectOk(
        "each is born a full Isotope of 9 shells",
        born.every((u) => u.maxHp === ISOTOPE_SHELLS),
      );

      check.expectOk(
        "a daughter was released to test on its own",
        firstDaughterId != null,
      );

      check.expectOk(
        "the daughter passed through the energy tower's range",
        everInRange,
      );
      check.expectOk(
        "the daughter survived the energy tower",
        afterEnergy != null,
      );
      check.expectEq(
        "energy damage does nothing to a daughter",
        afterEnergy.hp,
        hpBefore,
      );
      check.expectOk(
        "the energy tower never even targets a daughter",
        everTargeted === false,
      );

      check.expectOk(
        "the daughter was cracked down and neutralized",
        decay.hit,
      );
      check.expectGe(
        "a daughter emits its own alpha particles as it decays",
        alpha,
        1,
      );
      check.expectGe(
        "a daughter emits its own beta particle as it decays",
        beta,
        1,
      );
    },
  };
}
