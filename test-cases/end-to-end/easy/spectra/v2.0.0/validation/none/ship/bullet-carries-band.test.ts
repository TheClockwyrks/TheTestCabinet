// Spectra — ship/bullet-carries-band: a shot carries the band the ship was on.
//
// THE RULE. `specs/ship.md`: a shot "carries the ship's band at the instant it is
// fired, fixed for the bullet's whole life". The review item fixes the reading: a
// shot fired on cyan is a cyan bullet, and a shot fired on magenta is a magenta
// bullet.
//
// WHY BOTH BANDS ARE FIRED, IN ONE CHECK. The requirement is a correspondence,
// and half of it grades nothing: a build that stamps every shot `"cyan"` — the
// band `specs/instrumentation.md` says a run opens on — passes the cyan leg on
// its own, and a build that stamps every shot with the opposite of the ship's
// band passes neither leg but would pass a check that only ever looked at one. So
// the ship fires once on each band and each shot is read against the band it was
// fired on, which makes every wrong model read as a different pair.
//
// THE BAND IS POSED, NOT FLIPPED. `setShipBand` is the surface's operation for
// exactly this and, as `specs/instrumentation.md` says, "it starts no fire
// lockout". Driving the flip key instead would put `bands/flip-instant` and
// `bands/flip-starts-lockout` inside this reading — and the lockout a real flip
// starts would then block the second shot for `FLIP_LOCKOUT` seconds, which is
// `ship/lockout-blocks-fire`'s point, not this one.
//
// WHY THE COOLDOWN IS POSED BACK TO ZERO BETWEEN THE TWO SHOTS. The first shot
// sets it to `FIRE_INTERVAL`, which would swallow the second press. The spacing
// is `ship/fire-cadence`'s point; `setFireCooldown(0)` takes it out of this
// reading rather than waiting it out, so nothing here depends on the build's
// cadence being right.
//
// THE FIRST SHOT IS LEFT IN THE AIR. Nothing needs it gone — the cap allows three
// — and leaving it there is what makes the captured still show a cyan shot and a
// magenta shot in flight together, which is the evidence the review item asks
// for. The second bullet is picked out by id rather than by roster position, so
// which order a build appends in cannot change what is read.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so the only bullets on the field are these two and nothing can
// consume either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  lastBullet,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** The key each shot is delivered on: the first `specs/controls.md` binds to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** The band the run opens on, which `startPosed` restores, and the other one. */
const FIRST_BAND = "cyan" as const;
const SECOND_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stamps each shot with the band the ship held when it fired", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the shots are fired in is live",
  );
  assertEqual(
    before.ship.band,
    FIRST_BAND,
    "the ship's band for the first shot",
  );

  await h.tap(FIRE_KEY);
  const first = lastBullet(await h.snapshot());
  if (first === undefined) {
    fail(
      "the fire action to put a bullet on the field to read (specs/ship.md)",
      "the bullet roster was still empty after the first press",
    );
  }
  assertEqual(
    first.band,
    FIRST_BAND,
    `the band of a shot fired while the ship held ${FIRST_BAND} (specs/ship.md)`,
  );

  await h.debug.setShipBand(SECOND_BAND);
  await h.debug.setFireCooldown(0);
  const posed = await h.snapshot();
  assertEqual(
    posed.ship.band,
    SECOND_BAND,
    "the ship's band for the second shot",
  );

  const already = new Set(playerBullets(posed).map((bullet) => bullet.id));
  await h.tap(FIRE_KEY);
  await captureStill(h, "bands");
  const after = playerBullets(await h.snapshot());
  // By id rather than by roster position, and against everything the FIRST press
  // left behind rather than against one bullet of it: which order a build appends
  // in cannot change what is read, and a build with a spread cannon loses
  // `ship/fire-spawns-bullet` rather than this point.
  const second = after.find((bullet) => !already.has(bullet.id));
  if (second === undefined) {
    fail(
      "the second press to put a new bullet on the field to read (specs/ship.md)",
      `the roster still held only ${JSON.stringify([...already])}`,
    );
  }
  assertEqual(
    second.band,
    SECOND_BAND,
    `the band of a shot fired while the ship held ${SECOND_BAND} (specs/ship.md)`,
  );
});
