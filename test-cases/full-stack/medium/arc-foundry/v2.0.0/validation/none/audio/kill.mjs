// Automated validation for the Audio item `kill`: a kill/ground-out pop plays when a shot
// kills a unit. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A strong Capacitor is armed on the entry corridor and the level's own Wave 1
// is walked up to it; audio is armed, and the real simulation is stepped until the nearest
// arriving unit is gone — the audio log must grow across the kill.

import {
  armTower,
  armAudio,
  audioCount,
  audioCueLabel,
  waitForAudio,
  skipToFirstTarget,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several cadences of the type under test. The old 1 s budget assumed a component fires on
// its opening tick (a zero starting cooldown); nothing in `specs/towers.md` says whether it
// does, and a Discharge Rig's own cadence is 2 s all by itself.
const KILL_MAX_TICKS = 4 * SECOND;

export default function item() {
  let before;
  let after;
  let killed;
  let unitId;

  return {
    id: "audio.kill",

    async arrange(api) {
      // A strong gun, so the first wave unit that walks into reach dies to it quickly.
      const towerId = await armTower(api, { type: "capacitor", tier: 3, clear: false });
      // Walk the harvest's own Wave 1 up to the tower, then follow whichever unit arrived: the
      // cue this item is about is the kill, not which unit it was. Pinning it to a separately
      // released unit made a sound check depend on the debug spawner as well as on the audio.
      await skipToFirstTarget(api, towerId);
      const t = (await api.snapshot()).towers.find((x) => x.id === towerId);
      const target = (await api.snapshot()).units
        .map((u) => ({ u, d: Math.hypot(u.x - t.cx, u.y - t.cy) }))
        .sort((a, b) => a.d - b.d)[0];
      unitId = target ? target.u.id : null;
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => unitId != null && !s.units.some((u) => u.id === unitId), {
        max: KILL_MAX_TICKS,
        poll: TICK,
      });
      killed = r.hit;
      after = await waitForAudio(api, before);
    },

    async assert(api, check) {
      check.expectOk("a unit walked into the gun's reach", unitId != null);
      check.expectOk("the unit is killed", killed);
      check.expectGt(
        audioCueLabel("a kill cue plays on the kill", after),
        after,
        before,
      );
    },
  };
}
