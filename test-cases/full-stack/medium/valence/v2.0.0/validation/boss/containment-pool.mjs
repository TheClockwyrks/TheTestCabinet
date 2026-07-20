// Automated validation for the Boss sub-item `containment-pool`.
//
// The Macromass is the one unit carrying both traits at once: a containment pool of 180
// sits in FRONT of a nucleus of 132 shells that only kinetic or nuclear reaches. Breaking
// the pool is therefore not the same event as breaking any other cluster. An ordinary
// bonded cluster becomes its last free atom when its pool is spent; the Macromass instead
// carries on as the heavy isotope it already is, with its nucleus untouched.
//
// The check drives the boss's pool to zero with a real battery and reads the unit back
// the instant the pool breaks: same unit, still heavy, no longer bonded, nucleus at full
// shells, and NOT a free atom. It then strips the board bare, puts an energy tower over
// the exposed nucleus, and confirms energy still cannot touch it — the exposed nucleus is
// a heavy, not fodder for the strippers.

import { unitById, towerById, placeCovering, TICK } from "../_helpers.mjs";
import {
  bossUnderFire,
  clearBoard,
  BOSS_POOL,
  BOSS_NUCLEUS,
} from "./_boss.mjs";

const MAX_POOL_TICKS = 5400; // 5400 ticks = the old 90 s cap — game time, not wall clock
const ENERGY_TICKS = 240; // 240 ticks = the old 4 s — long enough for an Emitter to have fired repeatedly

export default function item() {
  let g;
  let bossId;
  let born;
  let r;
  let exposed;
  let hpBefore;
  let still;
  let everTargeted;
  let everInRange;

  return {
    id: "boss.containment-pool",

    // A battery of Impactor Cleavers along the conduit and the boss released at the
    // inlet, so it travels the whole line under fire.
    async arrange(api) {
      ({ g, bossId } = await bossUnderFire(api));
      born = unitById(await api.snapshot(), bossId);
    },

    // Everything the item checks, in one continuous run: the pool being chipped to zero,
    // and then the exposed nucleus walking past a lone energy tower that cannot touch it.
    // The board is re-posed mid-`act` with control ops only (`clearBoard`, `setEnergy`,
    // `placeCovering`) — `api.reset` would take the clock back and freeze the recording.
    async act(api) {
      // Chip the pool down and read the unit back the instant it breaks. Polling every
      // TICK because the break is a single-frame event and every following assertion
      // reads the state AT it.
      r = await api.until(
        (s) => {
          const u = unitById(s, bossId);
          return u == null || u.traits.bonded === false;
        },
        { max: MAX_POOL_TICKS, poll: TICK },
      );
      exposed = unitById(r.snap, bossId);

      // Strip the board and put an ENERGY tower on the exposed nucleus: energy does
      // nothing to a heavy, so a nucleus that had wrongly become a free atom would give
      // itself away here.
      await clearBoard(api);
      await api.call("setEnergy", 100000);
      const now = unitById(await api.snapshot(), bossId);
      const emitter = await placeCovering(api, "emitter", g, now.progress + 40);
      hpBefore = unitById(await api.snapshot(), bossId).hp;
      // Sample every fixed step, so "never targeted" is a claim about the whole window
      // rather than about one lucky frame — and record that the nucleus really was inside
      // the tower's range, so a pass cannot come from the two simply never meeting.
      everTargeted = false;
      everInRange = false;
      for (let i = 0; i < ENERGY_TICKS; i += 1) {
        await api.advance(TICK);
        const s = await api.snapshot();
        const u = unitById(s, bossId);
        if (u == null) break;
        const tw = towerById(s, emitter.id);
        if (tw.targetId === bossId) everTargeted = true;
        if (Math.hypot(u.x - tw.x, u.y - tw.y) <= tw.range) everInRange = true;
      }
      still = unitById(await api.snapshot(), bossId);
    },

    async assert(api, check) {
      check.expectEq(
        "the boss is released bonded (a containment pool)",
        born.traits.bonded,
        true,
      );
      check.expectEq("...and heavy at the same time", born.traits.heavy, true);
      check.expectEq("its containment pool is 180", born.maxBond, BOSS_POOL);
      check.expectEq(
        "its nucleus is 132 shells behind that pool",
        born.maxHp,
        BOSS_NUCLEUS,
      );

      check.expectOk(
        "the containment pool was broken through",
        r.hit && exposed != null,
      );
      check.expectEq(
        "the same unit carries on past the break",
        exposed.id,
        bossId,
      );
      check.expectEq(
        "breaking the pool exposes the nucleus (no longer bonded)",
        exposed.traits.bonded,
        false,
      );
      check.expectEq(
        "the exposed nucleus is still heavy",
        exposed.traits.heavy,
        true,
      );
      check.expectEq(
        "it is still the boss, not a free atom",
        exposed.type,
        "macromass",
      );
      check.expectEq(
        "it has no electron count — it is not an atom",
        exposed.electrons,
        null,
      );
      check.expectEq(
        "the nucleus behind the pool is untouched by the break",
        exposed.hp,
        BOSS_NUCLEUS,
      );

      check.expectOk(
        "the exposed nucleus is still on the board",
        still != null,
      );
      check.expectOk(
        "the nucleus passed through the energy tower's range",
        everInRange,
      );
      check.expectEq(
        "an energy tower cannot damage the exposed nucleus",
        still.hp,
        hpBefore,
      );
      check.expectOk(
        "the energy tower never even targets it",
        everTargeted === false,
      );
    },
  };
}
