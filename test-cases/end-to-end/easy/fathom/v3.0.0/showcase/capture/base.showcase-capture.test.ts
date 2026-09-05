// showcase-capture — record REAL GAMEPLAY media for the base variant's showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s replay and stills from the reference
// implementation. No review item names it, it lives outside `validation/` so a
// run never loads it, and it is staged by hand (see the README beside this
// file).
//
// WHAT IT DOES. It opens the title screen, chooses DIVE with a real key press,
// waits out the dive countdown, and then plays the forager for half a minute
// with scripted keyboard input against the build's own predators. Nothing is
// posed mid-play: `reset({ seed })` picks the take before the title screen and
// every key edge after that is one a player could have sent.
//
// THE PLAYER HAS TWO LAYERS. EXECUTION is bang-bang key input — one arrow key
// held at a time, `Space` tapped for the sonar pulse, `ShiftLeft` tapped for
// ink — the same input path a human uses, so the forager travels at the speed
// the game gives it and the abilities obey their own cooldowns. PLANNING reads
// the debug snapshot and works the board through the BUILD's own exported
// rules: `Maze` parsed from the reported tiles, `maze.step` for the wrap
// tunnel, `maze.openToForager` / `maze.openToPredator` for what each body may
// enter, and `lightDetectRange` for how far the forager's own brightness
// carries. The plan is therefore only ever as good as the game allows; nothing
// here relaxes a rule to make the forager survive.
//
// WHAT IT PLANS FOR. Grazing (steer at the nearest corridor tile the forager
// has not yet crossed, which is where the plankton still are), the bonus
// drifter once one is admitted, a pulse on a cadence so the sonar wavefront
// floods the corridors, ink when a hunter is closing, and flight — away from
// every hunter at once, along the corridors, when one comes within reach, with
// the two that hunt by light given more room the brighter the forager has
// grazed itself.
//
// DETERMINISM. Every decision is a pure function of the snapshot, so a fixed
// seed replays the identical session. That is what lets a take be auditioned
// with the recorder off and then re-run under it exactly.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2100 \
//     npx vitest run --config validation/vitest.config.ts \
//       validation/showcase-capture.test.ts

import { readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { Image, loadImage } from "@napi-rs/canvas";
import { ConstantClock } from "@clockwyrks/structured-2d";
import { GRID_COLS, GRID_ROWS, SCORE_DRIFTER } from "../src/constants";
import { DIRS, cellIndex, type Cell, type Dir } from "../src/grid";
import { Maze, type TileTest } from "../src/maze";
import { lightDetectRange } from "../src/predators";
import {
  captureReplay,
  captureStill,
  createHarness,
  type Harness,
} from "./harness";
import type { FathomSnapshot, PredatorSnapshot } from "./surface";

/**
 * The clip is recorded at the cadence a browser draws at: one engine frame
 * every 1/60 s, which the build's own accumulator runs as two of its fixed
 * simulation ticks. Recording at the game's 120 Hz tick rate instead would
 * double the frames for a picture no smoother than this one.
 */
const FRAME_HZ = 60;
const FRAME_MS = 1000 / FRAME_HZ;

const CELLS = GRID_COLS * GRID_ROWS;

/* -------------------------------------------------------------------------- */
/* The seeded art                                                             */
/* -------------------------------------------------------------------------- */

/** The build's own workspace, from this file's staged location inside it. */
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ROOT = join(WORKSPACE, "assets");

/**
 * Give the process the two things a browser has and it does not: something to
 * fetch an asset from, and something to decode one with.
 *
 * This matters more here than it would anywhere else. Fathom is seeded with
 * seven sprite sheets, and the build draws every creature and every wall from
 * its sheet where the sheet arrived and from a shape in code where it did not.
 * A validator never sees the sheets — there is no server in process and no
 * `createImageBitmap` — so it checks the fallback, which is exactly right for a
 * check about where a body is or what color it burns. A SHOWCASE is the other
 * case: a visitor is being shown the game, and the game has art.
 *
 * The build is untouched by this. It asks the engine's own loader for the same
 * paths under the same asset root, and what changes is only that the answer
 * arrives. Nothing here can put anything on screen the build did not draw.
 */
function serveSeededArt(): void {
  const host = globalThis as unknown as {
    fetch: (url: string) => Promise<Response>;
    createImageBitmap: (blob: Blob) => Promise<unknown>;
  };
  const upstream = host.fetch.bind(globalThis);
  host.fetch = async (url: string): Promise<Response> => {
    const file = normalize(join(WORKSPACE, url));
    // Only the workspace's own asset directory is served, so a path that
    // resolved anywhere else is left to whatever would have answered it.
    if (!file.startsWith(`${ASSET_ROOT}${sep}`)) return upstream(url);
    try {
      return new Response(new Uint8Array(readFileSync(file)));
    } catch {
      // The same answer a server gives for a file it does not have, so the
      // build takes the same fallback it would take in a browser.
      return new Response(null, { status: 404 });
    }
  };
  // `Image` is what this host's decoded bitmap IS, and saying so is what lets
  // the engine's recorder recognize a sprite as a picture worth keeping rather
  // than as an opaque value it cannot draw.
  (host as unknown as Record<string, unknown>).ImageBitmap = Image;
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
}

/** Which arrow key steers each direction. */
const DIR_KEY: Readonly<Record<Dir, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

const seconds = (frames: number): number => frames / FRAME_HZ;
const framesFor = (duration: number): number => Math.round(duration * FRAME_HZ);

/* -------------------------------------------------------------------------- */
/* Reading the board                                                          */
/* -------------------------------------------------------------------------- */

/** Distances out from one tile, and the opening move that reaches each. */
interface Field {
  /** Corridor steps to each tile, `-1` where the tile was never reached. */
  readonly dist: Int32Array;
  /** The first step of a shortest route to each tile, from the source. */
  readonly opener: (Dir | null)[];
}

/**
 * A breadth-first sweep of the board from `from`, over the tiles `open`
 * accepts, stepping with the build's own `maze.step` so the wrap tunnel joins
 * its two mouths exactly as it does in play.
 */
function sweep(maze: Maze, from: Cell, open: TileTest): Field {
  const dist = new Int32Array(CELLS).fill(-1);
  const opener: (Dir | null)[] = new Array<Dir | null>(CELLS).fill(null);
  const start = cellIndex(from.tx, from.ty);
  dist[start] = 0;
  let frontier: Cell[] = [from];
  while (frontier.length > 0) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      const here = cellIndex(cell.tx, cell.ty);
      for (const dir of DIRS) {
        const to = maze.step(cell.tx, cell.ty, dir);
        if (
          to.tx < 0 ||
          to.tx >= GRID_COLS ||
          to.ty < 0 ||
          to.ty >= GRID_ROWS
        ) {
          continue;
        }
        if (!open(to.tx, to.ty)) continue;
        const key = cellIndex(to.tx, to.ty);
        if (dist[key] !== -1) continue;
        dist[key] = dist[here] + 1;
        opener[key] = here === start ? dir : opener[here];
        next.push(to);
      }
    }
    frontier = next;
  }
  return { dist, opener };
}

/** How far a field reached a tile, or `Infinity` where it never did. */
function reach(field: Field, tx: number, ty: number): number {
  const found = field.dist[cellIndex(tx, ty)];
  return found === -1 ? Infinity : found;
}

/** Every hunter out of the den, which is every hunter that can reach us. */
function loose(snapshot: FathomSnapshot): PredatorSnapshot[] {
  return snapshot.predators.filter((one) => one.state !== "den");
}

/* -------------------------------------------------------------------------- */
/* The scripted player                                                        */
/* -------------------------------------------------------------------------- */

/** How a take is played: the two knobs an audition rotates. */
interface Style {
  /** Seconds between sonar pulses, when one is ready and nothing is closing. */
  readonly pulseGap: number;
  /** Corridor steps at which a loose hunter turns the forager around. */
  readonly fleeAt: number;
}

/** The styles auditioned, rotated against the seed. */
const STYLES: readonly Style[] = [
  { pulseGap: 5, fleeAt: 5 },
  { pulseGap: 7, fleeAt: 4 },
  { pulseGap: 4, fleeAt: 6 },
];

/** What one frame of play did, for the take's own bookkeeping. */
interface Beat {
  /** Corridor steps to the nearest loose hunter, `Infinity` with none abroad. */
  readonly threat: number;
  /** Corridor steps to the nearest hunter actually holding a fix on us. */
  readonly hunted: number;
  /** Whether a pulse was cast this frame. */
  readonly pulsed: boolean;
  /** Whether ink was released this frame. */
  readonly inked: boolean;
}

/**
 * The forager, played from the snapshot alone.
 *
 * One instance per take: it remembers which tiles the forager has crossed,
 * which is how it knows where the plankton still are — the snapshot reports
 * how many remain, not where, and a corridor tile the forager has not yet
 * stood on is exactly a tile whose mote is still there.
 */
class Player {
  private held: string | null = null;
  private taps: string[] = [];
  private visited = new Set<number>();
  private maze: Maze | null = null;
  private layout = "";
  private target: Cell | null = null;
  private lastPulse = -Infinity;
  private frame = 0;

  constructor(
    private readonly h: Harness,
    private readonly style: Style,
  ) {}

  /** Let go of every key, as a take that ended mid-press must. */
  releaseAll(): void {
    if (this.held !== null) this.h.release(this.held);
    this.held = null;
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "ShiftLeft",
      "Enter",
    ]) {
      this.h.release(key);
    }
    this.taps = [];
  }

  private hold(key: string | null): void {
    if (key === this.held) return;
    if (this.held !== null) this.h.release(this.held);
    if (key !== null) this.h.hold(key);
    this.held = key;
  }

  /** Press a key for exactly the frame about to run, then let it go. */
  private tap(key: string): void {
    this.h.hold(key);
    this.taps.push(key);
  }

  /** Decide the frame about to run. Called immediately before `advance(1)`. */
  step(): Beat {
    for (const key of this.taps) this.h.release(key);
    this.taps = [];
    this.frame += 1;

    const snapshot = this.h.snapshot();
    if (snapshot.screen === "title") {
      this.hold(null);
      // DIVE is the title's first item and the menu opens on it.
      this.tap("Enter");
      return {
        threat: Infinity,
        hunted: Infinity,
        pulsed: false,
        inked: false,
      };
    }
    if (snapshot.screen !== "playing") {
      // The countdown and the cleared interstitial read no movement, and a key
      // left held across one would steer the moment play resumed.
      this.hold(null);
      return {
        threat: Infinity,
        hunted: Infinity,
        pulsed: false,
        inked: false,
      };
    }
    return this.play(snapshot);
  }

  private play(snapshot: FathomSnapshot): Beat {
    const maze = this.mazeOf(snapshot);
    const here: Cell = { tx: snapshot.forager.tx, ty: snapshot.forager.ty };
    this.visited.add(cellIndex(here.tx, here.ty));

    const mine = sweep(maze, here, maze.openToForager);
    const hunters = loose(snapshot);
    const threat = hunters.reduce(
      (best, one) => Math.min(best, reach(mine, one.tx, one.ty)),
      Infinity,
    );
    const hunted = hunters.reduce(
      (best, one) =>
        one.state === "chase" || one.state === "search"
          ? Math.min(best, reach(mine, one.tx, one.ty))
          : best,
      Infinity,
    );

    // Ink is spent to break a chase, which is the one thing it is for: a cloud
    // dropped on the forager's own tile stands between it and whatever is
    // coming, and a hunter that swims into one loses its senses inside it.
    let inked = false;
    if (snapshot.ink.ready && (hunted <= 5 || threat <= 3)) {
      this.tap("ShiftLeft");
      inked = true;
    }

    // A pulse on a cadence, so the wavefront floods the corridors while there
    // is board left to see, and again the moment something is closing.
    let pulsed = false;
    const sincePulse = seconds(this.frame) - this.lastPulse;
    if (
      snapshot.sonar.ready &&
      !inked &&
      (sincePulse >= this.style.pulseGap ||
        (threat <= this.style.fleeAt + 3 && sincePulse >= 2))
    ) {
      this.tap("Space");
      this.lastPulse = seconds(this.frame);
      pulsed = true;
    }

    // A hunter that hunts by light opens a chase from further off the brighter
    // the forager is, on the build's own curve, and the forager is at its
    // brightest exactly when it has been grazing well. One already inside that
    // radius is given more room than one that has to find us first.
    const lightReach = lightDetectRange(snapshot.brightness);
    const sensed = hunters.some(
      (one) =>
        one.detectRange !== null &&
        Math.hypot(one.x - snapshot.forager.x, one.y - snapshot.forager.y) <=
          lightReach,
    );
    const fleeAt = this.style.fleeAt + (sensed ? 2 : 0);

    const dir =
      threat <= fleeAt
        ? this.flee(maze, here, hunters)
        : this.forage(maze, mine, snapshot);
    this.hold(dir === null ? null : DIR_KEY[dir]);
    return { threat, hunted, pulsed, inked };
  }

  /** The build's own maze, rebuilt whenever the reported layout changes. */
  private mazeOf(snapshot: FathomSnapshot): Maze {
    const layout = snapshot.tiles.join("\n");
    if (this.maze === null || layout !== this.layout) {
      this.maze = new Maze(snapshot.tiles);
      this.layout = layout;
      this.target = null;
    }
    return this.maze;
  }

  /**
   * Where to graze. A drifter is worth twenty plankton, so one is taken the
   * moment it is admitted; otherwise the forager heads for the nearest corridor
   * tile it has not yet crossed. The chosen tile is kept until it is reached or
   * goes stale, so the forager commits to a corridor instead of dithering
   * between two equally distant ones at every junction.
   */
  private forage(
    maze: Maze,
    mine: Field,
    snapshot: FathomSnapshot,
  ): Dir | null {
    let target: Cell | null = null;
    let best = Infinity;
    for (const drifter of snapshot.drifters) {
      const steps = reach(mine, drifter.tx, drifter.ty);
      if (steps < best) {
        best = steps;
        target = { tx: drifter.tx, ty: drifter.ty };
      }
    }

    if (target === null) {
      const kept = this.target;
      const keptFresh =
        kept !== null &&
        !this.visited.has(cellIndex(kept.tx, kept.ty)) &&
        reach(mine, kept.tx, kept.ty) !== Infinity;
      if (keptFresh) target = kept;
      else {
        for (let index = 0; index < CELLS; index += 1) {
          if (this.visited.has(index)) continue;
          const tx = index % GRID_COLS;
          const ty = Math.floor(index / GRID_COLS);
          if (!maze.isCorridor(tx, ty)) continue;
          const steps = reach(mine, tx, ty);
          if (steps < best) {
            best = steps;
            target = { tx, ty };
          }
        }
        this.target = target;
      }
    }

    if (target === null) return null;
    return mine.opener[cellIndex(target.tx, target.ty)];
  }

  /**
   * Which way to run. Every loose hunter is swept from in turn — over the tiles
   * a PREDATOR may enter, since that is the ground it will close over — and the
   * forager takes the open neighbour that leaves the nearest of them furthest
   * behind, breaking ties toward the corridor it has not yet grazed.
   */
  private flee(
    maze: Maze,
    here: Cell,
    hunters: PredatorSnapshot[],
  ): Dir | null {
    const fields = hunters.map((one) =>
      sweep(maze, { tx: one.tx, ty: one.ty }, maze.openToPredator),
    );
    let chosen: Dir | null = null;
    let bestGap = -Infinity;
    let bestFresh = false;
    for (const dir of DIRS) {
      const to = maze.step(here.tx, here.ty, dir);
      if (!maze.openToForager(to.tx, to.ty)) continue;
      let gap = Infinity;
      for (const field of fields)
        gap = Math.min(gap, reach(field, to.tx, to.ty));
      const fresh = !this.visited.has(cellIndex(to.tx, to.ty));
      if (gap > bestGap || (gap === bestGap && fresh && !bestFresh)) {
        bestGap = gap;
        bestFresh = fresh;
        chosen = dir;
      }
    }
    // Running has taken us off the grazing route, so the next quiet frame picks
    // a fresh one rather than doubling back into what we just fled.
    this.target = null;
    return chosen;
  }
}

/* -------------------------------------------------------------------------- */
/* Takes                                                                      */
/* -------------------------------------------------------------------------- */

/** What a take turned out to be, which is what an audition judges it on. */
interface Take {
  readonly seed: number;
  readonly style: number;
  readonly frames: number;
  readonly score: number;
  readonly plankton: number;
  readonly drifters: number;
  readonly pulses: number;
  readonly inks: number;
  /** Chases opened, and separate occasions a hunter closed to within 4 tiles. */
  readonly chases: number;
  readonly closeCalls: number;
  /** Alert flashes, Flarefish blooms and Gloamfin pings seen. */
  readonly tells: number;
  readonly blooms: number;
  readonly pings: number;
  readonly livesLost: number;
  /** The longest stretch with nothing eaten and nothing abroad, in seconds. */
  readonly maxLull: number;
  readonly endedOnBeat: boolean;
  /** The peak brightness reached, which is how wide the light opened. */
  readonly brightest: number;
}

/**
 * A watchable clip: plankton going down steadily, a drifter taken, hunters met
 * and got away from, both abilities used, no long stretch of nothing, and an
 * ending that settles. A life lost is not disqualifying, but it is a downbeat
 * the showcase can do without.
 */
function judge(take: Take): number {
  return (
    take.plankton * 0.3 +
    take.drifters * 40 +
    take.chases * 12 +
    take.closeCalls * 8 +
    take.tells * 4 +
    take.blooms * 8 +
    take.pings * 2 +
    (take.pulses > 0 ? 12 : -40) +
    (take.inks > 0 ? 12 : -40) +
    take.brightest * 10 -
    take.maxLull * 4 -
    take.livesLost * 80 +
    (take.endedOnBeat ? 20 : -20)
  );
}

let harness: Harness;

beforeEach(async () => {
  // Before the harness, because the sheets are loaded inside `initialize`.
  serveSeededArt();
  harness = await createHarness({ clock: new ConstantClock(FRAME_MS) });
});

afterEach(() => {
  harness?.dispose();
});

it("records the showcase clip and stills", async () => {
  const h = harness;

  const minFrames = framesFor(
    Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "26"),
  );
  const maxFrames = framesFor(
    Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "38"),
  );
  /**
   * How long the clip runs before a merely QUIET frame is allowed to end it.
   * A drifter is admitted a full twenty-five seconds into the dive, so ending
   * on the first calm frame past the minimum would cut the clip a beat before
   * the one thing worth waiting for.
   */
  const quietFrames = framesFor(
    Number(process.env.TCAB_SHOWCASE_QUIET_SECONDS ?? "33"),
  );
  /** How long the clip holds after the beat it ends on. */
  const settle = framesFor(0.9);

  /**
   * One take: the game back to the title on `seed`, DIVE chosen with a key,
   * and the dive played out. Recording changes nothing the game sees, so the
   * take a recorder-off audition measured is the take a recorder-on run
   * records.
   */
  const runTake = async (
    seed: number,
    style: number,
    record: boolean,
  ): Promise<Take> => {
    const player = new Player(h, STYLES[style]);
    player.releaseAll();
    h.debug.reset({ seed });
    await h.advance(1);

    const opening = h.snapshot();
    let plankton = 0;
    let drifters = 0;
    let pulses = 0;
    let inks = 0;
    let closeCalls = 0;
    let close = false;
    let tells = 0;
    let blooms = 0;
    let pings = 0;
    let livesLost = 0;
    let brightest = 0;
    let maxLull = 0;
    let lastEvent = 0;
    let remaining = Infinity;
    let lives = opening.lives;
    let score = opening.score;
    let beatAt: number | null = null;
    let endedOnBeat = false;
    let stills = { pulse: false, hunt: false };
    /**
     * When the last still was written. The two stills are held apart, because a
     * carousel wants two moments of the dive rather than the same moment twice:
     * the beats they wait for tend to arrive together, since a pulse is what
     * lights a hunter up in the first place.
     */
    let lastStill = -Infinity;
    const spaced = (frame: number): boolean =>
      frame - lastStill >= framesFor(6);
    const chasing = new Set<number>();
    const chased = new Set<number>();
    const alerting = new Set<number>();
    const blooming = new Set<number>();
    let pingsInFlight = 0;

    let frames = 0;
    while (frames < maxFrames) {
      const beat = player.step();
      await h.advance(1);
      // The harness keeps every draw call and every cue the build made, for the
      // rendering checks to read back. A capture drives tens of thousands of
      // frames across an audition and reads neither list, so both are dropped
      // as they are made rather than being carried to the end of the run.
      h.calls.length = 0;
      h.cues.length = 0;
      frames += 1;
      // A whole take runs inside one test, and every frame it advances settles
      // on already-resolved promises, so the loop never hands the macrotask
      // queue back and the runner's own reporter timers never get a turn.
      // Yielding once a second of play is what keeps the run reporting.
      if (frames % framesFor(1) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (beat.pulsed) pulses += 1;
      if (beat.inked) inks += 1;

      const snapshot = h.snapshot();
      if (snapshot.screen === "playing") {
        if (remaining === Infinity) remaining = snapshot.planktonRemaining;
        if (snapshot.planktonRemaining < remaining) {
          plankton += remaining - snapshot.planktonRemaining;
          remaining = snapshot.planktonRemaining;
          lastEvent = frames;
        }
        if (snapshot.score - score >= SCORE_DRIFTER) {
          drifters += 1;
          beatAt = frames;
          lastEvent = frames;
        }
        score = snapshot.score;
        brightest = Math.max(brightest, snapshot.brightness);
        if (beat.threat <= 6) lastEvent = frames;
        // Counted as OCCASIONS rather than frames: a clip is better for three
        // separate brushes with a hunter than for one long cornering.
        if (beat.threat <= 4) {
          if (!close) closeCalls += 1;
          close = true;
        } else if (beat.threat > 6) close = false;

        snapshot.predators.forEach((one, index) => {
          if (one.state === "chase") {
            if (!chasing.has(index)) {
              chasing.add(index);
              chased.add(index);
            }
          } else chasing.delete(index);
          if (one.alert) {
            if (!alerting.has(index)) {
              alerting.add(index);
              tells += 1;
            }
          } else alerting.delete(index);
          if (one.flaring === true) {
            if (!blooming.has(index)) {
              blooming.add(index);
              blooms += 1;
            }
          } else blooming.delete(index);
        });
        const flight = snapshot.pulses.filter(
          (one) => one.source === "gloamfin",
        ).length;
        if (flight > pingsInFlight) pings += flight - pingsInFlight;
        pingsInFlight = flight;

        maxLull = Math.max(maxLull, seconds(frames - lastEvent));
      }
      if (snapshot.lives < lives) {
        livesLost += lives - snapshot.lives;
        lastEvent = frames;
      }
      lives = snapshot.lives;
      // The dive was restarted or ended: the roster and the light start over,
      // so nothing carried across is worth measuring against what came before.
      if (snapshot.screen !== "playing") {
        remaining = Infinity;
        chasing.clear();
        alerting.clear();
        blooming.clear();
        pingsInFlight = 0;
      }

      if (record && snapshot.screen === "playing") {
        // Two stills, both from this take: the sonar wavefront lighting the
        // corridors, and a hunter drawn close in the forager's own light.
        if (
          !stills.pulse &&
          // Late enough that the dive has opened a good part of the trench, so
          // the picture shows the wavefront against a board with some shape to
          // it rather than against the dark of the first few seconds.
          frames > framesFor(16) &&
          spaced(frames) &&
          snapshot.pulses.some(
            (one) => one.source === "forager" && one.front > 4,
          )
        ) {
          captureStill(h, "sonar-sweep");
          stills.pulse = true;
          lastStill = frames;
        }
        if (
          !stills.hunt &&
          frames > framesFor(8) &&
          spaced(frames) &&
          beat.threat <= 5 &&
          snapshot.predators.some((one) => one.lit && one.state !== "den")
        ) {
          captureStill(h, "hunted");
          stills.hunt = true;
          lastStill = frames;
        }
        if (
          process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
          frames % framesFor(4) === 0
        ) {
          captureStill(
            h,
            `qa-${String(frames / framesFor(4)).padStart(2, "0")}`,
          );
        }
      }

      // End on a settled beat: the hold after the drifter is taken, past the
      // minimum length — never mid-flight, and never on a life lost.
      if (
        beatAt !== null &&
        frames >= minFrames &&
        frames - beatAt >= settle &&
        snapshot.screen === "playing"
      ) {
        endedOnBeat = true;
        break;
      }
      // Failing that, the first quiet frame past the quiet threshold: nothing
      // abroad within reach and no wavefront still crossing the board.
      if (
        beatAt === null &&
        frames >= quietFrames &&
        snapshot.screen === "playing" &&
        beat.threat > 8 &&
        snapshot.pulses.length === 0
      ) {
        endedOnBeat = true;
        break;
      }
    }

    player.releaseAll();
    return {
      seed,
      style,
      frames,
      score,
      plankton,
      drifters,
      pulses,
      inks,
      chases: chased.size,
      closeCalls,
      tells,
      blooms,
      pings,
      livesLost,
      maxLull,
      endedOnBeat,
      brightest,
    };
  };

  const seeds = (
    process.env.TCAB_SHOWCASE_SEEDS ?? "1,2,3,4,5,6,7,8,9,10,11,12"
  )
    .split(",")
    .map((one) => Number(one.trim()));
  let best: Take | null = null;
  for (const seed of seeds) {
    for (let style = 0; style < STYLES.length; style += 1) {
      const take = await runTake(seed, style, false);
      const rating = judge(take);
      console.log(
        `take seed=${seed} style=${style}: ${seconds(take.frames).toFixed(1)}s, ` +
          `${take.plankton} plankton, ${take.drifters} drifter(s), ` +
          `${take.chases} chase(s), ${take.closeCalls} close call(s), ` +
          `${take.tells} tell(s), ${take.blooms} bloom(s), ${take.pings} ping(s), ` +
          `${take.pulses} pulse(s), ${take.inks} ink, ` +
          `G max ${take.brightest.toFixed(2)}, lull ${take.maxLull.toFixed(1)}s, ` +
          `${take.livesLost} life lost, ` +
          `${take.endedOnBeat ? "clean end" : "ran out"} -> ${rating.toFixed(0)}`,
      );
      if (best === null || rating > judge(best)) best = take;
    }
  }

  const winner = best!;
  console.log(`recording take seed=${winner.seed} style=${winner.style}`);
  const final = await captureReplay(h, "gameplay", () =>
    runTake(winner.seed, winner.style, true),
  );
  console.log(
    JSON.stringify({ ...final, seconds: seconds(final.frames) }, null, 2),
  );
}, 1_800_000);
