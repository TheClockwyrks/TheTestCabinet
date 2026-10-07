// presentation/provided-art — the seeded sheets are what the game draws its
// creatures, its flare and its trench from.
//
// `specs/assets.md` seeds seven sheets under `assets/` and states that "the build
// renders each of those elements from its sheet", at the frame sizes that file
// tabulates; `specs/overview.md` makes it a hard requirement — "the creatures,
// the maze tiles, and the flare from the art seeded under `assets/`". A build
// that draws convincing shapes in code satisfies every other point in this suite
// and misses this one, which is the whole reason the point exists.
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` of one frame is captured with the bitmap it was handed, that bitmap
// is rasterized, and its pixels are held against the seeded PNGs read off the
// same tree the build was seeded with. A source that IS a seeded frame matches it
// exactly; anything else — a canvas the build painted, a sheet of its own, a
// recolored copy — does not. The comparison is made on premultiplied channels, so
// the one lossy step in getting a bitmap back out of a canvas cannot separate a
// frame from itself.
//
// EACH ELEMENT IS NAMED BY WHERE IT WAS DRAWN. A draw is attributed to the
// creature whose reported center its destination box is centered on, so the point
// says "the Gloamfin was drawn from the Gloamfin's sheet" rather than "some sheet
// was drawn somewhere". Every body in the scene is posed on a tile center, so the
// two coincide exactly and half a tile of tolerance is generous.
//
// THE ONE AMBIGUITY IS IN THE ART. `specs/assets.md` makes the Lanternjaw's
// disguise frames "the same art as `assets/drifter/` frames 0 to 7, pixel for
// pixel", so a match on one of those cannot say which of the two sheets a build
// reached for, and neither can a reviewer. Both are therefore allowed either
// name. What the scenario still does is read the Lanternjaw in `"chase"`, which
// that file draws from frames 0 to 7 — art no other sheet carries — so on a build
// that draws what the specification asks the reading is exact. A build that wore
// the disguise while hunting has drawn from the Lanternjaw's own sheet either
// way, and this point is about the sheet rather than about which frame of it.
//
// THE SCENE IS BUILT AROUND THE FLARE, because the flare-bloom sheet is drawn
// only while one burns. Nothing on this board is posed with a faculty this point
// does not read: the Flarefish keeps its MIND, because the bloom is its own
// cadence running, and the other three creatures are props posed with neither.
// Every one of the four is then a body standing exactly where the fixture put it,
// which is what a sheet is read off. All four sit inside `FLARE_RADIUS` of the
// Flarefish, so the bloom draws every one of them live (`specs/sensing.md`), and
// the forager waits fourteen tiles off, past the bloom's own reach, so the flare
// cannot lock onto it and cut itself short.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLength, assertTrue } from "../assert";
import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TILE,
} from "../constants";
import { poseMaze, spawnDrifter, spawnPredator } from "../fixtures";
import {
  REPLAY_BACKGROUND,
  captureStill,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/* -------------------------------------------------------------------------- */
/* The seeded sheets                                                          */
/* -------------------------------------------------------------------------- */

/** Every sheet `specs/assets.md` seeds: its folder, its frames, its frame size. */
const SHEETS = {
  glimmerfin: { folder: "glimmerfin", frames: 8, size: 32 },
  lanternjaw: { folder: "lanternjaw", frames: 16, size: 32 },
  gloamfin: { folder: "gloamfin", frames: 8, size: 32 },
  flarefish: { folder: "flarefish", frames: 8, size: 32 },
  drifter: { folder: "drifter", frames: 8, size: 32 },
  "flare-bloom": { folder: "flare-bloom", frames: 8, size: 128 },
  "trench-walls": { folder: "trench-walls", frames: 19, size: 32 },
} as const;

type SheetName = keyof typeof SHEETS;

/** The wall autotile, and the corridor floor, of `assets/trench-walls/`. */
const TRENCH_WALL_FRAMES = 16;
const TRENCH_FLOOR_FRAME = 16;

/**
 * The workspace this suite is staged into, which is where `assets/` sits.
 *
 * Taken from this module's own URL, exactly as the harness takes the project
 * root, so the seeded art is read from the tree the build was handed.
 */
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * How far a drawn source's pixels may sit from a seeded frame's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is identity — the source IS the seeded frame — so this is not a
 * likeness tolerance. It is room for the one lossy step in reading a bitmap back
 * out of a canvas: a partially transparent pixel is premultiplied on the way in
 * and un-premultiplied on the way out, so it can shift by a unit. Comparing on
 * premultiplied channels removes even that, and a different frame of the SAME
 * sheet measures seven or more here.
 */
const MATCH_MAX = 1;

/** How far a draw's destination center may sit from the body it is drawn on. */
const PLACED_MAX = TILE / 2;

/**
 * The longest the scenario waits for a bloom, in ticks.
 *
 * Two whole flare cycles. `specs/predators/flarefish.md` runs the flare timer
 * "only while the Flarefish is wandering with no flare in progress" and puts
 * consecutive charge-ups `FLARE_INTERVAL + FLARE_CHARGE + FLARE_BLOOM` (`8.5 s`)
 * apart, so a wandering Flarefish blooms inside one cycle and this is a hard
 * ceiling rather than an open wait: a build whose flare never comes fails here
 * instead of running until the suite times out.
 */
const BLOOM_DEADLINE_TICKS = Math.ceil(
  2 * (FLARE_INTERVAL + FLARE_CHARGE + FLARE_BLOOM) * TICK_HZ,
);

/** How often the wait looks, in ticks: well inside the `FLARE_BLOOM` window. */
const BLOOM_POLL_TICKS = 6;

/**
 * The board: a six-tile corridor for the forager away to the right, a row of
 * solid rock, and four single-tile pockets sealed in on all four sides.
 *
 * `X` holds the Flarefish; `L`, `G` and `D` hold the Lanternjaw, the Gloamfin and
 * the drifter, four, two and two tiles from it, all well inside `FLARE_RADIUS`
 * (`192`, six tiles) so the bloom draws every one of them.
 *
 * EVERY TILE THE FORAGER CAN BE ON IS PAST THE BLOOM'S REACH. It stands fourteen
 * tiles from `X` at the very nearest — `448` logical units against
 * `FLARE_RADIUS`'s `192` — so the flare cannot lock onto it and cut its own bloom
 * short. That holds of the corridor's whole run, the first corridor tile in
 * reading order included, which is where `setMaze` rests the forager before this
 * scenario places it: the scene stays the scene it describes whether or not the
 * pose lands, and a `setForagerTile` that did nothing is
 * instrumentation/surface-present's verdict rather than a flare that never came.
 * The same distance is far past the Flarefish's and the Lanternjaw's `128`-unit
 * light range at the `G` of `0` this scenario holds.
 */
const ART = [
  "###################.....F",
  "#########################",
  "#L#G#X#D#################",
] as const;

/* -------------------------------------------------------------------------- */
/* Matching a drawn source against the seeded frames                          */
/* -------------------------------------------------------------------------- */

/** One seeded frame, as the comparison reads it. */
interface Frame {
  sheet: SheetName;
  index: number;
  size: number;
  pixels: Float64Array;
}

/**
 * A drawable source's premultiplied RGBA channels.
 *
 * Premultiplied, because that is what survives a round trip through a canvas
 * intact: drawing a bitmap in multiplies each channel by the pixel's alpha and
 * reading it back divides again, so a partially transparent pixel is quantized
 * twice. Comparing the products compares what both sides actually hold.
 */
function channelsOf(source: { width: number; height: number }): Float64Array {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, source.width, source.height);
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the two decoders it comes
  // from do not share a nominal type.
  ctx.drawImage(source as never, 0, 0);
  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    out[i] = (data[i] * alpha) / 255;
    out[i + 1] = (data[i + 1] * alpha) / 255;
    out[i + 2] = (data[i + 2] * alpha) / 255;
    out[i + 3] = alpha;
  }
  return out;
}

/** The mean absolute difference between two channel buffers, out of 255. */
function difference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Every seeded frame of every sheet, read off the workspace's own `assets/`. */
async function readSeededFrames(): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const [sheet, spec] of Object.entries(SHEETS)) {
    for (let index = 0; index < spec.frames; index += 1) {
      const image = await loadImage(
        join(WORKSPACE, "assets", spec.folder, `${index}.png`),
      );
      frames.push({
        sheet: sheet as SheetName,
        index,
        size: spec.size,
        pixels: channelsOf(image),
      });
    }
  }
  return frames;
}

/** Every seeded frame a drawn source is pixel-for-pixel identical to. */
function seededMatches(frames: readonly Frame[], drawn: Float64Array): Frame[] {
  return frames.filter(
    (frame) =>
      frame.pixels.length === drawn.length &&
      difference(frame.pixels, drawn) <= MATCH_MAX,
  );
}

/** One `drawImage` of the captured frame, as this point reads it. */
interface Blit {
  /** Where the destination box is centered, in logical units. */
  x: number;
  y: number;
  /** The seeded frames its source is identical to, empty when it is none of them. */
  matches: Frame[];
}

/**
 * Where a `drawImage` put its destination box's center, from the argument form it
 * was called in and the source's own size.
 */
function destination(
  args: readonly unknown[],
  width: number,
  height: number,
): { x: number; y: number } {
  const at = (index: number): number => Number(args[index]);
  if (args.length >= 9) {
    return { x: at(5) + at(7) / 2, y: at(6) + at(8) / 2 };
  }
  if (args.length >= 5) {
    return { x: at(1) + at(3) / 2, y: at(2) + at(4) / 2 };
  }
  return { x: at(1) + width / 2, y: at(2) + height / 2 };
}

/** Every blit near `(x, y)` whose source is a frame of `sheet`. */
function drawnFrom(
  blits: readonly Blit[],
  sheet: SheetName,
  at: { x: number; y: number },
): Blit[] {
  return blits.filter(
    (blit) =>
      Math.hypot(blit.x - at.x, blit.y - at.y) <= PLACED_MAX &&
      blit.matches.some((frame) => frame.sheet === sheet),
  );
}

/* -------------------------------------------------------------------------- */
/* The recorded frame                                                         */
/* -------------------------------------------------------------------------- */

/** As much of the injected recorder as this point drives. */
interface Recorder {
  arm(design: { width: number; height: number; background: string }): boolean;
  disarm(): {
    images: { width: number; height: number; src?: string }[];
    ops: { op: string; method?: string; args?: unknown[] }[];
    frames: { ops: number[] }[];
  } | null;
}

/**
 * Run one tick and hand back every `drawImage` it issued, with the bitmap each
 * one was handed.
 *
 * WHY THE RECORDER RATHER THAN `frameCalls`. An engineless build owns its whole
 * asset pipeline, so the only place the identity of a drawn bitmap exists is
 * inside the page. `frameCalls` deliberately names a bitmap by its type alone,
 * because it has to read the same whether or not a capture is running; the
 * recorder the harness injects captures the bitmap's own pixels, which is exactly
 * what this point has to compare. It is armed around a single tick and disarmed
 * again, so nothing else in this suite is affected.
 */
async function blitsOfOneTick(
  h: Harness,
  frames: readonly Frame[],
): Promise<Blit[]> {
  await h.page.evaluate(
    (design) =>
      (window as unknown as { __tcabRec: Recorder }).__tcabRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  await h.advance(1);
  const recording = (await h.page.evaluate(() =>
    (window as unknown as { __tcabRec: Recorder }).__tcabRec.disarm(),
  )) as ReturnType<Recorder["disarm"]>;

  const blits: Blit[] = [];
  if (recording === null || recording.frames.length === 0) return blits;
  const channels = new Map<number, Float64Array>();
  for (const index of recording.frames[recording.frames.length - 1].ops) {
    const op = recording.ops[index];
    if (op.op !== "call" || op.method !== "drawImage") continue;
    const args = op.args ?? [];
    const source = args[0] as { $img?: number } | undefined;
    if (source === undefined || typeof source.$img !== "number") continue;
    const image = recording.images[source.$img];
    if (image === undefined || image.src === undefined) continue;
    let drawn = channels.get(source.$img);
    if (drawn === undefined) {
      drawn = channelsOf(await loadImage(image.src));
      channels.set(source.$img, drawn);
    }
    const at = destination(args, image.width, image.height);
    blits.push({ ...at, matches: seededMatches(frames, drawn) });
  }
  return blits;
}

/* -------------------------------------------------------------------------- */
/* The point                                                                  */
/* -------------------------------------------------------------------------- */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every element from its own seeded sheet", async () => {
  const seeded = await readSeededFrames();

  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  await parkForager(h, home);

  // One of each hunter: this point reads the sheet every element is drawn from,
  // so all three kinds have to be on the canvas at once. The two whose behavior
  // this point is not about are posed with their minds off, so they hold the tile
  // they are put on because nothing is deciding for them. The Flarefish keeps its
  // mind — the bloom this scene is built around is its own cadence running — and
  // has its travel held instead, so the disc burns from the tile the fixture
  // stood it on.
  const lanternjaw = await spawnPredator(h, "lanternjaw", board.mark("L"), {
    state: "wander",
    mind: false,
  });
  const gloamfin = await spawnPredator(h, "gloamfin", board.mark("G"), {
    state: "wander",
    mind: false,
  });
  const flarefish = await spawnPredator(h, "flarefish", board.mark("X"), {
    state: "wander",
    travel: false,
  });
  await spawnDrifter(h, board.mark("D"), { mind: false });
  const guard = await sceneGuard(h);

  // Wait for the bloom on the build's own cadence, off camera, under a hard
  // ceiling. `skipUntil` runs the same real ticks without closing a frame.
  const bloom = await h.skipUntil(
    (snap) => snap.predators[flarefish]?.flaring === true,
    { maxTicks: BLOOM_DEADLINE_TICKS, poll: BLOOM_POLL_TICKS },
  );
  assertTrue(
    bloom.hit,
    `a Flarefish bloom within ${BLOOM_DEADLINE_TICKS} ticks of being posed into ` +
      `"wander", which specs/predators/flarefish.md puts at most ` +
      `${FLARE_INTERVAL + FLARE_CHARGE} s away — the flare-bloom sheet is drawn ` +
      `only while one burns`,
  );

  // Read in "chase", whose frames no other sheet carries, so on a build that
  // draws what `specs/assets.md` asks the match below is unambiguous. Its mind is
  // off, so the pose moves it nowhere.
  await h.debug.setPredatorState(lanternjaw, "chase");

  const blits = await blitsOfOneTick(h, seeded);
  const snap = await h.snapshot();
  // Before the assertions, so a failing check still leaves the picture of the
  // frame whose draws were read.
  await captureStill(h, "art");

  requireSceneHeld(snap, guard);

  const at = (index: number): { x: number; y: number } => ({
    x: snap.predators[index].x,
    y: snap.predators[index].y,
  });

  // THE BLOOM HAS TO HAVE DRAWN THEM. `specs/predators.md` draws a predator's
  // body "only while it is lit this instant", and the whole scene is lit by the
  // one bloom, so a build whose disc lights nothing puts no body on the canvas
  // and there is no sheet for this point to read.
  const unlit = [lanternjaw, gloamfin, flarefish]
    .filter((index) => snap.predators[index]?.lit !== true)
    .map((index) => snap.predators[index].kind);
  assertLength(
    unlit,
    0,
    "hunters standing inside the burning bloom that reported `lit` false — a " +
      "bloom lights every tile of its disc (specs/predators/flarefish.md), and " +
      "a drawn body is what this point reads a sheet off" +
      (unlit.length > 0 ? ` — the ${unlit.join(" and ")}` : ""),
  );

  assertTrue(
    drawnFrom(blits, "glimmerfin", snap.forager).length > 0,
    `the forager, at (${snap.forager.x}, ${snap.forager.y}), drawn from a ` +
      `32 x 32 frame of assets/glimmerfin/ (specs/assets.md)`,
  );
  assertTrue(
    drawnFrom(blits, "lanternjaw", at(lanternjaw)).length > 0,
    `the Lanternjaw, at (${at(lanternjaw).x}, ` +
      `${at(lanternjaw).y}), drawn from a 32 x 32 frame of ` +
      `assets/lanternjaw/ (specs/assets.md)`,
  );
  assertTrue(
    drawnFrom(blits, "gloamfin", at(gloamfin)).length > 0,
    `the Gloamfin, at (${at(gloamfin).x}, ` +
      `${at(gloamfin).y}), drawn from a 32 x 32 frame of ` +
      `assets/gloamfin/ (specs/assets.md)`,
  );
  assertTrue(
    drawnFrom(blits, "flarefish", at(flarefish)).length > 0,
    `the Flarefish, at (${at(flarefish).x}, ` +
      `${at(flarefish).y}), drawn from a 32 x 32 frame of ` +
      `assets/flarefish/ (specs/assets.md)`,
  );
  assertTrue(
    drawnFrom(blits, "flare-bloom", at(flarefish)).length > 0,
    `the burning flare, centered on the Flarefish at ` +
      `(${at(flarefish).x}, ${at(flarefish).y}), drawn from ` +
      `a 128 x 128 frame of assets/flare-bloom/ (specs/assets.md); its lit ` +
      `radius is FLARE_RADIUS (${FLARE_RADIUS})`,
  );
  const drifter = snap.drifters[0];
  assertTrue(
    drifter !== undefined && drawnFrom(blits, "drifter", drifter).length > 0,
    `the bonus drifter, at (${drifter?.x}, ${drifter?.y}), drawn from a 32 x 32 ` +
      `frame of assets/drifter/ — which specs/assets.md makes the same pixels as ` +
      `the Lanternjaw's disguise frames, so either name satisfies it`,
  );

  // And the trench itself: rock from the wall autotile, corridor from the floor
  // frame (specs/assets.md).
  assertTrue(
    blits.some((blit) =>
      blit.matches.some(
        (frame) =>
          frame.sheet === "trench-walls" && frame.index < TRENCH_WALL_FRAMES,
      ),
    ),
    "at least one rock tile drawn from the sixteen-frame wall autotile of " +
      "assets/trench-walls/ (specs/assets.md)",
  );
  assertTrue(
    blits.some((blit) =>
      blit.matches.some(
        (frame) =>
          frame.sheet === "trench-walls" && frame.index === TRENCH_FLOOR_FRAME,
      ),
    ),
    `at least one open tile drawn from frame ${TRENCH_FLOOR_FRAME} of ` +
      `assets/trench-walls/, the corridor floor (specs/assets.md)`,
  );
});
