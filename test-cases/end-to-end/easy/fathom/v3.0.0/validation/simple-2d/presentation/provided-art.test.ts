// presentation/provided-art — the seeded sheets are what the game draws its
// creatures, its flare and its trench from.
//
// specs/assets.md seeds seven sheets under `assets/` and states that "the build
// renders each of those elements from its sheet", at the frame sizes that file
// tabulates; specs/overview.md makes it a hard requirement — "the creatures, the
// maze tiles, and the flare from the art seeded under `assets/`". A build that
// draws convincing shapes in code satisfies every other point in this suite and
// misses this one, which is the whole reason the point exists.
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
// THE ONE AMBIGUITY IS IN THE ART. specs/assets.md makes the Lanternjaw's
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
// only while one burns. The three hunters and the drifter each stand on a single
// corridor tile boxed in by rock, so none of them can travel
// (specs/predators.md: "A predator standing on a tile with no open neighbor stays
// on that tile"), and all four sit inside `FLARE_RADIUS` of the Flarefish, so the
// bloom draws every one of them live (specs/sensing.md). The forager waits fourteen
// tiles off, past the bloom's own reach, so the flare cannot lock onto it and cut
// itself short.
//
// THE SEEDED TREE IS SERVED TO THE ENGINE'S LOADER. specs/assets.md has the build
// load every frame through the engine, which resolves each path under `assets/`
// "relative to the page the build is served from" and fetches it. This suite runs
// in a Node process with no page, so nothing resolves that relative URL unless
// something here does: the two globals the loader reaches for are stood up over
// the workspace's own `assets/` directory for the life of this file, and put back
// afterwards. That is the same kind of thing the harness's own canvas, surface
// metrics and clock are — the host the engine runs on — and without it the build
// is asked to draw from art no one gave it.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  TICK_HZ,
  TILE,
} from "../../src/constants";
import { assertTrue } from "../assert";
import { poseMaze } from "../fixtures";
import {
  callsTo,
  captureStill,
  createHarness,
  startPlaying,
  type DrawCall,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  graded,
  parkForager,
  requirePred,
  requireSceneHeld,
  sceneGuard,
  unmetPrecondition,
} from "../scene";

/* -------------------------------------------------------------------------- */
/* The seeded sheets                                                          */
/* -------------------------------------------------------------------------- */

/** Every sheet specs/assets.md seeds: its folder, its frames, its frame size. */
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
 * Two whole flare cycles. specs/predators/flarefish.md runs the flare timer "only
 * while the Flarefish is wandering with no flare in progress" and puts
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
/* Serving the seeded tree to the engine's loader                             */
/* -------------------------------------------------------------------------- */

/** What the loader reaches for, as it stood before this file replaced it. */
interface HostGlobals {
  fetch: unknown;
  createImageBitmap: unknown;
}

/** Stand the two globals up over the workspace's own `assets/` directory. */
function serveSeededAssets(): HostGlobals {
  const host = globalThis as unknown as Record<string, unknown>;
  const before: HostGlobals = {
    fetch: host.fetch,
    createImageBitmap: host.createImageBitmap,
  };
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(WORKSPACE, url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
  return before;
}

/** Put them back, so nothing this file did outlives it. */
function restoreHost(before: HostGlobals): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.fetch = before.fetch;
  host.createImageBitmap = before.createImageBitmap;
}

/* -------------------------------------------------------------------------- */
/* Matching a drawn source against the seeded frames                          */
/* -------------------------------------------------------------------------- */

/** One seeded frame, as the comparison reads it. */
interface Frame {
  sheet: SheetName;
  index: number;
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
  // The cast is the one this comparison needs: everything handed here is a bitmap
  // this canvas implementation can blit, and the decoders it comes from do not
  // share a nominal type.
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

/** Every `drawImage` of one recorded frame, resolved against the seeded art. */
function blitsOf(calls: readonly DrawCall[], frames: readonly Frame[]): Blit[] {
  const channels = new Map<object, Float64Array>();
  const blits: Blit[] = [];
  for (const args of callsTo(calls, "drawImage")) {
    const source = args[0] as { width?: number; height?: number } | null;
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.width !== "number" ||
      typeof source.height !== "number"
    ) {
      continue;
    }
    let drawn = channels.get(source as object);
    if (drawn === undefined) {
      drawn = channelsOf(source as { width: number; height: number });
      channels.set(source as object, drawn);
    }
    const at = destination(args, source.width, source.height);
    blits.push({ ...at, matches: seededMatches(frames, drawn) });
  }
  return blits;
}

/* -------------------------------------------------------------------------- */
/* The point                                                                  */
/* -------------------------------------------------------------------------- */

let h: Harness;
let host: HostGlobals;

beforeEach(async () => {
  host = serveSeededAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  restoreHost(host);
});

it("draws every element from its own seeded sheet", async (ctx) => {
  await graded(ctx, async () => {
    const seeded = await readSeededFrames();

    await startPlaying(h);
    const board = await poseMaze(h, ART);
    const home = board.mark("F");
    await parkForager(h, home);
    // The pellet under the forager, eaten off camera with `G` put back to the
    // zero a dive opens on, so the hunters' light ranges stay at their `G = 0`
    // figures and none of them senses the forager across the rock.
    await clearUnderfoot(h);

    const roster = h.snapshot();
    const lanternjaw = requirePred(roster, "lanternjaw");
    const gloamfin = requirePred(roster, "gloamfin");
    const flarefish = requirePred(roster, "flarefish");
    for (const [index, letter] of [
      [lanternjaw, "L"],
      [gloamfin, "G"],
      [flarefish, "X"],
    ] as const) {
      const pocket = board.mark(letter);
      h.debug.setPredatorTile(index, pocket.tx, pocket.ty);
      h.debug.setPredatorState(index, "wander");
    }
    const drop = board.mark("D");
    h.debug.spawnDrifter(drop.tx, drop.ty);
    const watch = await sceneGuard(h);

    // Wait for the bloom on the build's own cadence, under a hard ceiling.
    const bloom = await h.until(
      (snap) => snap.predators[flarefish]?.flaring === true,
      { maxFrames: BLOOM_DEADLINE_TICKS, poll: BLOOM_POLL_TICKS },
    );
    assertTrue(
      bloom.hit,
      `a Flarefish bloom within ${BLOOM_DEADLINE_TICKS} ticks of being posed ` +
        `into "wander", which specs/predators/flarefish.md puts at most ` +
        `${FLARE_INTERVAL + FLARE_CHARGE} s away — the flare-bloom sheet is ` +
        `drawn only while one burns`,
    );

    // Read in "chase", whose frames no other sheet carries, so on a build that
    // draws what specs/assets.md asks the match below is unambiguous. It is boxed
    // in by rock, so the pose moves it nowhere.
    h.debug.setPredatorState(lanternjaw, "chase");

    // One frame, read on its own: everything before it is cleared away so the
    // draws below are the draws of exactly the frame the still shows.
    h.calls.length = 0;
    await h.advance(1);
    const blits = blitsOf(h.calls, seeded);
    const snap = h.snapshot();
    // Before the assertions, so a failing check still leaves the picture of the
    // frame whose draws were read.
    captureStill(h, "art");

    requireSceneHeld(snap, watch);

    // Each hunter is drawn only while something lights it (specs/sensing.md),
    // and out here in the dark that something is the bloom, so a build whose
    // flare reveals nothing leaves this scenario with no bodies on screen to
    // read a sheet off.
    const dark = (
      [
        ["Lanternjaw", lanternjaw],
        ["Gloamfin", gloamfin],
        ["Flarefish", flarefish],
      ] as const
    ).filter(([, index]) => snap.predators[index]?.lit !== true);
    if (dark.length > 0) {
      unmetPrecondition(
        `the ${dark.map(([name]) => name).join(" and ")} stood inside the ` +
          `FLARE_RADIUS (${FLARE_RADIUS}) of a burning bloom and still reported ` +
          "lit false, so no body was drawn for this point to read a sheet off; " +
          "what a bloom lights is flarefish/flare-reveals's verdict, not this " +
          "one's",
      );
    }

    const at = (index: number): { x: number; y: number } => ({
      x: snap.predators[index].x,
      y: snap.predators[index].y,
    });

    assertTrue(
      drawnFrom(blits, "glimmerfin", snap.forager).length > 0,
      `the forager, at (${snap.forager.x}, ${snap.forager.y}), drawn from a ` +
        `32 x 32 frame of assets/glimmerfin/ (specs/assets.md)`,
    );
    assertTrue(
      drawnFrom(blits, "lanternjaw", at(lanternjaw)).length > 0,
      `the Lanternjaw, at (${at(lanternjaw).x}, ${at(lanternjaw).y}), drawn ` +
        `from a 32 x 32 frame of assets/lanternjaw/ (specs/assets.md)`,
    );
    assertTrue(
      drawnFrom(blits, "gloamfin", at(gloamfin)).length > 0,
      `the Gloamfin, at (${at(gloamfin).x}, ${at(gloamfin).y}), drawn from a ` +
        `32 x 32 frame of assets/gloamfin/ (specs/assets.md)`,
    );
    assertTrue(
      drawnFrom(blits, "flarefish", at(flarefish)).length > 0,
      `the Flarefish, at (${at(flarefish).x}, ${at(flarefish).y}), drawn from ` +
        `a 32 x 32 frame of assets/flarefish/ (specs/assets.md)`,
    );
    assertTrue(
      drawnFrom(blits, "flare-bloom", at(flarefish)).length > 0,
      `the burning flare, centered on the Flarefish at (${at(flarefish).x}, ` +
        `${at(flarefish).y}), drawn from a 128 x 128 frame of ` +
        `assets/flare-bloom/ (specs/assets.md); its lit radius is FLARE_RADIUS ` +
        `(${FLARE_RADIUS})`,
    );
    const drifter = snap.drifters[0];
    assertTrue(
      drifter !== undefined && drawnFrom(blits, "drifter", drifter).length > 0,
      `the bonus drifter, at (${drifter?.x}, ${drifter?.y}), drawn from a ` +
        `32 x 32 frame of assets/drifter/ — which specs/assets.md makes the ` +
        `same pixels as the Lanternjaw's disguise frames, so either name ` +
        `satisfies it`,
    );

    // And the trench itself: rock from the wall autotile, corridor from the
    // floor frame (specs/assets.md).
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
            frame.sheet === "trench-walls" &&
            frame.index === TRENCH_FLOOR_FRAME,
        ),
      ),
      `at least one open tile drawn from frame ${TRENCH_FLOOR_FRAME} of ` +
        `assets/trench-walls/, the corridor floor (specs/assets.md)`,
    );
  });
});
