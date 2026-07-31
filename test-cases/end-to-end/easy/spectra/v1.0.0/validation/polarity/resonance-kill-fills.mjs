// Automated validation for the Polarity sub-item `resonance-kill-fills`.
//
// A matching kill feeds the resonance meter (about 4 of 100). A Prism's CORE kill
// counts; breaking its SHELL does not. Each kill is a real collision (posed drone,
// matching shot, stepped forward); the resonance gain is read back. Zeroing the
// meter between kills isolates each contribution.

import {
  startClean,
  spawnDrone,
  spawnBystander,
  shootUntil,
  readsAs,
  findDrone,
  LEAD_IN_TICKS,
  RES_KILL,
} from "../_helpers.mjs";

// Each shot is fired from the ship's lane and has to travel ~280 px to its target
// (0.37 s at the specified bullet speed); this leaves room for a slower build.
const RESOLVE_MAX_TICKS = 150;

// A beat between the three kills, so the clip reads as three separate events with
// the meter stepping between them rather than one flurry.
const BETWEEN_TICKS = 48;

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
      await spawnBystander(api);
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

    // Every shot below is fired from the ship's lane rather than posed on its
    // target, so each kill is a bullet the reviewer watches rise and connect, with a
    // beat between them for the meter's step to register. Posed on the drone, all
    // three resolved within a handful of ticks of each other and the clip showed
    // nothing but the aftermath (see `LEAD_IN_TICKS`).
    //
    // `shootUntil` rather than a single shot: three kills with beats between them
    // runs past the two seconds a posed formation drone can be relied on to sit
    // still (`FORMATION_WINDOW_TICKS`), so a later shot may be fired at a drone the
    // assault has already peeled into a dive. Retrying re-aims; the rule under test
    // is the resonance a kill pays, not marksmanship.
    async act(api) {
      // A beat on the posed field, so the clip opens on the scene.
      await api.advance(LEAD_IN_TICKS);

      // A Shard kill feeds resonance.
      const a = await shootUntil(
        api,
        shardId,
        (s) => readsAs(s, shardId),
        (s) => findDrone(s, shardId) === null,
        { max: RESOLVE_MAX_TICKS },
      );
      afterShardKill = a.snap.resonance;
      await api.advance(BETWEEN_TICKS);

      // A Prism's shell break feeds NO resonance; its core kill does. Re-zero the
      // meter so the shell break is measured from nothing.
      await api.call("setResonance", 0);
      // Each shot is aimed by what its target currently reads as rather than a
      // hardcoded band: a Prism that dives to the bottom triggers a spectral
      // inversion, which swaps the band every drone answers to (see `readsAs`).
      await shootUntil(
        api,
        prismId,
        (s) => readsAs(s, prismId), // matches the exposed layer -> breaks it
        (s) => {
          const d = findDrone(s, prismId);
          return d !== null && d.shellAlive === false;
        },
        { max: RESOLVE_MAX_TICKS },
      );
      afterShellBreak = (await api.snapshot()).resonance;
      await api.advance(BETWEEN_TICKS);

      const c = await shootUntil(
        api,
        prismId,
        (s) => readsAs(s, prismId), // matches the exposed core -> kills it
        (s) => findDrone(s, prismId) === null,
        { max: RESOLVE_MAX_TICKS },
      );
      afterCoreKill = c.snap.resonance;

      // Hold on the filled meter so the clip ends on the gain rather than the kill.
      // A bystander keeps the wave alive, so this is filmed over the field.
      await api.advance(96);
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
