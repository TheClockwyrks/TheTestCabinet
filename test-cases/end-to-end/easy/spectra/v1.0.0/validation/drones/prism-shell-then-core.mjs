// Automated validation for the Drones sub-item `prism-shell-then-core`.
//
// A Prism is broken in two bands in order: the shell falls only to the shell's
// band (exposing the core), then the core falls only to the opposite band. One
// Prism takes four real hits — a mismatch that leaves the shell; the shell's band,
// which breaks it; that same band again, which must now do nothing to the exposed
// core; and the core's band, which destroys it.
//
// Two things about how the shots are aimed.
//
// Each shot's band is read from what the drone CURRENTLY reads as (`readsAs`)
// rather than hardcoded. The rule is "the bullet's band equals the drone's current
// band" (`specs/polarity.md`), and which literal band that is need not stay put: a
// Prism left in formation dives once the assault claims it, and a diving Prism that
// reaches the bottom triggers a spectral inversion, which swaps every band on the
// field for five seconds. Hardcoding "magenta kills this core" then fails a build
// that is obeying the inversion rule exactly as written.
//
// And the two BREAKING shots fly up from the ship's lane, with a beat between them,
// so a reviewer can watch each one connect — while the two MISMATCHED shots are
// posed on the drone, because their evidence is that nothing happened and a lane
// shot that simply missed would look identical. Posed on the drone, all four used to
// resolve within a few ticks of each other, so the clip showed only the final pop
// (see `LEAD_IN_TICKS`).

import {
  startClean,
  spawnDrone,
  spawnBystander,
  findDrone,
  readsAs,
  opposite,
  shootDrone,
  shootUntil,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for a shot to cross the ~280 px up to the Prism (0.37 s at the specified
// bullet speed), with slack for a build whose bullets are slower.
const RESOLVE_MAX_TICKS = 150;

// Long enough for a shot posed on the drone to resolve.
const CONTACT_TICKS = 24;

// A beat between hits, so each break is a distinct moment on screen.
const BETWEEN_TICKS = 48;

export default function item() {
  // The Prism, and what `act` observed after each of the four hits.
  let prismId;
  let afterMismatch;
  let afterShell;
  let afterCoreMismatch;
  let killed;

  return {
    id: "drones.prism-shell-then-core",

    // One Prism with a cyan shell — so its core is the opposite band (magenta) — in
    // the ship's column, plus a bystander off to the side so the wave is not emptied
    // by the kill (see `spawnBystander`). Every drone is found by id, so a hit can
    // only ever be read against the Prism it was aimed at.
    async arrange(api) {
      await startClean(api);
      await spawnBystander(api);
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan", // core is the opposite (magenta)
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    // The four hits in order are both the check and the clip: a reviewer watching
    // this sees a shot bounce off the shell, the right band crack it open, the same
    // band bounce off the exposed core, and the opposite band finish it.
    async act(api) {
      // A beat on the intact Prism, so the clip opens on the scene.
      await api.advance(LEAD_IN_TICKS);

      // A mismatch on the shell does not break it.
      await shootDrone(
        api,
        prismId,
        opposite(readsAs(await api.snapshot(), prismId)),
      );
      await api.advance(CONTACT_TICKS);
      afterMismatch = findDrone(await api.snapshot(), prismId);
      await api.advance(BETWEEN_TICKS);

      // The shell's band breaks the shell and exposes the core.
      await shootUntil(
        api,
        prismId,
        (s) => readsAs(s, prismId),
        (s) => {
          const x = findDrone(s, prismId);
          return x !== null && x.shellAlive === false;
        },
        { max: RESOLVE_MAX_TICKS },
      );
      afterShell = findDrone(await api.snapshot(), prismId);
      await api.advance(BETWEEN_TICKS);

      // The exposed core falls ONLY to the opposite band, so the band that just
      // worked — the shell's — must now do nothing. This is the half of "in order"
      // the sequence does not otherwise establish: without it, a build that let any
      // shot through once the shell was gone would still pass.
      await shootDrone(
        api,
        prismId,
        opposite(readsAs(await api.snapshot(), prismId)),
      );
      await api.advance(CONTACT_TICKS);
      afterCoreMismatch = findDrone(await api.snapshot(), prismId);
      await api.advance(BETWEEN_TICKS);

      // The core's band destroys the drone.
      killed = await shootUntil(
        api,
        prismId,
        (s) => readsAs(s, prismId),
        (s) => findDrone(s, prismId) === null,
        { max: RESOLVE_MAX_TICKS },
      );

      // Hold on the pop so the clip ends on the kill rather than cutting on it.
      await api.advance(72);
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
      // The two layers are read from `shellBand` and `coreBand`, the fields
      // `specs/instrumentation.md` defines for exactly this, and checked against the
      // rule `specs/drones.md` states — the two layers are always opposite. The old
      // assertion instead read the drone's top-level `band` and required it to
      // BECOME the core's once the shell fell. Nothing in the snapshot contract says
      // it must: `band` is documented as the drone's STORED band, and a Prism reports
      // its layers separately precisely so a caller can tell which one is exposed.
      // That assertion failed builds whose Prism sequence is entirely correct — what
      // proves the ordering is the four hits, not the label on a field.
      check.expectOk(
        "the Prism's two layers are opposite bands",
        afterShell !== null &&
          afterShell.coreBand === opposite(afterShell.shellBand),
      );
      check.expectOk(
        "the shell's band does not break the exposed core",
        afterCoreMismatch !== null,
      );
      check.expectOk("the core's band destroys the Prism", killed.hit);
    },
  };
}
