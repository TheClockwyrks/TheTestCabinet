// Automated validation for the Swarm sub-item `only-divers-fire`.
//
// Drones in formation never fire; only diving drones do. An assembled formation is
// posed and held with no dive (before the automatic assault's first dive at ~2.0s)
// — the real fire systems produce zero enemy bullets — then a REAL dive is launched
// and enemy bullets appear.

import { startStageClean, spawnDrone, enemyBullets } from "../_helpers.mjs";

// Short of the first automatic dive (~2.0 s after assembly), so the silence read
// below is the formation's own and not merely the gap before the game dives anyway.
const HOLD_TICKS = 216; // 216 ticks = the old 1.8 s

// The old sweep was 100 reads 0.02 s apart — a 2 s window. 0.02 s is 2.4 ticks, which
// the tick contract refuses rather than rounds, so the poll rounds DOWN to 2: it is a
// SAMPLING poll watching for the first enemy bullet to exist, and reading more often
// can only catch that bullet earlier, never miss it. The budget is set to 240 ticks so
// the window stays the original 2 s (120 reads at 2 ticks).
// The old window was 2 s, which was barely enough: a diver may not fire until well
// into its run (nothing in `specs/drones.md` fixes how far down it shoots from), so
// on a build that fires late the sweep ended just as the bullet appeared — and the
// clip ended with it, which is why the shot could not be seen. Raised to 5 s so a
// late-firing diver is still caught.
const POLL_TICKS = 2;
const WINDOW_TICKS = 600;

// Held after the first enemy bullet appears, so the clip shows it actually leaving
// the diver and travelling rather than cutting on the frame it spawns.
const SHOT_HOLD_TICKS = 180; // 1.5 s

export default function item() {
  // The drones, the formation's bullet count, and whether the diver fired.
  const ids = [];
  let formationBullets;
  let fired = false;

  return {
    id: "swarm.only-divers-fire",

    // Three formation drones spread across the field with the ship centred beneath
    // them, so any of them firing would produce a bullet the sweep would see.
    async arrange(api) {
      await startStageClean(api, 1);
      await api.call("setShipX", 640);
      for (const [x, band] of [
        [500, "cyan"],
        [640, "magenta"],
        [780, "cyan"],
      ]) {
        ids.push(
          await spawnDrone(api, {
            kind: "shard",
            band,
            x,
            y: 200,
            phase: "formation",
          }),
        );
      }
    },

    async act(api) {
      // Hold the formation short of the first automatic dive (~2.0s after assembly):
      // formation drones must not fire.
      await api.advance(HOLD_TICKS);
      formationBullets = enemyBullets(await api.snapshot()).length;

      // Now send one drone into a real dive: enemy bullets appear. The contrast
      // between the silent formation and the firing diver is the whole item, and
      // reads directly off the clip.
      await api.call("forceDive", ids[0]);
      for (let spent = 0; spent < WINDOW_TICKS && !fired; spent += POLL_TICKS) {
        await api.advance(POLL_TICKS);
        if (enemyBullets(await api.snapshot()).length > 0) fired = true;
      }

      // Stay on the shot. The sweep stops the instant the first bullet exists, which
      // is the earliest possible frame to end a clip on — the reviewer needs to see
      // it leave the diver.
      await api.advance(SHOT_HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "an all-formation swarm fires no enemy bullets",
        formationBullets,
        0,
      );
      check.expectOk("a diving drone does fire", fired);
    },
  };
}
