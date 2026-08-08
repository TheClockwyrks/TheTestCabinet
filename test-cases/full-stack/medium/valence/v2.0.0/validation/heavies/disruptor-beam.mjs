// Automated validation for the Heavies sub-item `disruptor-beam`.
//
// A plain Beam (energy) cannot touch a heavy, but its tier-III Disruptor branch gains
// heavy damage — so more than one tower can crack heavies, an identity earned by a
// branch. The check pits a plain Beam and a Disruptor Beam against identical heavies and
// confirms only the Disruptor wears the heavy down.
//
// TWO runs: the plain Beam is arranged, the Disruptor is posed inside `act` with
// `poseScenario` (control ops only — `api.reset` throws there). The old script then re-posed
// the Disruptor a THIRD time purely to film it; that is unnecessary now, because `act`
// already ends on exactly that scenario.

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

const MAX_CRACK_TICKS = 180; // 3 s — the plain Beam spends all of it proving it cannot
// How long the Disruptor is left working after its first hit lands. A tier-III Beam reloads
// at about a shot a second, so four seconds is a handful of shots — enough to watch the
// heavy's arc actually drain, rather than the single frame the clip used to cut on. The
// plain-Beam half needs no tail: its whole three seconds ARE the evidence, since what it
// shows is a tower firing nothing into a heavy it cannot touch.
const DISRUPTOR_ON_TICKS = 240;

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
async function actBeamVsHeavy(api, { id, hp0 }, { runOn = 0 } = {}) {
  // The board as posed, before the Beam's first shot: the heavy intact, the tower idle.
  await api.advance(LEAD_TICKS);
  // poll 3 = the old 0.05 s chunk.
  const r = await api.until(
    (s) => {
      const u = unitById(s, id);
      return u == null || u.hp < hp0;
    },
    { max: MAX_CRACK_TICKS, poll: 3 },
  );
  if (runOn > 0) await api.advance(runOn);
  return r.hit;
}

export default function item() {
  let posedPlain;
  let plainCracked;
  let disruptorCracked;

  return {
    id: "heavies.disruptor-beam",

    clipMs: clipBudget(
      2 * (LEAD_TICKS + MAX_CRACK_TICKS) + DISRUPTOR_ON_TICKS + TAIL_TICKS,
    ),

    async arrange(api) {
      posedPlain = await poseBeamVsHeavy(api, startScenario, false);
    },

    // The plain Beam failing to touch the heavy, then the Disruptor cracking an identical
    // one — the contrast the item is about.
    async act(api) {
      plainCracked = await actBeamVsHeavy(api, posedPlain);

      const posedDisruptor = await poseBeamVsHeavy(api, poseScenario, true);
      disruptorCracked = await actBeamVsHeavy(api, posedDisruptor, {
        runOn: DISRUPTOR_ON_TICKS,
      });
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
