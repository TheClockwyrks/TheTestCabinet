// Automated validation for movement.sky-open.
//
// The sky above the surface is open and unbounded (specs/character.md): standing on the surface,
// the miner can thrust straight up and keep climbing with no invisible lid — it is "never held at
// a fixed height by an invisible lid". We spawn on the surface, grant a full tank and a strong
// jetpack, hold thrust, and confirm the miner climbs far above where it started AND is still
// ascending at the end (not pinned against a ceiling).
//
// Deliberately NOTHING is carved and the miner is NEVER teleported up: it lifts off from its
// natural spawn through the unmodified space above, so a real ceiling — a clamp on height, or
// solid tiles read above the surface — genuinely stops it and this check fails. Measuring that it
// is still rising (rather than only "rose by X") is what keeps a build that lifts the miner from a
// sunk pit up to a surface lid from passing: a lid stalls the climb, and the stall is caught here.

import { newRun, K, TILE } from "../_helpers.mjs";

export default function item() {
  let spawn;
  let mid;
  let end;

  return {
    id: "movement.sky-open",

    // On the surface, empty, with a full tank and the strongest jetpack, so the climb is limited by
    // nothing but a ceiling over the measurement window.
    async arrange(api) {
      spawn = await newRun(api); // spawns grounded on the surface
      await api.call("grantGear", { fuel: 5, jetpack: 5 });
      await api.call("setFuel", 999999); // clamped to the (now tier-5) max — a full tank
    },

    // Holding thrust off the surface is the behavior, and the clip shows the miner rising into the
    // open sky above the camp.
    async act(api) {
      await api.call("keyDown", K.thrust);
      await api.advance(60); // 60 ticks = 1 s of climb
      mid = await api.snapshot();
      await api.advance(60); // 60 more = 2 s total
      end = await api.snapshot();
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      const groundY = spawn.miner.y; // where the miner rested on the surface (smaller y = higher)
      // The jetpack actually lifted it well clear of the surface — many tiles up.
      check.expectLt(
        "the miner climbed high above the surface",
        end.miner.y,
        groundY - 6 * TILE,
      );
      // Still ascending at the end, with thrust held and fuel to spare: nothing is pinning it. A
      // hard ceiling (a height clamp or solid sky) shows up here as a stall — vy at rest, not rising.
      check.expectLt(
        "still rising at the end — no ceiling stall",
        end.miner.vy,
        -50,
      );
      check.expectGt(
        "fuel remained — the climb was not fuel-limited",
        end.miner.fuel,
        0,
      );
      // And it kept gaining height across the whole climb, never pinned at a fixed altitude.
      check.expectLt(
        "kept rising through the climb — never pinned",
        end.miner.y,
        mid.miner.y - TILE,
      );
    },
  };
}
