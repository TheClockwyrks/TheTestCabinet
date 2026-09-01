// assets/cues-bound-to-their-files — every cue the game plays is that cue's own
// produced file.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sound") fixes the file
// each cue plays: "Produce a distinct sound for each of the fourteen cues below,
// under exactly these file names", `assets/audio/hit.wav` through
// `assets/audio/hum.wav`, and ("The music bed") "`assets/audio/music.wav` ... The
// `.wav` is what the game plays". specs/ui.md ("Audio") fixes the event each one
// rides. So the binding this point reads is the one the two documents make
// together: raise each cue's event, and the sound the build emitted came from the
// file of that cue's own name.
//
// HOW A SOUND IS TRACED TO A FILE. A browser takes a produced `.wav` to the
// speakers along one of two roads, and the harness's probe watches both, carrying
// the file's URL from the fetch or the element to the moment the sound starts;
// the cue it names is the URL's own basename, allowing for a bundler's content
// hash. So a build that played `kill.wav` on a hit is read as having played
// `kill`, and the fifteen URLs are read as fifteen distinct files, because
// fifteen names under one directory are fifteen files.
//
// THE DRIVE. Fifteen scenarios, each the shortest route to its own event and
// nothing else: two menu presses on the title, a fresh run for the bed, Halo held
// for the hum, and an isolated night for each of the rest — a bolt on a rat for
// `hit`, a bolt on a moth for `kill`, a gem and a bread at the lamplighter's
// feet, a rat overlapping him for `hurt`, a queued level-up and the press that
// accepts an offer, a chest, a chest over a maxed Taper with Wick held for
// `evolve`, health at zero for `fallen`, and the tick after `35999` for `dawn`.
// "A cue is played by a tick or a frame, never by a pose of the debug surface"
// (specs/ui.md), so every scenario poses and then steps.
//
// THE TOLERANCE. None: a file name is exact, and the fifteen names are the
// fifteen the specification lists.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each cue plays on the right tick, and
// at most once on it, is the audio category's; that the files exist and carry
// signal is `assets/cue-files-produced` and `assets/music-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  CUE_NAMES,
  cueFile,
  MAX_POSED_TICK,
  MAX_WEAPON_LEVEL,
  type CueName,
} from "../constants";
import {
  captureStill,
  collectGem,
  collectPickup,
  createHarness,
  cuesNamed,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  openLevelUp,
  placeEnemyNear,
  placeProjectile,
  pressConfirm,
  pressDown,
  startRun,
  watchNamedCues,
  type Harness,
  type NamedCue,
} from "../harness";

/** Where the bolt and its target stand, clear of everything else. */
const TARGET_AT = { x: 200, y: 0 };

/** Where a rat stands to overlap the lamplighter: inside `12 + 12`. */
const RAT_OFFSET = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays each of the fifteen cues from the file of its own name", async () => {
  await h.armAudio();
  const heard = await watchNamedCues(h);

  /** Run one scenario and answer the sounds it produced. */
  const raise = async (run: () => Promise<unknown>): Promise<NamedCue[]> => {
    const mark = heard.length;
    await run();
    return heard.slice(mark);
  };

  /** Put a bolt on an enemy of `type` and run the tick the hit resolves on. */
  const boltOnto = async (type: "rat" | "moth"): Promise<void> => {
    await isolate(h);
    const enemy = await placeEnemyNear(h, type, TARGET_AT.x, TARGET_AT.y);
    await placeProjectile(h, "ember", enemy.x, enemy.y, 0, 0, 0);
    await h.step(1);
  };

  const played = new Map<CueName, NamedCue[]>();
  const scenarios: Readonly<Record<CueName, () => Promise<unknown>>> = {
    "menu-move": async () => {
      await h.debug.reset();
      await pressDown(h);
    },
    "menu-confirm": async () => {
      await h.debug.reset();
      await pressDown(h);
      await pressConfirm(h);
    },
    music: async () => {
      await startRun(h);
      await h.step(1);
    },
    hum: async () => {
      await isolate(h);
      await holdWeapon(h, "halo");
      await h.step(1);
    },
    hit: () => boltOnto("rat"),
    kill: () => boltOnto("moth"),
    gem: async () => {
      await isolate(h);
      await collectGem(h, "small");
    },
    hurt: async () => {
      await isolate(h, { on: ["enemyContact"] });
      await placeEnemyNear(h, "rat", RAT_OFFSET, 0);
      await h.step(1);
    },
    "level-up": async () => {
      await isolate(h);
      await openLevelUp(h);
    },
    choose: async () => {
      await isolate(h);
      await openLevelUp(h);
      await pressConfirm(h);
    },
    chest: async () => {
      await isolate(h);
      await openChest(h);
    },
    evolve: async () => {
      await isolate(h);
      await holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
      await holdPassive(h, "wick");
      await openChest(h);
    },
    pickup: async () => {
      await isolate(h);
      await collectPickup(h, "bread");
    },
    fallen: async () => {
      await isolate(h);
      await h.debug.setHp(0);
      await h.step(1);
    },
    dawn: async () => {
      await isolate(h);
      await h.debug.setTick(MAX_POSED_TICK);
      await h.step(1);
    },
  };

  for (const cue of CUE_NAMES) {
    played.set(cue, cuesNamed(await raise(scenarios[cue]), cue));
  }
  await captureStill(h, "bound");

  const urls = new Map<CueName, string>();
  for (const cue of CUE_NAMES) {
    const sounds = played.get(cue) ?? [];
    if (sounds.length === 0) {
      fail(
        `the ${cue} event playing ${cueFile(cue)} (specs/assets.md — "The sound")`,
        `it played ${
          heard.length === 0
            ? "nothing at all"
            : `nothing named ${cue}; the run heard ${[
                ...new Set(
                  heard.map((sound) => sound.name ?? "an unnamed sound"),
                ),
              ].join(", ")}`
        }`,
      );
    }
    urls.set(cue, sounds[0]!.url ?? "");
  }

  assertEqual(
    new Set(urls.values()).size,
    CUE_NAMES.length,
    "distinct files behind the fifteen cues",
  );
});
