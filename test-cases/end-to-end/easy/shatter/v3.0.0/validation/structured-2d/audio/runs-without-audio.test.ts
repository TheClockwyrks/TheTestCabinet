// audio/runs-without-audio — the game runs whether or not audio does.
//
// `specs/audio.md` states it as a rule of its own, and it is the one audio rule
// that is not about a cue: "The game runs, draws, and is fully playable before any
// audio has started, and it never fails to run if audio cannot start at all. With
// no audio available, a game is opened, flown, fired, and scored exactly as it is
// with audio working, and every reading the game reports is the same."
//
// SO THE SAME SCENARIO IS PLAYED TWICE, IN TWO ENVIRONMENTS. Once where the host
// offers a working audio context and the engine's bus really builds its graphs,
// and once where audio CANNOT START AT ALL, and the two runs' readings are
// compared. That is the whole shape of the point: not that a silent build
// survives, but that nothing about play changed.
//
// HOW AUDIO IS GIVEN AND TAKEN AWAY. The bus belongs to the engine here
// (`specs/instrumentation.md`), and it asks the HOST for a context on the first
// gesture — `globalThis.AudioContext` if the host has one, and nothing at all if it
// does not. A node process has none, so the silent run needs no sabotage: it is the
// environment the specification describes, reached by leaving the host alone. The
// audible run is the one that has to be arranged, by installing a context on the
// host before the engine is built, so that the bus opens it at the first key and
// every cue the build plays really builds an oscillator and a gain node on it. Both
// runs then deliver the SAME real gestures, so the only difference between them is
// whether audio could start.
//
// THE BOOT LEG IS THE FIRST SENTENCE, READ ON ITS OWN. Audio does not start until
// the first gesture reaches the page, so the frames before the first key are frames
// with no audio started at all. Each run drives a stretch of them before touching a
// key and is required to have DRAWN across it, which is "the game runs, draws, and
// is fully playable before any audio has started" measured rather than assumed.
//
// WHY THE SCENARIO IS WHAT IT IS. The rule names four things — opened, flown,
// fired, scored — and each is driven the way a player drives it. The game is opened
// from the title through its menu, on `reset`'s own `DEFAULT_SEED`, so the opening
// wave is the build's own randomness and its rocks are part of what the two runs
// have to agree on. The world is then taken under control, because a comparison of
// two runs is only a reading of the audio layer if everything else about them is
// identical by construction; the flight, the shots and the kill after that are real
// keys and a real round.
//
// WHAT THE COMPARISON DELIBERATELY LEAVES OUT. `muted`, which is the engine's own
// bit rather than a reading of play and which `reset` leaves exactly as it stands.
// Everything else the snapshot reports is compared, to six decimal places on every
// number.
//
// WHAT THIS DOES NOT DECIDE. That any cue sounds — that is the six cue points', and
// a build with no audio at all passes here and fails those, which is the separation
// the failure caps want. Nor muting, which is `audio/mute-silences`'.

import { afterEach, beforeEach, it } from "vitest";
import {
  DEFAULT_SEED,
  FACE_UP,
  SAFE_X,
  SAFE_Y,
  SCORE_SMALL,
  WAVE_BANNER_TIME,
} from "../../src/constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  aimedRound,
  captureStill,
  clearCalls,
  createHarness,
  drawOps,
  holdAction,
  poseBullet,
  poseRock,
  releaseAction,
  requireRock,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/**
 * The frames each run draws before any key is delivered.
 *
 * Half a second of the title screen with nothing touched: the bus is still locked,
 * because it opens on the first gesture and none has been made, so these are frames
 * the game runs and draws with no audio started at all.
 */
const BOOT_TICKS = ticksFor(0.5);

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
 * held key takes three shots inside this — enough that the reading afterwards is of
 * a gun that has been used rather than of one press.
 */
const FIRE_TICKS = ticksFor(0.5);

/** The ticks a round placed on a rock's doorstep is given to land. */
const FLIGHT_TICKS = ticksFor(0.25);

/** The facing the shots are taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/** Where the rock that is scored on is posed, far out from the well. */
const ROCK_X = 250;
const ROCK_Y = 200;

/**
 * Decimal places every number in a reading is compared to.
 *
 * `specs/instrumentation.md` rests the whole surface on a deterministic core —
 * given the same seed and the same sequence of calls and elapsed game time, the
 * game reaches the same state every time — so two runs of one build agree exactly,
 * and this rounding only keeps a difference far below a millionth of a unit from
 * being read as a change in play.
 */
const PLACES = 6;

/** One number as the comparison sees it. */
function round(value: number): number {
  return Number(value.toFixed(PLACES));
}

/**
 * Every reading the snapshot carries about PLAY, rounded, as a comparable value.
 *
 * `muted` is left out for the reason the header states; nothing else is.
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

/* -------------------------------------------------------------------------- */
/* A host that has audio                                                      */
/* -------------------------------------------------------------------------- */
//
// The smallest thing the engine's bus can build a cue on: it asks the host for a
// context, then makes oscillators, gain nodes and buffer sources on it and connects
// them to its destination. Nothing here makes a noise — a node process has no
// speaker — but everything the bus does with a working context succeeds rather than
// being skipped, which is the difference this point is about.

/** A scheduled value on a node. Every ramp answers itself, as Web Audio's does. */
class HostParam {
  value = 0;
  setValueAtTime(value: number): HostParam {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number): HostParam {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number): HostParam {
    this.value = value;
    return this;
  }
}

/** One node of the graph: oscillator, gain, buffer source, or the destination. */
class HostNode {
  type = "sine";
  loop = false;
  buffer: unknown = null;
  readonly frequency = new HostParam();
  readonly gain = new HostParam();
  connect(): void {}
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}

/** How many nodes the audible run's build asked this host for. */
let nodesBuilt = 0;

/** A working audio context, as far as the engine's bus is concerned. */
class HostAudioContext {
  currentTime = 0;
  readonly destination = new HostNode();
  private make(): HostNode {
    nodesBuilt += 1;
    return new HostNode();
  }
  createOscillator(): HostNode {
    return this.make();
  }
  createGain(): HostNode {
    return this.make();
  }
  createBufferSource(): HostNode {
    return this.make();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  decodeAudioData(): Promise<never> {
    // A host with a context but no file to decode, which is the same answer the
    // silent run gives, so a build that loads a cue from a file is refused
    // identically in both.
    return Promise.reject(new Error("shatter: no audio file to decode"));
  }
}

/** The key the host's audio context is installed under. */
const AUDIO_CONTEXT_KEY = "AudioContext";

/** The host, as something a context can be put on and taken off. */
function host(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* The scenario                                                               */
/* -------------------------------------------------------------------------- */

/** The six moments one play-through is read at, in the order it reaches them. */
interface Moments {
  booted: ShatterSnapshot;
  opened: ShatterSnapshot;
  spawned: ShatterSnapshot;
  flown: ShatterSnapshot;
  fired: ShatterSnapshot;
  scored: ShatterSnapshot;
}

/** What one play-through produced. */
interface PlayThrough {
  /** The six moments as comparable digests, which is what the two runs agree on. */
  readings: Record<keyof Moments, unknown>;
  /** The same six as the game reported them, which is what the legs below read. */
  raw: Moments;
  /** Drawing operations issued before any key was delivered. */
  bootDraws: number;
}

/**
 * Open a game, fly it, fire it and score on it, and report what it read at each,
 * beside the drawing it issued before any key was delivered.
 *
 * Every step is either a real key through the engine's own input or a pose
 * `specs/instrumentation.md` defines, and nothing here depends on wall-clock time,
 * so two runs of one build produce the same readings.
 */
async function playThrough(h: Harness): Promise<PlayThrough> {
  h.debug.reset({ seed: DEFAULT_SEED });

  // Before any audio has started: no key has been delivered, so the bus has had no
  // gesture to open on, and these frames are the game running and drawing with no
  // audio at all.
  clearCalls(h);
  await h.advance(BOOT_TICKS);
  const bootDraws = drawOps(h.calls);
  const booted = h.snapshot();

  // Opened: from the title, through the menu, on `reset`'s own seed. This is also
  // the first gesture, so it is where audio starts if it can.
  await tapAction(h, "confirm");
  const opened = h.snapshot();
  await h.advance(OPENING_TICKS);
  const spawned = h.snapshot();

  // From here the world is posed, so everything below is the same scenario twice.
  startPlaying(h);

  // Flown: a real turn, then a real burn.
  holdAction(h, "left");
  await h.advance(TURN_TICKS);
  releaseAction(h, "left");
  holdAction(h, "up");
  await h.advance(BURN_TICKS);
  releaseAction(h, "up");
  const flown = h.snapshot();

  // Fired: back at the safe point, at rest, facing across the field with the gun's
  // gate clear, so the rounds cross empty space rather than the star's core.
  h.debug.setShipPosition(SAFE_X, SAFE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(ACROSS_THE_FIELD);
  h.debug.setFireCooldown(0);
  holdAction(h, "a");
  await h.advance(FIRE_TICKS);
  releaseAction(h, "a");
  const fired = h.snapshot();

  // Scored: a real round onto a real rock, through the build's own collision and
  // scoring.
  h.debug.clearBullets();
  h.debug.setShipAngle(FACE_UP);
  const rock = poseRock(h, "small", ROCK_X, ROCK_Y);
  const target = requireRock(
    h.snapshot(),
    rock,
    "the Small this scenario scores on (specs/instrumentation.md)",
  );
  const round_ = aimedRound(target);
  poseBullet(h, round_.x, round_.y, round_.vx, round_.vy);
  await h.until((s) => !s.rocks.some((one) => one.id === rock), {
    maxFrames: FLIGHT_TICKS,
  });
  const scored = h.snapshot();

  const raw: Moments = { booted, opened, spawned, flown, fired, scored };
  return {
    readings: {
      booted: digest(booted),
      opened: digest(opened),
      spawned: digest(spawned),
      flown: digest(flown),
      fired: digest(fired),
      scored: digest(scored),
    },
    raw,
    bootDraws,
  };
}

let h: Harness;
let audible: Harness | undefined;

beforeEach(async () => {
  nodesBuilt = 0;
  delete host()[AUDIO_CONTEXT_KEY];
  h = await createHarness();
});

afterEach(() => {
  delete host()[AUDIO_CONTEXT_KEY];
  audible?.dispose();
  audible = undefined;
  h?.dispose();
});

it("opens, flies, fires and scores identically with no audio available at all", async () => {
  // The audible run: a host that has a context, opened by the run's own first key.
  host()[AUDIO_CONTEXT_KEY] = HostAudioContext;
  audible = await createHarness();
  const withAudio = await playThrough(audible);
  audible.dispose();
  audible = undefined;
  const built = nodesBuilt;
  delete host()[AUDIO_CONTEXT_KEY];

  // The silent run: the same build, on a host with no audio context at all.
  const silent = await playThrough(h);
  captureStill(h, "silent");

  assertGreaterThan(
    silent.bootDraws,
    0,
    "drawing operations the build's render issued over the " +
      `${String(BOOT_TICKS)} frames before any key reached it, on a host with ` +
      "no audio at all — the game runs and DRAWS before any audio has started " +
      "(specs/audio.md)",
  );
  // Opened, flown, fired and scored, each read in the run with no audio: the four
  // things `specs/audio.md` requires of a game whose audio cannot start. Each is
  // some other point's requirement in general — `screens/play-starts-a-game`,
  // `flight/thrust-accelerates`, `controls/fire-space`, `scoring/small-scores-100`
  // — and is read here because this point is about them being reached at all in an
  // environment with no audio.
  assertEqual(
    silent.raw.opened.screen,
    "playing",
    "the screen after PLAY was confirmed on the title, in the run with no " +
      "audio — a full game is opened with no audio available (specs/audio.md)",
  );
  assertGreaterThan(
    silent.raw.spawned.rocks.length,
    0,
    `rocks on the field ${String(OPENING_TICKS)} ticks into the opened game, ` +
      "in the run with no audio — the wave the game opened with " +
      "(specs/audio.md, specs/progression.md)",
  );
  assertGreaterThan(
    silent.raw.flown.ship.speed,
    0,
    "the ship's speed after a real turn and a real burn, in the run with no " +
      "audio — a game with no audio available is flown (specs/audio.md)",
  );
  assertGreaterThan(
    silent.raw.fired.bullets.length,
    0,
    `rounds in flight after ${String(FIRE_TICKS)} ticks of the fire key held, ` +
      "in the run with no audio — a game with no audio available is fired " +
      "(specs/audio.md)",
  );
  assertEqual(
    silent.raw.scored.score,
    SCORE_SMALL,
    "the score after a Small was destroyed in the run with no audio — a game " +
      "with no audio available is opened, flown, fired and scored exactly as " +
      "one with audio working (specs/audio.md)",
  );
  assertDeepEqual(
    silent.readings,
    withAudio.readings,
    "every reading of the boot, the opening, the wave it put up, the flight, " +
      "the shots and the kill, taken on a host with no audio context, against " +
      "the same six taken on a host that has one and built " +
      `${String(built)} audio nodes on it — specs/audio.md requires every ` +
      "reading the game reports to be the same",
  );
});
