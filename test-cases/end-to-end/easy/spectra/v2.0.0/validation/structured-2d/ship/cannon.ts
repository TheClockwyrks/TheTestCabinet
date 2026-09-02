// ship — driving the cannon once, and reading a bullet back off the roster.
// LOCAL TO THIS GROUP.
//
// Two small things four of this group's points share, kept here rather than in
// `harness.ts` because both are readings of the CANNON's scenario and mean
// something else elsewhere: in a group about destruction a bullet leaving the
// roster is the requirement, and in `controls` which key fires is the point rather
// than the way in.
//
// Neither holds a tolerance. `fireOneShot` fixes only how a PRESS is delivered —
// the key goes down, the frames run one at a time, the key comes up — and every
// figure a check asserts about the shot that comes back is stated in that check.

import { BINDINGS, FIRE_INTERVAL } from "../constants";
import { fail } from "../assert";
import {
  bulletById,
  playerBullets,
  ticksFor,
  type BulletSnapshot,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/**
 * The key a press is delivered on: the first `specs/controls.md` binds the `a`
 * action to.
 *
 * WHICH keys fire is `controls/fire-space`, `controls/fire-up` and
 * `controls/fire-w`; here the key is only the way in, so the case's own bindings
 * table is read rather than a literal written out.
 */
export const FIRE_KEY = BINDINGS.a[0];

/**
 * How many frames the key is held for one press.
 *
 * A quarter of `FIRE_INTERVAL` (`0.16` s, sixteen frames of the harness's 100 Hz
 * clock), which is the whole of the arithmetic: strictly inside one cadence
 * period, so the gate `specs/ship.md` puts on a second shot cannot open while the
 * key is down and a press can produce exactly one shot; and more than a single
 * frame, so a build that reads its input a frame after the key-down still fires.
 * It is a ceiling on the build's latency, never a rate — no check reads a spacing
 * from it.
 */
export const PRESS_FRAMES = Math.floor(ticksFor(FIRE_INTERVAL) / 4);

/**
 * One press of the fire action, and the shot it put on the field.
 *
 * The frames run ONE AT A TIME and the roster is read after each, so the bullet
 * comes back on the first frame it exists: a check that reads where a shot appears
 * reads it before the simulation has carried it any further than the one frame it
 * was born in, whatever latency the build's own input path costs.
 *
 * The key is held rather than tapped because `specs/controls.md` reads `a` as a
 * HOLD: a key pressed and released inside one frame leaves the action at rest for
 * the whole of that frame's update.
 *
 * `what` names the scenario the shot was asked for, so a build whose fire action
 * added nothing fails naming the press rather than only a lookup that came back
 * empty. That is a verdict, not a skipped check: `startPosed` leaves the cadence,
 * the cap and the lockout — the three gates `specs/ship.md` puts on a shot — all
 * clear, so a press that adds nothing is the build.
 */
export async function fireOneShot(
  h: Harness,
  what: string,
): Promise<BulletSnapshot> {
  const before = new Set(
    playerBullets(h.snapshot()).map((bullet) => bullet.id),
  );
  h.hold(FIRE_KEY);
  try {
    for (let frame = 0; frame < PRESS_FRAMES; frame += 1) {
      await h.advance(1);
      const shot = playerBullets(h.snapshot()).find(
        (bullet) => !before.has(bullet.id),
      );
      if (shot !== undefined) return shot;
    }
  } finally {
    h.release(FIRE_KEY);
  }
  fail(
    `${what}: one press of the fire action to put one of the player's bullets ` +
      `on the field inside ${String(PRESS_FRAMES)} frames, with the cadence, ` +
      "the cap and the lockout all clear (specs/ship.md)",
    "no new friendly bullet reached the roster",
  );
}

/**
 * The bullet `id` names, or the failure that it is no longer on the roster.
 *
 * The harness's `bulletById` answers `undefined` where no bullet carries the id,
 * and says so deliberately: what a missing reading MEANS is the check's to state.
 * For this group it means the build failed the point — every scenario below poses
 * its bullet inside the play field, with `startPosed`'s empty world around it, and
 * nothing in `specs/ship.md`'s account of a shot removes one there.
 *
 * `what` names the scenario the bullet was posed for, so a failure says which
 * reading lost it.
 */
export function bulletOnRoster(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): BulletSnapshot {
  const bullet = bulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      `bullet ${String(id)} to still be on the roster ${what} — nothing in ` +
        "this scenario removes one (specs/ship.md)",
      `the roster holds ${String(snapshot.bullets.length)} bullets and none is it`,
    );
  }
  return bullet;
}
