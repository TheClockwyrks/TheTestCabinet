// audio/runs-without-audio — the game runs whether or not audio does.
//
// `specs/audio.md` states it as a rule of its own, and it is the one audio rule
// that is not about a cue: "The game runs, draws, and is fully playable before any
// audio has started, and it never fails to run if audio cannot start at all. With
// no audio available, a game is opened, flown, fired, and scored exactly as it is
// with audio working, and every reading the game reports is the same."
//
// SO THE SAME SCENARIO IS PLAYED TWICE, IN TWO PAGES. Once with the audio bus open
// and sounding, and once in a page where audio CANNOT start at all, and the two
// runs' readings are compared. That is the whole shape of the point: not that a
// silent build survives, but that nothing about play changed.
//
// HOW AUDIO IS TAKEN AWAY. `specs/audio.md` hands an engineless build the whole
// audio layer and says it synthesizes its sounds with the Web Audio API, and
// `specs/instrumentation.md` has that layer open on the player's first interaction
// rather than at load. So the Web Audio door is shut before any gesture reaches the
// page: the constructor is replaced with one that refuses, and the methods a build
// that captured the class early would still reach are replaced with refusals too.
// A REAL gesture is then delivered, so a build that opens its context on the first
// interaction meets the refusal exactly where the specification says it would meet
// a browser without Web Audio.
//
// WHY THE SCENARIO IS WHAT IT IS. The item names four things — opened, flown,
// fired, scored — and each is driven the way a player drives it. The game is opened
// from the title through the menu, with `reset`'s own `DEFAULT_SEED`, so the
// opening wave is the build's own randomness and its rocks are part of what the two
// runs have to agree on. The world is then taken under control, because a
// comparison of two runs is only a reading of the audio layer if everything else
// about them is identical by construction; the flight, the shot and the kill after
// that are real keys and a real round.
//
// WHAT THE COMPARISON DELIBERATELY LEAVES OUT. `muted`, which is the runtime's own
// bit rather than a reading of play and which `reset` leaves exactly as it stands,
// and `autoStep`, which is this harness's doing rather than the build's. Everything
// else the snapshot reports is compared, to six decimal places on every number.
//
// WHAT THIS DOES NOT DECIDE. That any cue sounds — that is the six cue points', and
// a build with no audio at all passes here and fails those, which is the separation
// the failure caps want. Nor muting, which is `audio/mute-silences`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  DEFAULT_SEED,
  FACE_UP,
  KEYS_LEFT,
  KEYS_THRUST,
  KEY_FIRE,
  SAFE_X,
  SAFE_Y,
  SCORE_SMALL,
  WAVE_BANNER_TIME,
} from "../constants";
import {
  armAudio,
  captureStill,
  createHarness,
  drawOps,
  poseRock,
  shootRock,
  startGameFromTitle,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/**
 * How long the opening is watched for before the wave is read.
 *
 * `specs/progression.md` allows either opening for wave 1 — the rocks up at once,
 * or a `WAVE 1` banner first with the rocks spawned as it ends — so the reading is
 * taken past `WAVE_BANNER_TIME` (`1.5` s) plus half a second, by which point both
 * openings have put their rocks on the field.
 */
const OPENING_TICKS = ticksFor(WAVE_BANNER_TIME + 0.5);

/** A quarter second of turning: `SHIP_TURN` (`300` deg/s) puts the nose 75 degrees over. */
const TURN_TICKS = ticksFor(0.25);

/** Half a second of thrust, which is a burn and a coast rather than a nudge. */
const BURN_TICKS = ticksFor(0.5);

/**
 * Half a second of the fire key held.
 *
 * `specs/weapons.md` gates the gun at `FIRE_INTERVAL_TICKS` (`22` ticks), so a
 * held key takes three shots inside this — enough that the reading afterwards is
 * of a gun that has been used rather than of one press.
 */
const FIRE_TICKS = ticksFor(0.5);

/** Where the rock that is scored on is posed, far out from the well. */
const ROCK_X = 250;
const ROCK_Y = 200;

/** The ticks the round is given to land, six times the flight it takes. */
const FLIGHT_TICKS = ticksFor(0.25);

/**
 * Decimal places every number in a reading is compared to.
 *
 * `specs/instrumentation.md` rests the whole surface on a deterministic core —
 * "Given the same seed and the same sequence of calls and elapsed game time, the
 * game reaches the same state every time" — so two runs of one build agree exactly,
 * and this rounding only keeps a difference far below a millionth of a unit from
 * being read as a change in play.
 */
const PLACES = 6;

/** What one snapshot contributes to the comparison. */
function round(value: number): number {
  return Number(value.toFixed(PLACES));
}

/**
 * Every reading the snapshot carries about PLAY, rounded, as a comparable value.
 *
 * `muted` and `autoStep` are left out for the reasons the header states; nothing
 * else is.
 */
function digest(s: ShatterSnapshot): unknown {
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    score: s.score,
    lives: s.lives,
    wave: s.wave,
    waveBanner: round(s.waveBanner),
    waveSpawning: s.waveSpawning,
    saucerSpawning: s.saucerSpawning,
    simTime: round(s.simTime),
    ship: {
      x: round(s.ship.x),
      y: round(s.ship.y),
      vx: round(s.ship.vx),
      vy: round(s.ship.vy),
      angle: round(s.ship.angle),
      speed: round(s.ship.speed),
      thrusting: s.ship.thrusting,
      invuln: round(s.ship.invuln),
      collision: s.ship.collision,
      fireCooldown: s.ship.fireCooldown,
    },
    bullets: s.bullets.map((b) => ({
      id: b.id,
      x: round(b.x),
      y: round(b.y),
      vx: round(b.vx),
      vy: round(b.vy),
      life: round(b.life),
    })),
    rocks: s.rocks.map((r) => ({
      id: r.id,
      x: round(r.x),
      y: round(r.y),
      vx: round(r.vx),
      vy: round(r.vy),
      size: r.size,
      radius: round(r.radius),
      health: r.health,
    })),
    enemyBullets: s.enemyBullets.map((b) => ({
      id: b.id,
      x: round(b.x),
      y: round(b.y),
      vx: round(b.vx),
      vy: round(b.vy),
      life: round(b.life),
    })),
    saucer:
      s.saucer === null
        ? null
        : {
            id: s.saucer.id,
            x: round(s.saucer.x),
            y: round(s.saucer.y),
            vx: round(s.saucer.vx),
            vy: round(s.saucer.vy),
            mind: s.saucer.mind,
            gun: s.saucer.gun,
            travel: s.saucer.travel,
          },
    torpedoes: (s.torpedoes ?? []).map((t) => ({
      id: t.id,
      x: round(t.x),
      y: round(t.y),
      vx: round(t.vx),
      vy: round(t.vy),
      heading: round(t.heading),
      life: round(t.life),
      homing: t.homing,
    })),
    torpedoCharge:
      s.torpedoCharge === undefined ? null : round(s.torpedoCharge),
    torpedoReady: s.torpedoReady ?? null,
  };
}

/**
 * Shut the Web Audio door on a page, before any gesture has opened it.
 *
 * Both halves matter. The constructor is replaced, which is what a build reaching
 * `window.AudioContext` at the moment of the gesture meets; and the methods on the
 * original prototype are replaced too, which is what a build that captured the
 * class while its module ran still reaches. Between them, "audio cannot start at
 * all" holds however early the build took its reference.
 */
async function shutAudioDown(h: Harness): Promise<void> {
  await h.page.evaluate(() => {
    const refuse = function refuse(): never {
      throw new Error("shatter: no audio is available on this page");
    };
    const window_ = window as unknown as Record<string, unknown>;
    const original = window_.AudioContext;
    const prototype =
      typeof original === "function"
        ? (original as unknown as { prototype: Record<string, unknown> })
            .prototype
        : null;
    if (prototype !== null) {
      for (const name of [
        "createOscillator",
        "createGain",
        "createBufferSource",
        "createConstantSource",
        "createBuffer",
        "createDynamicsCompressor",
        "createStereoPanner",
        "createBiquadFilter",
        "decodeAudioData",
        "resume",
      ]) {
        if (typeof prototype[name] === "function") prototype[name] = refuse;
      }
    }
    window_.AudioContext = refuse;
    window_.webkitAudioContext = refuse;
  });
}

/** Every reading one play-through produced, in the order it produced them. */
interface Readings {
  opened: unknown;
  spawned: unknown;
  flown: unknown;
  fired: unknown;
  scored: unknown;
}

/**
 * Open a game, fly it, fire it, and score on it, and report what it read at each.
 *
 * Every step is either a real key through Chromium's own input pipeline or a pose
 * `specs/instrumentation.md` defines, and nothing here depends on wall-clock time,
 * so two runs of one build produce the same five readings.
 */
async function playThrough(h: Harness): Promise<Readings> {
  // Opened: from the title, through the menu, on `reset`'s own seed.
  await startGameFromTitle(h, { seed: DEFAULT_SEED });
  const opened = await h.snapshot();
  await h.advance(OPENING_TICKS);
  const spawned = await h.snapshot();

  // From here the world is posed, so everything below is the same scenario twice.
  await startPlaying(h, { wave: 1 });

  // Flown: a real turn, then a real burn.
  await h.holdFor(KEYS_LEFT[0], TURN_TICKS);
  await h.holdFor(KEYS_THRUST[0], BURN_TICKS);
  const flown = await h.snapshot();

  // Fired: back at the safe point, at rest, with the gun's gate clear.
  await h.debug.setShipPosition(SAFE_X, SAFE_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACE_UP);
  await h.debug.setFireCooldown(0);
  await h.holdFor(KEY_FIRE, FIRE_TICKS);
  const fired = await h.snapshot();

  // Scored: a real round onto a real rock, through the build's own collision and
  // scoring.
  await h.debug.clearBullets();
  const rock = await poseRock(h, "small", ROCK_X, ROCK_Y);
  const kill = await shootRock(h, rock, { maxTicks: FLIGHT_TICKS });

  return {
    opened: digest(opened),
    spawned: digest(spawned),
    flown: digest(flown),
    fired: digest(fired),
    scored: digest(kill.snapshot),
  };
}

let h: Harness;
let silent: Harness | undefined;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await silent?.dispose();
  silent = undefined;
  await h.dispose();
});

it("opens, flies, fires and scores identically with no audio available at all", async () => {
  // The audible run: a genuine, browser-trusted gesture opens the bus, and the
  // build plays whatever it plays.
  await armAudio(h);
  const audible = await playThrough(h);

  // The silent run: the same build, in a page where audio cannot start.
  silent = await createHarness();
  await shutAudioDown(silent);
  // A real gesture all the same, so a build that opens its context on the first
  // interaction meets the refusal where it would meet a browser without Web Audio.
  await armAudio(silent);
  const readings = await playThrough(silent);
  await captureStill(silent, "silent");

  assertEqual(
    (readings.scored as { score: number }).score,
    SCORE_SMALL,
    "the score after a Small was destroyed in the run with no audio — a game " +
      "with no audio available is opened, flown, fired and scored exactly as one " +
      "with audio working (specs/audio.md)",
  );
  assertDeepEqual(
    readings,
    audible,
    "every reading of the opening, the wave it put up, the flight, the shots and " +
      "the kill, taken in a page where audio cannot start, against the same five " +
      "taken with the bus open — specs/audio.md requires every reading the game " +
      "reports to be the same",
  );
  assertEqual(
    await silent.sounds(),
    0,
    "sounds the build emitted in a page whose Web Audio constructor refuses, " +
      "which is what makes the comparison above a reading of a game with no audio",
  );
  assertGreaterThan(
    drawOps(await silent.frameCalls()),
    0,
    "drawing operations the build's render issued on a tick of the silent page — " +
      "the game runs and DRAWS whether or not audio has started (specs/audio.md)",
  );
});
