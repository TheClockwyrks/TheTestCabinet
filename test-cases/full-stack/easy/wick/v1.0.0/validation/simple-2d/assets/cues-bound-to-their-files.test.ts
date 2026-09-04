// Wick — assets/cues-bound-to-their-files: each of the fifteen cues sounds the
// produced file of its own name.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (Where the files land): "each audio cue below is bound to
//     its produced file with `api.audio.load` under its name in `CUES`", and
//     (The sound) "Produce a distinct sound for each of the fourteen cues
//     below, under exactly these file names", with the bed at
//     `assets/audio/music.wav`.
//   - specs/ui.md (Audio): "Audio plays through the engine's cue bus, each cue
//     bound with `api.audio.load` to the produced file `specs/assets.md` lists",
//     and the table fixing the event each of the fifteen plays on.
//   - specs/assets.md (Genuinely produced): "every cue plays a produced sound".
//   - `constants.ts` carries the pairing as `CUE_PATHS`.
//
// WHAT IS READ. Every sound the bus actually started, with the file its decoded
// buffer came from and the cue announced a moment before it. A cue bound to the
// wrong file, or left on a synthesized fallback because its file never loaded,
// starts a sound whose source is not `assets/audio/<name>.wav`, and is named
// here. The bus binds a name to a buffer inside the engine, so the file behind a
// cue is observable only where the bus starts it: every one of the fifteen has
// to be made to sound, and this point is the one place in the suite that makes
// all fifteen sound in a single drive.
//
// WHY THE NIGHT IS POSED FIFTEEN TIMES OVER. Each cue has exactly one event, so
// there is one scene per cue and no scene can be shared. Every scene is an
// isolated night — `isolate` resets, enters `playing`, empties the field, drops
// the fresh run's Taper and holds all seven driver switches — and turns on only
// the faculty its own event needs, so no other cue's event can happen inside
// it. A pose "sounds nothing" (specs/instrumentation.md), so every sound
// recorded came from the ticks and frames run after a pose.
//
// WHAT IT DELIBERATELY DOES NOT READ. WHICH tick or frame a cue sounds on, and
// how many times, is the audio category's, one point per event; that a file
// carries signal is `assets/cue-files-produced`. This point reads the file
// behind each sound and nothing else about it.
//
// TOLERANCE. None. A source is one file or another.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  BINDINGS,
  CUE_NAMES,
  CUE_PATHS,
  DAWN_TICK,
  MAX_WEAPON_LEVEL,
} from "../constants";
import {
  assetPath,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  openLevelUp,
  poseScene,
  spawnEnemyAt,
  spawnEnemyNear,
  spawnGemAt,
  spawnPickupAt,
  spawnProjectileAt,
  startPlay,
  tap,
  type Harness,
} from "../harness";

/** The keys specs/controls.md binds `down` and `confirm` to, first of each. */
const DOWN_KEY = BINDINGS.down[0];
const CONFIRM_KEY = BINDINGS.confirm[0];

/** Where an enemy stands clear of the lamplighter, and where one stands on it. */
const CLEAR_X = 300;
const TOUCHING_DX = 5;

/** Ember's row-1 pierce (specs/weapons.md), for a posed bolt. */
const PIERCE = 0;

/** The health posed for the fallen ending: "`0` or below" (specs/world.md). */
const FALLEN_HP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Drive the one event each cue plays on, in turn, on the one harness. */
async function soundEveryCue(): Promise<void> {
  // menu-move and menu-confirm: a highlight moves on the title, then an item
  // of TITLE_ITEMS is confirmed (specs/ui.md, Audio).
  poseScene(h, "title");
  await tap(h, DOWN_KEY);
  await tap(h, CONFIRM_KEY);

  // hit and kill: a bolt posed onto a moth damages it, and the moth dies of it.
  isolate(h);
  spawnEnemyAt(h, "moth", CLEAR_X, 0);
  spawnProjectileAt(h, "ember", CLEAR_X, 0, 0, 0, PIERCE);
  await h.tick(1);

  // gem: a gem on the lamplighter's own center is collected.
  isolate(h);
  const gemAt = h.snapshot().run.player;
  spawnGemAt(h, "small", gemAt.x, gemAt.y);
  await h.tick(1);

  // pickup: bread on the lamplighter's own center is collected.
  isolate(h);
  const breadAt = h.snapshot().run.player;
  spawnPickupAt(h, "bread", breadAt.x, breadAt.y);
  await h.tick(1);

  // hurt: a moth inside the lamplighter's circle lands its contact hit, with
  // `enemyContact` the only faculty let go.
  isolate(h);
  spawnEnemyNear(h, "moth", TOUCHING_DX, 0);
  enable(h, "enemyContact");
  await h.tick(1);

  // level-up, then choose: the tick that opens the overlay, then accepting an
  // offer on it.
  isolate(h);
  await openLevelUp(h, 1);
  await tap(h, CONFIRM_KEY);

  // chest, and evolve: Taper at MAX_WEAPON_LEVEL with Wick held turns the
  // collected chest into an evolution (specs/evolutions.md, Opening a chest).
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);
  await openChest(h);

  // fallen: the ending tick with the lamplighter's health at zero.
  isolate(h);
  h.debug.setHp(FALLEN_HP);
  await h.tick(1);

  // dawn: the tick that carries the clock to DAWN_TICK.
  isolate(h);
  h.debug.setTick(DAWN_TICK - 1);
  await h.tick(1);

  // hum: the loop holds while Halo is held on `playing` (specs/ui.md).
  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);

  // music: the loop starts on the frame a fresh run starts.
  await startPlay(h);
  await h.tick(1);
  captureStill(h, "bound");
}

it("sounds each of the fifteen cues from the file of its own name", async () => {
  await soundEveryCue();

  for (const cue of CUE_NAMES) {
    const wanted = assetPath(CUE_PATHS[cue]);
    const sounded = h.sounds.filter((sound) => sound.cue === cue);
    if (sounded.length === 0) {
      fail(
        `the ${cue} cue sounding on its event, so the file behind it can be read`,
        "it never sounded across the drive of every cue's event",
      );
    }
    const wrong = sounded.filter((sound) => sound.file !== wanted);
    if (wrong.length > 0) {
      fail(
        `every ${cue} sound coming from ${wanted}`,
        wrong[0].file === null
          ? `${cue} sounded from no produced file — a synthesized cue`
          : `${cue} sounded from ${wrong[0].file}`,
      );
    }
  }
});
