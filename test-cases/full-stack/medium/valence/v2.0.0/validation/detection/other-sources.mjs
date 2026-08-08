// Automated validation for the Detection sub-item `other-sources`.
//
// Detection is not one tower. The check confirms two further sources beyond the Catalyst
// each let inert matter be seen and hit: an Ionizer upgraded to its ARRAY branch (which
// grants detection), and a Beam (which sees inert natively at tier I). Each is posed
// against an undetected Noble and must damage it — proving it can see and hit inert
// matter on its own.
//
// TWO runs: the Array scenario is arranged, the Beam scenario is posed inside `act` with
// `poseScenario` (no `reset`, which would freeze the recording).

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

const MAX_HIT_TICKS = 180; // 3 s — the sweep's own cap, mirrored into the clip budget
// Each detector gets its own framed scene. Two scenes that each cut on the frame the
// noble's hp first moved gave the reviewer two glimpses of a number twitching; there was no
// "it is sealed and nothing is happening to it" to compare against, which is the state the
// whole item is a change from.
const SCENE_TICKS = LEAD_TICKS + MAX_HIT_TICKS + TAIL_TICKS;

/** Pose an Ionizer upgraded to its ARRAY branch over an undetected Noble. */
async function poseArray(api, begin) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  const t = await placeCovering(api, "ionizer", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, "A"); // -> tier III ARRAY (detection)
  // Six electrons, so the noble is still there to be watched at the end of the scene
  // rather than neutralized by the second shot.
  const id = await spawnAt(api, {
    type: "noble",
    electrons: 6,
    pathId: 0,
    s: s0,
  });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Pose a plain tier-I Beam over an undetected Noble. */
async function poseBeam(api, begin) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "beam", g, s0);
  // Six electrons, so the noble is still there to be watched at the end of the scene
  // rather than neutralized by the second shot.
  const id = await spawnAt(api, {
    type: "noble",
    electrons: 6,
    pathId: 0,
    s: s0,
  });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Run until the posed tower damages (or neutralizes) the noble, framed on both sides. */
async function seesInert(api, { id, hp0 }) {
  // The board as posed: a sealed noble and a tower that has not fired yet.
  await api.advance(LEAD_TICKS);
  // poll 3 = the old 0.05 s chunk.
  const r = await api.until(
    (s) => {
      const u = unitById(s, id);
      return u == null || u.hp < hp0;
    },
    { max: MAX_HIT_TICKS, poll: 3 },
  );
  // ...and the detector going on working on a unit nothing else could touch.
  await api.advance(TAIL_TICKS);
  return r.hit;
}

export default function item() {
  let posedArray;
  let arrayHit;
  let beamHit;

  return {
    id: "detection.other-sources",

    clipMs: clipBudget(2 * SCENE_TICKS),

    async arrange(api) {
      posedArray = await poseArray(api, startScenario);
    },

    // Both detectors doing the thing they are here for, back to back.
    async act(api) {
      arrayHit = await seesInert(api, posedArray);

      const posedBeam = await poseBeam(api, poseScenario);
      beamHit = await seesInert(api, posedBeam);
    },

    async assert(api, check) {
      check.expectOk(
        "an Ionizer's Array branch sees and hits inert matter",
        arrayHit,
      );
      check.expectOk("a Beam sees and hits inert matter natively", beamHit);
    },
  };
}
