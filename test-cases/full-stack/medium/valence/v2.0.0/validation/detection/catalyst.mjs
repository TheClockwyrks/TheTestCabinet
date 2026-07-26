// Automated validation for the Detection sub-item `catalyst`.
//
// A Catalyst's aura reveals inert matter in its field, after which a nearby damage tower
// can fire on it. The check places a Catalyst and an Emitter over the same point, poses
// an inert Noble there, and runs the real sim: the noble is revealed and the emitter then
// damages it.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let revealed;
  let r;

  return {
    id: "detection.catalyst",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "catalyst", g, s0);
      await placeCovering(api, "emitter", g, s0);
      // Give the Noble a full six-electron shell. A default 1-electron Noble is
      // neutralised by the Emitter's very first shot (~tick 2), before `act` reads its
      // `revealed` flag (~tick 6) — the read raced the kill and dereferenced a dead unit.
      // Six shells outlast the reveal read while still letting the "a nearby tower can
      // now fire on it" assertion observe hp fall on the first hit.
      id = await spawnAt(api, { type: "noble", electrons: 6, pathId: 0, s: s0 });
    },

    // The reveal and the shot that follows it — the whole of what is checked, and the
    // whole of the clip.
    async act(api) {
      // 6 ticks = the old 0.1 s: long enough for the aura to have applied.
      await api.advance(6);
      revealed = unitById(await api.snapshot(), id).revealed;

      const hp0 = unitById(await api.snapshot(), id).hp;
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, id);
          return u == null || u.hp < hp0;
        },
        { max: 180, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectEq("the Catalyst reveals the inert unit", revealed, true);
      check.expectOk(
        "a nearby tower can now fire on the revealed inert unit",
        r.hit,
      );
    },
  };
}
