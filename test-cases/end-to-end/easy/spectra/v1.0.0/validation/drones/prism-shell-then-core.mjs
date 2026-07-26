// Automated validation for the Drones sub-item `prism-shell-then-core`.
//
// A Prism is broken in two bands in order: the shell falls only to the shell's
// band (exposing the core), then the core falls only to the opposite band. A Prism
// is posed and hit in sequence — a mismatch leaves the shell; the shell's band
// breaks it and the stored band becomes the core's; the core's band destroys the
// drone. Every hit is a real collision.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

const RESOLVE_TICKS = 24; // 24 ticks = the old 0.2 s for a shot to reach and resolve
const BREAK_MAX_TICKS = 60; // 60 ticks = the old 0.5 s cap on a break resolving

export default function item() {
  // The Prism, and what `act` observed after each of the three hits.
  let prismId;
  let afterMismatch;
  let afterShell;
  let killed;

  return {
    id: "drones.prism-shell-then-core",

    // One Prism with a cyan shell — so its core is the opposite band (magenta) —
    // on an otherwise empty field, so every hit below can only have hit this drone.
    async arrange(api) {
      await startClean(api);
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan", // core is the opposite (magenta)
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    // The three hits in order are both the check and the clip: a reviewer watching
    // this sees a shot bounce off the shell, the right band crack it open, and the
    // opposite band finish the core.
    async act(api) {
      // A mismatch on the shell (magenta vs a cyan shell) does not break it.
      await shootDrone(api, prismId, "magenta");
      await api.advance(RESOLVE_TICKS);
      afterMismatch = findDrone(await api.snapshot(), prismId);

      // The shell's band breaks the shell and exposes the core.
      await shootDrone(api, prismId, "cyan");
      await api.until(
        (s) => {
          const x = findDrone(s, prismId);
          return x !== null && x.shellAlive === false;
        },
        { max: BREAK_MAX_TICKS },
      );
      afterShell = findDrone(await api.snapshot(), prismId);

      // The core's band (opposite) destroys the drone.
      await shootDrone(api, prismId, "magenta");
      killed = await api.until((s) => findDrone(s, prismId) === null, {
        max: BREAK_MAX_TICKS,
      });

      // Hold on the pop so the clip does not cut the instant the core dies.
      await api.advance(60); // 60 ticks (0.5 s) of the burst playing out
    },

    async assert(api, check) {
      check.expectOk(
        "a mismatched shot leaves the shell intact",
        afterMismatch !== null && afterMismatch.shellAlive === true,
      );
      check.expectOk(
        "the shell's band breaks the shell",
        afterShell !== null && afterShell.shellAlive === false,
      );
      check.expectEq(
        "the exposed core's band becomes current",
        afterShell.band,
        "magenta",
      );
      check.expectOk("the core's band destroys the Prism", killed.hit);
    },
  };
}
