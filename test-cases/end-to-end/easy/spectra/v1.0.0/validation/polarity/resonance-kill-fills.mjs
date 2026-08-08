// Automated validation for the Polarity sub-item `resonance-kill-fills`.
//
// A matching kill feeds the resonance meter (about 4 of 100). A Prism's CORE kill
// counts; breaking its SHELL does not. Each kill is a real collision (posed drone,
// matching shot, stepped forward); the resonance gain is read back. Zeroing the
// meter between kills isolates each contribution.

import {
  startClean,
  holdDrones,
  spawnDrone,
  spawnBystander,
  shootFromLane,
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
    //
    // The swarm is HELD for the whole scenario (`holdDrones`), which is what makes
    // each reading attributable. Left live, the posed Prism is peeled into a dive
    // about two seconds in — and a diving Prism fires a two-band burst, one bullet
    // of which matches the ship's band and is absorbed by the shield for `+6`. That
    // `+6` lands inside the window this item is measuring a `+4` kill in, and the
    // meter reads 10 for a build whose kill payout is exactly right. Held, the only
    // thing that can move the meter is the kill under test.
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
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
    // ONE lane shot per event, not `shootUntil`'s retry ladder: with the swarm held
    // the targets stand in their own columns, so a shot up the column connects and
    // a retry would only mean the rule failed to apply.
    //
    // The meter is zeroed immediately before EACH of the three readings, so every
    // one of them is a gain measured from nothing rather than a running total. The
    // old script zeroed before the shell break but not before the core kill, so the
    // core reading carried whatever the shell break (and anything else) had left
    // behind.
    async act(api) {
      // A beat on the posed field, so the clip opens on the scene.
      await api.advance(LEAD_IN_TICKS);

      // A Shard kill feeds resonance. Aimed by what the target currently reads as
      // rather than a hardcoded band (see `readsAs`).
      await api.call("setResonance", 0);
      await shootFromLane(api, shardId, readsAs(await api.snapshot(), shardId));
      const a = await api.until((s) => findDrone(s, shardId) === null, {
        max: RESOLVE_MAX_TICKS,
      });
      afterShardKill = a.snap.resonance;
      await api.advance(BETWEEN_TICKS);

      // A Prism's shell break feeds NO resonance; its core kill does.
      await api.call("setResonance", 0);
      await shootFromLane(api, prismId, readsAs(await api.snapshot(), prismId));
      await api.until(
        (s) => {
          const d = findDrone(s, prismId);
          return d !== null && d.shellAlive === false;
        },
        { max: RESOLVE_MAX_TICKS },
      );
      afterShellBreak = (await api.snapshot()).resonance;
      await api.advance(BETWEEN_TICKS);

      // The exposed core now reads as the opposite band; aim by what it reads as.
      await api.call("setResonance", 0);
      await shootFromLane(api, prismId, readsAs(await api.snapshot(), prismId));
      const c = await api.until((s) => findDrone(s, prismId) === null, {
        max: RESOLVE_MAX_TICKS,
      });
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
