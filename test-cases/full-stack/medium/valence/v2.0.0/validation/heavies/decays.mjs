// Automated validation for the Heavies sub-item `decays`.
//
// As it is worn down a heavy isotope sheds alpha (6-electron) and beta (2-electron) atoms
// and transmutes toward a stable nucleus, finally neutralizing. An Isotope carries 9
// shells and a chain of two alphas and a beta, which is more than one tower's coverage
// window will strip, so the check cracks it with a short battery of Cleavers and watches
// the real matter list as it passes: alpha and beta free atoms appear, and the isotope is
// finally gone.
//
// The isotope is posed at the UPSTREAM EDGE of the first Cleaver's range rather than at the
// inlet. It is the same scenario either way — the verdict never depended on the approach —
// but an isotope released at the inlet spends its first six seconds walking to the battery
// at 36 px/s, and the record pass films from the start of `act`: most of the clip was that
// walk, and the decay it exists to show ran on past the end of the filming budget. Starting
// it where the fire starts spends the whole clip on the cracking. A tail then runs on past
// the last emission, because a shed particle is born at its parent's own position
// (specs/board.md) and needs a moment to separate from it before the pile reads as a stream.

import {
  startScenario,
  pathGeom,
  battery,
  spawnAt,
  unitById,
  towerById,
  firstInRange,
  decayKind,
  MAP,
} from "../_helpers.mjs";

const MAX_CRACK_TICKS = 2400; // 2400 ticks = the old 40 s cap — game time, not wall clock
const TAIL_TICKS = 120; // 2 s, so the shed alpha/beta particles pull clear of the nucleus

export default function item() {
  let id;
  let r;
  // Sightings accumulate across `act`; a fresh pair per pass.
  let sawAlpha;
  let sawBeta;

  return {
    id: "heavies.decays",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const placed = await battery(
        api,
        "cleaver",
        g,
        g.length * 0.2,
        g.length * 0.7,
        3,
      );
      const first = towerById(await api.snapshot(), placed[0].id);
      id = await spawnAt(api, {
        type: "isotope",
        pathId: 0,
        s: firstInRange(g, first),
      });
      sawAlpha = false;
      sawBeta = false;
    },

    // The isotope walking the Cleaver line, shedding particles and transmuting down.
    async act(api) {
      // Classify each particle by what it was BORN as (`decayKind`, off `maxHp`), never by
      // its live `electrons`. The battery is stripping these particles as they appear, and
      // a 6-electron alpha coming apart passes through 4 and then 2 on its way down: read
      // live, that alpha announces itself as a beta. This check used to do exactly that and
      // reported a build that emits no beta at all as shedding one.
      const collect = (s) => {
        for (const u of s.matter) {
          if (u.id === id) continue;
          const kind = decayKind(u);
          if (kind === "alpha") sawAlpha = true;
          if (kind === "beta") sawBeta = true;
        }
      };
      // poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          collect(s);
          return unitById(s, id) == null && sawAlpha && sawBeta;
        },
        { max: MAX_CRACK_TICKS, poll: 3 },
      );
      // Run on so the stream of particles separates on screen, still watching as it goes.
      await api.until(
        (s) => {
          collect(s);
          return false;
        },
        { max: TAIL_TICKS, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectOk(
        "the heavy sheds an alpha (6-electron) atom as it decays",
        sawAlpha,
      );
      check.expectOk(
        "the heavy sheds a beta (2-electron) atom as it decays",
        sawBeta,
      );
      check.expectOk(
        "the worn heavy transmutes down and is finally neutralized",
        unitById(r.snap, id) == null,
      );
    },
  };
}
