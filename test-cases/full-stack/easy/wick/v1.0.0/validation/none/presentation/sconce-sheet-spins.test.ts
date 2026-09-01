// presentation/sconce-sheet-spins — Sconce's four-frame sheet wraps for the whole
// of the sconce's life, one frame every six ticks.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "Animation": "A sconce draws
// frame `floor(t / WALK_FRAME_TIME) mod 4`, for `t` the seconds of ticks since it
// was fired, so it spins for its life." `WALK_FRAME_TIME` is `0.1` from the table
// above it, which `specs/world.md`'s timer rule makes six ticks a frame, and its
// row of "The weapon effects" gives the files and the span: "sconce | Sconce |
// `assets/sprites/effects/sconce/0.png` to `3.png` | a sheet of `4`, spinning |
// `24 x 24` | the sconce's circle, for its life". `specs/weapons.md` gives that
// life at level `1` as a `2.5`-second duration, `round(2.5 x TICK_HZ)` (`150`)
// ticks, so the cycle wraps six times over and is read past every one of them.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, one
// hound `300` units out, and Sconce alone, held at level `1` and due at once.
// "Sconce needs at least one enemy to fire", and the hound is the only one;
// `weaponFire` goes back off the moment it has fired, and `effectMotion` stays
// off, which `specs/instrumentation.md` says holds every projectile's position and
// velocity while leaving `ttl` counting, so the sconce holds still and spins in
// place for exactly its own life.
//
// WHAT IS READ. Which of the four produced sconce files the frame drew at the
// sconce's own place, on each of the one hundred and fifty ticks it is live,
// against the frame the floor puts that tick on. Where the effect is drawn and how
// large is the sibling point's; this one is about the spin.
//
// THE ALLOWANCES, AND WHY EACH COSTS THE POINT NOTHING. One tick either side of a
// boundary, as `./sheets` states with its reason: `t` is a tick count in seconds,
// and a build that accumulates it and one that divides it disagree in the last
// bits of a float. And frames are compared UP TO the sheet's own identical
// pictures, since `specs/assets.md` fixes four files and never requires four
// different ones. The cadence, the order, and the wrap are all still decided.

import { afterEach, beforeEach, it } from "vitest";
import { WALK_FRAME_TIME, dueTicks, weaponRow } from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustProjectile,
  placeEnemy,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt, effectFiles } from "./readouts";
import { fileClasses, primeSources } from "./sources";
import { frameAllowed, play, runsInOrder } from "./sheets";

/** The target Sconce needs, far enough out that the held sconce never reaches it. */
const TARGET_AT = { dx: 300, dy: 0 };

const FILES = effectFiles("sconce");

/** "frame `floor(t / WALK_FRAME_TIME) mod 4`", wrapping, over the sconce's life. */
const SHEET = play(FILES, WALK_FRAME_TIME, true);
const TICKS = dueTicks(weaponRow("sconce", 1).duration ?? 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spins the sconce sheet for the whole of a sconce's life", async () => {
  const posed = await isolate(h);
  await primeSources(h, FILES);
  const classes = await fileClasses(h, FILES);
  const at = posed.run.player;
  await placeEnemy(h, "hound", at.x + TARGET_AT.dx, at.y + TARGET_AT.dy);

  await captureReplay(h, "spin", async () => {
    const firing = await fireWeapon(h, "sconce", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.projectiles,
      1,
      "the projectiles Sconce's firing tick created, which at level 1 with " +
        "one enemy alive is one sconce (specs/weapons.md)",
    );
    const sconce = firing.projectiles[0]!;

    const drawn: number[] = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
      const snapshot = tick === 0 ? firing.after : await h.step(1);
      const live = mustProjectile(snapshot, sconce.id);
      const found = await drawFromAt(
        h,
        await h.lastCalls(),
        FILES,
        stagePoint(snapshot, live.x, live.y),
        "a frame of the produced sconce sheet over the sconce",
      );
      drawn.push(found.index);
      assertTrue(
        frameAllowed(SHEET, classes, tick, found.index),
        `the sconce frame drawn ${tick} tick(s) after it was fired, which is ` +
          `floor(t / ${WALK_FRAME_TIME}) mod ${FILES.length} for t the ` +
          `seconds since (specs/assets.md); frame ${found.index} was drawn`,
      );
    }
    assertTrue(
      runsInOrder(SHEET, classes, drawn),
      "the sconce sheet's frames to run 0, 1, 2, 3 in order and wrap over the " +
        `sconce's life (specs/assets.md); [${drawn.join(", ")}] were drawn`,
    );
  });
});
