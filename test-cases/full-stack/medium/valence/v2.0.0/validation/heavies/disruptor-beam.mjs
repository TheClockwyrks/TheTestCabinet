// Automated validation for the Heavies sub-item `disruptor-beam`.
//
// A plain Beam (energy) cannot touch a heavy, but its tier-III Disruptor branch gains
// heavy damage — so more than one tower can crack heavies, an identity earned by a
// branch. The check pits a plain Beam and a Disruptor Beam against identical heavies and
// confirms only the Disruptor wears the heavy down.
//
// TWO runs: the plain Beam is arranged, the Disruptor is posed inside `act` with
// `poseRun` (control ops only — `api.reset` throws there). The old script then re-posed
// the Disruptor a THIRD time purely to film it; that is unnecessary now, because `act`
// already ends on exactly that scenario.

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

/** Pose a Beam (optionally upgraded to Disruptor) over a heavy; `begin` opens the run. */
async function poseBeamVsHeavy(api, begin, disruptor) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.15;
  const t = await placeCovering(api, "beam", g, s0);
  if (disruptor) {
    await api.call("upgradeTower", t.id); // -> tier II
    await api.call("upgradeTower", t.id, "B"); // -> tier III Disruptor
  }
  const id = await spawnAt(api, { type: "isotope", pathId: 0, s: s0 });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Run the posed scenario and report whether the heavy was ever worn down. */
async function actBeamVsHeavy(api, { id, hp0 }) {
  // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
  const r = await api.until(
    (s) => {
      const u = unitById(s, id);
      return u == null || u.hp < hp0;
    },
    { max: 180, poll: 3 },
  );
  return r.hit;
}

export default function item() {
  let posedPlain;
  let plainCracked;
  let disruptorCracked;

  return {
    id: "heavies.disruptor-beam",

    async arrange(api) {
      posedPlain = await poseBeamVsHeavy(api, startRun, false);
    },

    // The plain Beam failing to touch the heavy, then the Disruptor cracking an identical
    // one — the contrast the item is about.
    async act(api) {
      plainCracked = await actBeamVsHeavy(api, posedPlain);

      const posedDisruptor = await poseBeamVsHeavy(api, poseRun, true);
      disruptorCracked = await actBeamVsHeavy(api, posedDisruptor);
    },

    async assert(api, check) {
      check.expectOk(
        "a plain Beam cannot crack a heavy",
        plainCracked === false,
      );
      check.expectOk(
        "a Disruptor Beam cracks a heavy",
        disruptorCracked === true,
      );
    },
  };
}
