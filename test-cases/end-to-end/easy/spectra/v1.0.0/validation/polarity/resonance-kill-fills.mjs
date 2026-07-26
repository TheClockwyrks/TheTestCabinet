// Automated validation for the Polarity sub-item `resonance-kill-fills`.
//
// A matching kill feeds the resonance meter (about 4 of 100). A Prism's CORE kill
// counts; breaking its SHELL does not. Each kill is a real collision (posed drone,
// matching shot, stepped forward); the resonance gain is read back. Zeroing the
// meter between kills isolates each contribution.

import {
  startClean,
  spawnDrone,
  shootDrone,
  findDrone,
  RES_KILL,
} from "../_helpers.mjs";

const RESOLVE_MAX_TICKS = 60; // 60 ticks = the old 0.5 s cap on a hit resolving

export default function item() {
  // The two drones and the meter readings after each event.
  let shardId;
  let prismId;
  let afterShardKill;
  let afterShellBreak;
  let afterCoreKill;

  return {
    id: "polarity.resonance-kill-fills",

    // BOTH targets are posed up front — a Shard and a Prism — where the old script
    // ran two separate scenarios separated by a `reset`. The reset existed only to
    // start a fresh wave, because killing the lone Shard emptied the field and ended
    // the wave; `reset` is forbidden in `act` (it would take the clock back and
    // freeze the recording), so instead the Prism is already on the field and keeps
    // the wave alive through the Shard's death. The meter is zeroed between kills
    // with `setResonance`, exactly as before, so each contribution is isolated.
    async arrange(api) {
      await startClean(api);
      await api.call("setResonance", 0);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan",
        x: 400,
        y: 300,
        phase: "formation",
      });
    },

    async act(api) {
      // A Shard kill feeds resonance.
      await shootDrone(api, shardId, "cyan");
      const a = await api.until((s) => findDrone(s, shardId) === null, {
        max: RESOLVE_MAX_TICKS,
      });
      afterShardKill = a.snap.resonance;

      // A Prism's shell break feeds NO resonance; its core kill does. Re-zero the
      // meter so the shell break is measured from nothing.
      await api.call("setResonance", 0);
      await shootDrone(api, prismId, "cyan"); // matches the shell -> breaks it
      await api.until(
        (s) => {
          const d = findDrone(s, prismId);
          return d !== null && d.shellAlive === false;
        },
        { max: RESOLVE_MAX_TICKS },
      );
      afterShellBreak = (await api.snapshot()).resonance;

      await shootDrone(api, prismId, "magenta"); // matches the exposed core -> kills it
      const c = await api.until((s) => findDrone(s, prismId) === null, {
        max: RESOLVE_MAX_TICKS,
      });
      afterCoreKill = c.snap.resonance;

      // Hold on the final meter so the clip ends on the gain rather than the kill.
      await api.advance(120); // 120 ticks (1 s) with the meter's step up on screen
    },

    async assert(api, check) {
      check.expectClose(
        "a Shard kill adds about 4 resonance",
        afterShardKill,
        RES_KILL,
        0.01,
      );
      check.expectClose(
        "breaking the Prism shell adds no resonance",
        afterShellBreak,
        0,
        0.01,
      );
      check.expectClose(
        "the Prism core kill adds about 4 resonance",
        afterCoreKill,
        RES_KILL,
        0.01,
      );
    },
  };
}
