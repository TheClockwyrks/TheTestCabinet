// showcase-capture — record a REAL DIVE for the Kindle showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/kindle/dive.json.gz` and its two stills from the Kindle
// reference implementation. It opens the title screen, confirms DIVE with a real
// key press, sits through the game's own countdown, and then plays the forager
// with scripted keyboard input against the build's real predators — nothing is
// posed mid-play, and no debug pose is made after `reset`.
//
// The diver has two layers. EXECUTION is one held movement key at a time, the
// same input path a player uses, so the forager turns at tile centers, buffers a
// desired direction and crosses the wrap tunnel exactly as it does under human
// play. PLANNING reads the maze off the build's own `Maze` — its `step`, which
// carries the wrap tunnel, and its `isCorridor` — floods it for a route, and
// reads the hunters' own sensing rule (`lightDetectRange`) to decide when the
// light it is carrying has grown dangerous. The plankton it grazes are the ones
// its own path has not already taken; the danger it steers around is where the
// hunters actually stand. That is the honest way to be good at this game: through
// its own rules, rather than by relaxing them.
//
// The two abilities are used the way they are meant to be. A sonar pulse goes out
// on a cadence and again the moment a hunter is close, which floods the corridors,
// marks what is standing in them and — because a Gloamfin hears a pulse — is a
// real risk taken. Ink goes down when a Lanternjaw or a Flarefish is closing and
// can see the forager's light, which is the one thing that blinds them.
//
// The seeded art is served to the engine's loader here, so the clip shows the
// game a player sees rather than the shapes the build falls back to with no art
// (see "Serving the seeded art" below).
//
// Run from the reference workspace root, having staged the validator project and
// lifted the harness's 300-frame replay cap:
//
//   cd references/structured-2d/kindle
//   cp -r ../../../validation/structured-2d validation
//   cp ../../../showcase/capture/kindle.showcase-capture.test.ts \
//     validation/showcase-capture.test.ts
//   sed -i 's/const MAX_REPLAY_FRAMES = 300;/const MAX_REPLAY_FRAMES =\n  Number(process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300");/' \
//     validation/harness.ts
//   TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
//     TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2100 \
//     NODE_OPTIONS=--max-old-space-size=8192 \
//     npx vitest run --config validation/vitest.config.ts \
//       validation/showcase-capture.test.ts
//
// The committed clip is a style-2 take at the default bounds and a 2100-frame
// cap — 34.1 s thinned to 2045 frames, which is 60 fps. Each take opens on
// whatever trench the game lays out, so a take cannot be run twice: every take
// is recorded as it runs under outputs named for the take, the takes are judged
// afterward, and the winner's recording and stills are kept under the
// showcase's own names while the rest are deleted. `TCAB_SHOWCASE_TAKE=<style>`
// records one take of that style and auditions nothing.

import { afterEach, beforeEach, it } from "vitest";
import { Image, loadImage } from "@napi-rs/canvas";
import { readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GRID_COLS, GRID_ROWS, TILE } from "../src/constants";
import { cellIndex, opposite, type Cell, type Dir } from "../src/grid";
import { Maze } from "../src/maze";
import { lightDetectRange } from "../src/predators";
import {
  callsTo,
  captureReplay,
  captureStill,
  createHarness,
  DIR_KEY,
  TICK_HZ,
  type Harness,
} from "./harness";
import type { FathomSnapshot, PredatorSnapshot } from "./surface";

/** Every cardinal, in the order the flood expands them. */
const DIRECTIONS: readonly Dir[] = ["up", "down", "left", "right"];

/** One entry per grid cell, addressed by `cellIndex`. */
const CELLS = GRID_COLS * GRID_ROWS;

/** How far a route is planned, in corridor steps. Past this nothing is scored. */
const HORIZON = 26;

/** A drifter further than this is not worth crossing the maze for. */
const DRIFTER_REACH = 30;

/* -------------------------------------------------------------------------- */
/* Serving the seeded art to the engine's loader                              */
/* -------------------------------------------------------------------------- */
//
// specs/assets.md has the game draw its creatures, its trench tiles and its
// flare from the seven sheets seeded under `assets/`, which it loads through the
// engine's loader; the loader resolves each path relative to the page the build
// is served from and fetches it. This driver runs in a Node process with no
// page, and a showcase captured without the art would show the shapes the build
// falls back to rather than the game a player sees. So the two globals the
// loader reaches for are stood up over the workspace's own `assets/` directory
// before the harness is built, and put back afterwards — the same kind of host
// the harness's canvas and clock are. `presentation/provided-art` does exactly
// this for the same reason.

/** The workspace this driver is staged into, which is where `assets/` sits. */
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What the loader and the recorder reach for, as they stood before this file. */
interface HostGlobals {
  fetch: unknown;
  createImageBitmap: unknown;
  ImageBitmap: unknown;
}

/**
 * Stand the three globals up over the workspace's own `assets/` directory.
 *
 * The first two are what the engine's loader fetches and decodes through. The
 * third is what its RECORDER recognizes a drawable bitmap by: it captures the
 * pixels of a source that answers to one of the host bitmap types and writes an
 * opaque marker for anything else, and a marker is a `drawImage` the player
 * skips. A decoded frame here is a native `Image` and this host names no bitmap
 * type at all, so without this the replay would carry every sprite draw as a
 * marker and play back with the trench and its creatures missing. Naming the
 * class the frames actually are is what puts the seeded art into the recording.
 */
function serveSeededAssets(): HostGlobals {
  const host = globalThis as unknown as Record<string, unknown>;
  const before: HostGlobals = {
    fetch: host.fetch,
    createImageBitmap: host.createImageBitmap,
    ImageBitmap: host.ImageBitmap,
  };
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(WORKSPACE, url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
  host.ImageBitmap = Image;
  return before;
}

/** Put them back, so nothing this file did outlives it. */
function restoreHost(before: HostGlobals): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.fetch = before.fetch;
  host.createImageBitmap = before.createImageBitmap;
  host.ImageBitmap = before.ImageBitmap;
}

/* -------------------------------------------------------------------------- */
/* Reading the maze                                                           */
/* -------------------------------------------------------------------------- */

/** A corridor flood: how many steps each tile lies out, and the move that opens
 * the route to it. Both are `-1` / `null` for a tile the flood never reached. */
interface Field {
  readonly dist: Int32Array;
  readonly first: (Dir | null)[];
}

/**
 * Flood the maze from `sources` over the tiles `open` accepts, through the
 * build's own `Maze.step` so the wrap tunnel joins the two mouths of its row
 * exactly as it does for a body traveling it.
 */
function flood(
  maze: Maze,
  sources: readonly Cell[],
  open: (tx: number, ty: number) => boolean,
): Field {
  const dist = new Int32Array(CELLS).fill(-1);
  const first: (Dir | null)[] = new Array<Dir | null>(CELLS).fill(null);
  let frontier: Cell[] = [];
  for (const source of sources) {
    if (!inside(source.tx, source.ty)) continue;
    const key = cellIndex(source.tx, source.ty);
    if (dist[key] !== -1) continue;
    dist[key] = 0;
    frontier.push(source);
  }
  for (let step = 1; frontier.length > 0; step++) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      const from = cellIndex(cell.tx, cell.ty);
      for (const dir of DIRECTIONS) {
        const to = maze.step(cell.tx, cell.ty, dir);
        if (!open(to.tx, to.ty)) continue;
        const key = cellIndex(to.tx, to.ty);
        if (dist[key] !== -1) continue;
        dist[key] = step;
        first[key] = first[from] ?? dir;
        next.push(to);
      }
    }
    frontier = next;
  }
  return { dist, first };
}

function inside(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS;
}

/** Every predator whose turn has come and that is out of the den chamber. */
function loose(snapshot: FathomSnapshot): PredatorSnapshot[] {
  return snapshot.predators.filter((one) => one.state !== "den");
}

/** The separation between two bodies, in logical units. */
function apart(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** How many more wavefronts from `source` stand this frame than stood last. */
function started(
  before: FathomSnapshot,
  after: FathomSnapshot,
  source: "forager" | "gloamfin",
): number {
  const count = (snapshot: FathomSnapshot): number =>
    snapshot.pulses.filter((one) => one.source === source).length;
  return Math.max(0, count(after) - count(before));
}

/* -------------------------------------------------------------------------- */
/* The diver                                                                  */
/* -------------------------------------------------------------------------- */

/** The keys the two abilities sit on (specs/movement.md). */
const SONAR_KEY = "Space";
const INK_KEY = "ShiftLeft";

/** How a take is played beyond what the trench decides. */
interface Style {
  /** Seconds between one sonar pulse and the next, with nothing pressing. */
  readonly sonarCadence: number;
  /** Corridor steps at which a loose hunter turns grazing into flight. */
  readonly fleeAt: number;
}

const STYLES: readonly Style[] = [
  { sonarCadence: 4.5, fleeAt: 4 },
  { sonarCadence: 3.5, fleeAt: 5 },
  { sonarCadence: 5.5, fleeAt: 3 },
];

/**
 * The scripted player: one held key at a time, chosen from a route it plans
 * afresh every frame, plus the two abilities.
 *
 * It never touches the debug surface. Everything it does reaches the game as a
 * `keydown` or a `keyup` on the same event target a player's keyboard reaches.
 */
class Diver {
  /** The key currently down, so exactly one direction is ever held. */
  private held: string | null = null;
  /** Every tile the forager's center has stood on, whose plankton is gone. */
  private readonly grazed = new Set<number>();
  /** Simulation time the last pulse went out at, and the last cloud. */
  private lastPulse = -Infinity;
  private lastInk = -Infinity;

  /** The layout the snapshot reports, read through the build's own maze. */
  private readonly maze: Maze;

  constructor(
    private readonly h: Harness,
    layout: readonly string[],
    private readonly style: Style,
  ) {
    this.maze = new Maze([...layout]);
  }

  /** Let go of whatever is held, which brings the forager to rest. */
  rest(): void {
    this.want(null);
  }

  private want(key: string | null): void {
    if (key === this.held) return;
    if (this.held !== null) this.h.release(this.held);
    if (key !== null) this.h.hold(key);
    this.held = key;
  }

  /** Arm a press for the frame the caller is about to run. */
  private press(key: string): void {
    this.h.hold(key);
    this.h.release(key);
  }

  /**
   * Decide this frame: which way to swim, whether to pulse, whether to ink.
   * Called immediately before the frame that carries the decision.
   */
  step(snapshot: FathomSnapshot): void {
    if (snapshot.screen !== "playing") {
      this.rest();
      return;
    }
    const here: Cell = { tx: snapshot.forager.tx, ty: snapshot.forager.ty };
    this.grazed.add(cellIndex(here.tx, here.ty));

    const corridor = (tx: number, ty: number): boolean =>
      this.maze.isCorridor(tx, ty);
    const hunters = loose(snapshot);

    // How far each tile lies from the nearest loose hunter, through the
    // corridors the hunter would actually swim to reach it.
    const threat = flood(
      this.maze,
      hunters.map((one) => ({ tx: one.tx, ty: one.ty })),
      (tx, ty) => corridor(tx, ty) || this.maze.isGate(tx, ty),
    );
    const menace = (tx: number, ty: number): number => {
      const found = threat.dist[cellIndex(tx, ty)];
      return found === -1 ? 99 : found;
    };

    // The route field: the corridors, with the ground a hunter is standing on
    // shut out entirely so no plan swims into one.
    const route = flood(this.maze, [here], (tx, ty) => {
      if (!corridor(tx, ty)) return false;
      return menace(tx, ty) > 1;
    });

    this.abilities(snapshot, hunters, menace(here.tx, here.ty));
    this.want(this.heading(snapshot, route, menace, here));
  }

  /** The pulse and the cloud, on the terms the specification gives each. */
  private abilities(
    snapshot: FathomSnapshot,
    hunters: readonly PredatorSnapshot[],
    pressure: number,
  ): void {
    const now = snapshot.simTime;

    // Ink blinds a Lanternjaw or a Flarefish that can see the forager's light,
    // and nothing else does. Put it down when one of them is closing and the
    // light it hunts by is inside its own detection range.
    const sensing = lightDetectRange(snapshot.brightness);
    const blindable = hunters.filter(
      (one) =>
        one.kind !== "gloamfin" &&
        (one.state === "chase" || apart(one, snapshot.forager) <= sensing),
    );
    if (
      snapshot.ink.ready &&
      now - this.lastInk > 1 &&
      pressure <= 5 &&
      blindable.length > 0
    ) {
      this.press(INK_KEY);
      this.lastInk = now;
      return;
    }

    // A pulse on a cadence, and again the moment something is close: it floods
    // the corridors, marks the hunters standing in them, and is heard by a
    // Gloamfin, which is the price of casting it.
    const due = pressure <= 6 ? 1.5 : this.style.sonarCadence;
    if (snapshot.sonar.ready && now - this.lastPulse >= due) {
      this.press(SONAR_KEY);
      this.lastPulse = now;
    }
  }

  /** The key to hold this frame, or `null` to rest. */
  private heading(
    snapshot: FathomSnapshot,
    route: Field,
    menace: (tx: number, ty: number) => number,
    here: Cell,
  ): string | null {
    const reverse = snapshot.forager.moving
      ? opposite(snapshot.forager.dir)
      : null;
    const drifters = new Set(
      snapshot.drifters.map((one) => cellIndex(one.tx, one.ty)),
    );

    const fleeing = menace(here.tx, here.ty) <= this.style.fleeAt;
    let best: { dir: Dir; score: number } | null = null;
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        const key = cellIndex(tx, ty);
        const steps = route.dist[key];
        if (steps <= 0 || steps > HORIZON) continue;
        const dir = route.first[key];
        if (dir === null) continue;
        const safety = menace(tx, ty);

        let value: number;
        if (fleeing) {
          // Flight: the furthest ground from the hunter that is reachable
          // soonest, and nothing about plankton at all.
          value = safety * 14 - steps * 4;
        } else {
          const drifter = drifters.has(key) && steps <= DRIFTER_REACH;
          const plankton = !this.grazed.has(key);
          if (!drifter && !plankton) continue;
          value = (drifter ? 320 : 14) - steps * 3;
          if (safety <= 3) value -= 220;
          else if (safety <= 5) value -= 40;
          else if (safety <= 7) value -= 12;
        }
        // Turning back costs the run of corridor already ahead, so a reversal
        // has to be worth something rather than being a tie-break.
        if (dir === reverse) value -= 26;
        if (best === null || value > best.score) best = { dir, score: value };
      }
    }
    return best === null ? null : DIR_KEY[best.dir];
  }
}

/* -------------------------------------------------------------------------- */
/* Keeping the winning take                                                   */
/* -------------------------------------------------------------------------- */

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

/**
 * Keep the media of take `winner` under the showcase's own output names and
 * delete every other take's.
 *
 * Each take is recorded as it runs, under outputs prefixed `take-<n>-`, because
 * a take opens on whatever trench the game laid out and cannot be run again.
 * Once the takes are judged, the winner's files lose the prefix and the rest
 * go. A no-op when nothing is collecting media.
 */
function keepTake(winner: number): void {
  const mediaDir = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (mediaDir === undefined || mediaDir === "") return;
  for (const file of walk(mediaDir)) {
    const match = /^take-(\d+)-(.+)$/.exec(basename(file));
    if (match === null) continue;
    if (Number(match[1]) === winner) {
      renameSync(file, join(dirname(file), match[2]));
    } else {
      rmSync(file);
    }
  }
}

/** The output id of take `n`'s `output`. */
function takeOutput(n: number, output: string): string {
  return `take-${n}-${output}`;
}

/* -------------------------------------------------------------------------- */
/* The stills                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The two stills the carousel carries, each kept as the best frame of the take
 * rather than the first that qualified.
 *
 * A still is written whenever the frame on the canvas scores higher than
 * anything before it, and the write overwrites the last one, so the file left at
 * the end is the best moment the dive actually offered. Both are judged on what
 * makes the picture read: the pulse still wants its crest well out into the
 * corridors rather than collapsed on the forager, and the window still wants the
 * widest circle the forager's brightness opened, with a hunter drawn inside it.
 */
function stillPicker(
  h: Harness,
  take: number,
): {
  sonar(snapshot: FathomSnapshot): void;
  window(snapshot: FathomSnapshot): void;
} {
  const best = new Map<string, number>();
  const offer = (id: string, score: number): void => {
    if (score <= (best.get(id) ?? 0)) return;
    best.set(id, score);
    captureStill(h, takeOutput(take, id));
  };
  return {
    sonar(snapshot) {
      let score = 0;
      for (const pulse of snapshot.pulses) {
        if (pulse.source !== "forager") continue;
        // Four steps out is the crest at its most legible: far enough to have
        // bent around the corners it is going to bend around, near enough that
        // the whole wavefront is still one shape.
        if (pulse.front < 2 || pulse.front > 7) continue;
        score = Math.max(
          score,
          6 - Math.abs(pulse.front - 4) + snapshot.brightness,
        );
      }
      offer("sonar", score);
    },
    window(snapshot) {
      // The widest window the dive opened, with a hunter drawn inside it far
      // enough off the forager that the two bodies read as two things, and the
      // circle standing clear of the trench's own top and bottom edges so it
      // reads as a circle rather than as a band cut off by the border.
      let company = 0;
      for (const one of snapshot.predators) {
        if (!one.lit) continue;
        const tiles = apart(one, snapshot.forager) / TILE;
        company = Math.max(company, tiles >= 2 && tiles <= 7 ? 6 : 3);
      }
      const { grid, forager } = snapshot;
      const clearance = Math.min(
        forager.y - grid.originY,
        grid.originY + grid.rows * grid.tile - forager.y,
      );
      const fit = Math.min(1, clearance / (snapshot.windowRadius ?? 1));
      offer("window", snapshot.brightness * 4 + company + fit * 8);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* One take                                                                   */
/* -------------------------------------------------------------------------- */

/** What a take turned out to be, which is what a take is judged on. */
interface Take {
  frames: number;
  plankton: number;
  drifters: number;
  pulses: number;
  pings: number;
  clouds: number;
  /** Distinct moments a hunter's body was drawn, having been out of sight. */
  sightings: number;
  /** Distinct moments a hunter opened a chase. */
  chases: number;
  /** Flarefish blooms that burned during the take, and charge-ups begun. */
  blooms: number;
  charges: number;
  /** Lives lost, which resets the board and stops the dive dead. */
  deaths: number;
  /** Draws made from the seeded sheets, so a take with no art is visible. */
  art: number;
  /** The longest stretch with nothing eaten, in seconds. */
  maxLull: number;
  /** Whether the take ended on the settled beat rather than running out. */
  endedOnBeat: boolean;
  score: number;
}

/** How watchable a take is: what happened, how steadily, and how it ended. */
function judge(take: Take): number {
  return (
    take.plankton * 0.7 +
    take.drifters * 30 +
    take.sightings * 7 +
    take.chases * 9 +
    take.blooms * 14 +
    take.pings * 3 +
    Math.min(take.pulses, 8) * 2 +
    (take.clouds > 0 ? 14 : -14) +
    (take.pulses > 0 ? 0 : -60) -
    take.maxLull * 5 -
    take.deaths * 30 +
    (take.endedOnBeat ? 14 : -14)
  );
}

let harness: Harness;
let host: HostGlobals;

beforeEach(async () => {
  // Stood up BEFORE the harness: the instance's `initialize` loads every sheet,
  // and `createHarness` awaits it.
  host = serveSeededAssets();
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
  restoreHost(host);
});

it("records a dive clip", async () => {
  const h = harness;

  // The three bounds on a take's length. The maze admits its first bonus
  // drifter `DRIFTER_INTERVAL` (25 s) into an attempt, so a clip that ends
  // before then can never show one being taken: past the minimum a take ends on
  // the first settled beat once a drifter HAS been taken, and only past the
  // quiet mark does a settled beat on its own end it.
  const minFrames = Math.round(
    Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "26") * TICK_HZ,
  );
  const quietFrames = Math.round(
    Number(process.env.TCAB_SHOWCASE_QUIET_SECONDS ?? "32") * TICK_HZ,
  );
  const maxFrames = Math.round(
    Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "35") * TICK_HZ,
  );
  /** How long the forager rests over its last pulse before the clip ends. */
  const settleFrames = Math.round(1.6 * TICK_HZ);

  /**
   * One take: back to the title on a fresh trench, DIVE confirmed with a real
   * key, the game's own countdown, and then the dive played out. Its stills are
   * written under the take's own prefix, so a later take does not write over
   * them.
   */
  const runTake = async (take: number, phase: number): Promise<Take> => {
    // A previous take can end mid-press. Clear the real keyboard so nothing
    // leaks into the next take.
    for (const key of [
      ...Object.values(DIR_KEY),
      SONAR_KEY,
      INK_KEY,
      "Enter",
    ]) {
      h.release(key);
    }
    h.debug.reset();
    await h.advance(1);

    const stats: Take = {
      frames: 1,
      plankton: 0,
      drifters: 0,
      pulses: 0,
      pings: 0,
      clouds: 0,
      sightings: 0,
      chases: 0,
      blooms: 0,
      charges: 0,
      deaths: 0,
      art: 0,
      maxLull: 0,
      endedOnBeat: false,
      score: 0,
    };

    // The title card, read for half a second before DIVE is confirmed.
    const titleFrames = Math.round(0.5 * TICK_HZ);
    await h.advance(titleFrames);
    stats.frames += titleFrames;
    h.hold("Enter");
    h.release("Enter");
    await h.advance(1);
    stats.frames += 1;

    const opening = h.snapshot();
    const diver = new Diver(h, opening.tiles, STYLES[phase % STYLES.length]);

    let previous = opening;
    let lastEatFrame = stats.frames;
    let endAt = Infinity;
    const stills = stillPicker(h, take);
    const seen = new Set<number>();
    const chasing = new Set<number>();
    const blooming = new Set<number>();
    const charging = new Set<number>();

    while (stats.frames < maxFrames && stats.frames < endAt) {
      const snapshot = h.snapshot();
      if (endAt === Infinity) diver.step(snapshot);
      else diver.rest();
      await h.advance(1);
      stats.frames += 1;
      const now = h.snapshot();
      stats.art += callsTo(h.calls, "drawImage").length;
      // The harness keeps every draw call and every cue the run made, which is
      // the right thing for a check that inspects a few hundred frames and the
      // wrong thing for a driver that runs tens of thousands: dropped here, the
      // audition costs a constant amount of memory.
      h.calls.length = 0;
      h.cues.length = 0;

      // What happened between the two reads.
      if (now.planktonRemaining < previous.planktonRemaining) {
        stats.plankton += previous.planktonRemaining - now.planktonRemaining;
        lastEatFrame = stats.frames;
      }
      if (now.drifters.length < previous.drifters.length) {
        stats.drifters += previous.drifters.length - now.drifters.length;
        lastEatFrame = stats.frames;
      }
      if (now.lives < previous.lives) stats.deaths += 1;
      stats.pulses += started(previous, now, "forager");
      stats.pings += started(previous, now, "gloamfin");
      if (now.inkClouds.length > previous.inkClouds.length) stats.clouds += 1;
      for (const [index, one] of now.predators.entries()) {
        // A sighting is a body coming into view, counted once until it goes
        // back out of it, so a hunter swimming through the light is one moment.
        if (one.lit && !seen.has(index)) stats.sightings += 1;
        if (one.lit) seen.add(index);
        else seen.delete(index);
        if (one.state === "chase" && !chasing.has(index)) stats.chases += 1;
        if (one.state === "chase") chasing.add(index);
        else chasing.delete(index);
        if (one.flaring === true && !blooming.has(index)) stats.blooms += 1;
        if (one.flaring === true) blooming.add(index);
        else blooming.delete(index);
        if (one.flareCharging === true && !charging.has(index)) {
          stats.charges += 1;
        }
        if (one.flareCharging === true) charging.add(index);
        else charging.delete(index);
      }
      stats.maxLull = Math.max(
        stats.maxLull,
        (stats.frames - lastEatFrame) / TICK_HZ,
      );

      {
        // The two stills, taken from this very take and kept as the best frame
        // the take offered rather than the first one that qualified: a still is
        // rewritten whenever a better candidate comes along, so what survives is
        // the pulse furthest down the corridors and the widest window a hunter
        // was drawn inside.
        //
        // Only the back two thirds of the take are offered. The opening of a
        // dive is the same corridor whatever the trench — nothing is out of the
        // den yet and the trench is barely mapped — and a still of it says less
        // about the game than the same shot taken once the map has opened up.
        if (stats.frames > maxFrames * 0.35) {
          stills.sonar(now);
          stills.window(now);
        }
        if (
          process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
          stats.frames % Math.round(TICK_HZ * 2) === 0
        ) {
          const at = Math.round(stats.frames / (TICK_HZ * 2));
          captureStill(
            h,
            takeOutput(take, `qa-${String(at).padStart(2, "0")}`),
          );
        }
      }

      // The ending: past the minimum, on a beat where nothing is closing, the
      // forager casts one last pulse, comes to rest, and the clip holds while
      // the wavefront runs out through the corridors.
      if (
        endAt === Infinity &&
        stats.frames >= minFrames &&
        (stats.drifters > 0 || stats.frames >= quietFrames) &&
        stats.frames + settleFrames <= maxFrames &&
        now.screen === "playing" &&
        now.sonar.ready &&
        loose(now).every(
          (one) => one.state !== "chase" && apart(one, now.forager) > 8 * TILE,
        )
      ) {
        h.hold(SONAR_KEY);
        h.release(SONAR_KEY);
        endAt = stats.frames + settleFrames;
        stats.endedOnBeat = true;
      }
      previous = now;
    }

    diver.rest();
    stats.score = judge(stats);
    return stats;
  };

  /** Record one take whole, as the recording the showcase keeps if it wins. */
  const recordTake = (take: number, phase: number): Promise<Take> =>
    captureReplay(h, takeOutput(take, "dive"), () => runTake(take, phase));

  // `TCAB_SHOWCASE_TAKE=<phase>` records one take of that style and auditions
  // nothing; otherwise `TCAB_SHOWCASE_TAKES` takes of every style are recorded
  // and judged, and the winner is the one kept.
  const named = process.env.TCAB_SHOWCASE_TAKE;
  const candidates: number[] = [];
  if (named !== undefined && named !== "") {
    candidates.push(Number(named));
  } else {
    const perStyle = Number(process.env.TCAB_SHOWCASE_TAKES ?? "4");
    for (let n = 0; n < perStyle; n += 1) {
      for (const phase of [0, 1, 2]) candidates.push(phase);
    }
  }

  let best: { take: number; phase: number; score: number; stats: Take } | null =
    null;
  for (const [index, phase] of candidates.entries()) {
    const take = index + 1;
    const stats = await recordTake(take, phase);
    console.log(
      `take ${take} phase=${phase}: ${(stats.frames / TICK_HZ).toFixed(1)}s, ` +
        `${stats.plankton} plankton, ${stats.drifters} drifters, ` +
        `${stats.pulses} pulses, ${stats.pings} pings, ${stats.clouds} clouds, ` +
        `${stats.sightings} sightings, ${stats.chases} chases, ` +
        `${stats.blooms} blooms (${stats.charges} charges), ` +
        `${stats.deaths} deaths, ${stats.art} art draws, ` +
        `lull ${stats.maxLull.toFixed(1)}s, ` +
        `${stats.endedOnBeat ? "settled" : "ran out"} -> ${stats.score.toFixed(0)}`,
    );
    if (best === null || stats.score > best.score) {
      best = { take, phase, score: stats.score, stats };
    }
  }

  const winner = best as {
    take: number;
    phase: number;
    score: number;
    stats: Take;
  };
  console.log(`keeping take ${winner.take} phase=${winner.phase}`);
  keepTake(winner.take);
  console.log(
    JSON.stringify(
      {
        take: winner.take,
        phase: winner.phase,
        seconds: winner.stats.frames / TICK_HZ,
        ...winner.stats,
      },
      null,
      2,
    ),
  );
}, 1_800_000);
