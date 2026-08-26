/**
 * The differential pixel-parity suite: an engine's recorder against this player,
 * over real pixels.
 *
 * Two engines write recording format 1 — `@test-cabinet/simple-2d` and
 * `@test-cabinet/structured-2d` — and both are replayed by this one player, so
 * both carry the same drift risk against the hand-maintained copy in
 * `format.ts`. The whole suite lives here, parameterized over the one thing
 * that differs between them: how a recorder is constructed. Each engine gets a
 * thin `*.test.ts` beside this module that binds
 * {@link describeRecordingParity} to its `ContextRecorder`; everything else —
 * the rig, the named scenarios, the generator and every assertion — is
 * engine-agnostic because the format is.
 *
 * Everything else in this directory tests the player against documents written by
 * hand. That is the right way to test how a damaged document is refused, and it is
 * worth nothing at all for the question this file exists to answer: **does the
 * picture come back?** Three rounds of review found defects that every hand-written
 * test agreed were fine — a clip replayed as a path, a gradient replayed under the
 * stops it no longer had, a pattern replayed from a repainted source, a save stack
 * that leaked into the next frame — and each of them was a visible difference in
 * the pixels with the frame reporting `skipped: 0`. A replay that lies quietly is
 * the one failure this format exists to remove, and only a comparison of the
 * surfaces can see it.
 *
 * So each scenario below runs the same drawing script twice and replays it twice:
 *
 * 1. through the engine recorder's wrapper, which is what produces the
 *    recording, keeping the surface at the end of every frame;
 * 2. against a bare context, keeping the same surfaces — so the test also proves
 *    the recorder does not change the pixels a build draws;
 * 3. through `parseRecording` → `prepareRecording` → `drawFrame`, into one context
 *    played straight through, which is where a leaked save level or a clip left in
 *    force shows up;
 * 4. and through the same three again with a fresh context per frame, which is the
 *    frame independence the whole format is built to provide — a reviewer's scrub
 *    bar goes anywhere.
 *
 * All four surfaces must agree byte for byte at every frame, and every frame must
 * report `skipped: 0`.
 *
 * **Why the engines are development dependencies here, and why that is not the
 * dependency the console is forbidden.** The shipped console must not depend on
 * an engine: a recording is read from a file a run produced, by a console built
 * separately and deployed on its own schedule, and `format.ts` is a
 * hand-maintained *copy* of an engine's `contract.ts` for exactly that reason. A
 * copied contract has one failure mode — the two drift and nothing says so — and
 * there is no way to catch it from either side alone. This suite is the thing
 * that catches it, so it needs both halves in one process. Each engine is a
 * test-only import: it appears in `devDependencies` and in no file the bundle
 * reaches, so the console ships without the engines and the copy is still held
 * to what every engine writes.
 *
 * The engines are consumed from their builds, like every other workspace package
 * this repository's front ends import, so `npm run build:packages` has to have
 * run — which is what `scripts/ci/web-test.sh` does before it runs the suites.
 *
 * **Why Node and `@napi-rs/canvas`.** The player draws into a `<canvas>` and jsdom
 * has no canvas backend at all, so the suite's default environment cannot hold a
 * pixel. A native canvas can, in process, with no browser to drive — the same
 * canvas the case harnesses and the reference builds already test against. The
 * recorder recognises host types by their global names, which is the browser's
 * vocabulary; in Node those names have to be pointed at the native classes that
 * play those roles, which is what {@link installHostTypes} does and all it does.
 *
 * **Where this canvas is not a browser.** A native canvas is not the platform the
 * format is written against, and it departs from it in five measured places: its
 * `reset()` leaves the clip in force, its `restore()` puts back the paint without
 * putting back the `fillStyle` and `strokeStyle` a build reads, it snapshots a
 * gradient at the assignment where a browser holds a live reference to it, it reads
 * `globalAlpha` back quantized to eight bits while blending with the double it was
 * given, and it samples a pattern differently depending on whether the source is a
 * canvas or an image. Each is named at the place that works around it, and none of
 * the workarounds touches the player or the recorder: they are in the rig, in what
 * the scripts are allowed to draw, and in one property the recorder reads back.
 * A difference this canvas cannot answer for is a difference this file must not
 * report, because it would be reported against the format.
 *
 * **Byte-for-byte parity is a property of this host, and DO NOT MOVE THIS FILE TO A
 * BROWSER.** Chromium rasterises an identical operation sequence differently
 * depending on what was painted into that canvas before it, and one gradient is
 * enough. Measured with the recorder and the player removed entirely — two canvases
 * handed the same final sequence, one of them given a single earlier fill under a
 * gradient paint, the sequence itself opening with a full-surface opaque clear under
 * identity — a shadow-blurred `fillRect` lands 731 of 6,144 pixels apart by up to
 * two levels, and shadow-blurred text 1,353 apart by up to four. The trigger is
 * narrow enough to name: a gradient built and never used, a pattern fill and a flat
 * fill each leave the sequence untouched, and a sequence with no shadow blur in it
 * is untouched by any of them, so what the earlier paint changes is how the blur is
 * rasterised rather than what it is blurring. Ten repeats of the triggering pair
 * disagree ten times, and the disagreement survives a `willReadFrequently` context
 * on both sides, which puts it on the CPU raster path rather than in a stale
 * readback.
 *
 * The size of that is a property of the browser and the machine rather than a
 * constant: this is headless Chromium 149 rastering in software, the same in the
 * headless shell and in full Chromium, and with the canvas accelerated through
 * ANGLE and SwiftShader the accelerated pair agrees while only the
 * `willReadFrequently` pair still disagrees. What it costs a browser port is the
 * fourth surface, the one drawn a frame at a time into a fresh context. Over 800
 * randomised scripts of six frames, each frame restating every property it could
 * have inherited so that a disagreement can only be the raster path, an accumulated
 * surface and a fresh-per-frame surface disagreed on 765 of 4,800 frames, across 403
 * of the 800 seeds, by as much as 1,815 pixels of 6,144, while two surfaces that
 * accumulated the same frames disagreed on none of the 4,800. So a browser rig whose
 * surfaces all carry the same history reports zero and needs no tolerance, and it is
 * answering a smaller question than this file asks: frame independence is the whole
 * point of the format, and it is exactly the comparison the host breaks.
 *
 * A frame that fails there is not a format defect and there is nothing in the format
 * to fix for it: the operations are identical and the surface they land on is
 * identical. `@napi-rs/canvas` puts that same probe at zero pixels and rasterises a
 * sequence the same way whatever preceded it, which is what makes an exact
 * comparison mean something here and makes it meaningless there. A browser rig is
 * still worth running by hand — three review rounds' worth of defects were found on
 * one — but it has to compare with a tolerance, and a tolerance is what this file
 * must not have.
 *
 * **What this host cannot cover: a path split across more than one transform.** A
 * `DrawState` carries its clip and its current path as one segment per transform,
 * and a state recorded here never holds a path of more than one — measured at zero
 * out of 2,114 states over 400 seeds, against 160 states carrying a clip of more
 * than one. So the clip half of that mechanism is covered by every sweep and the
 * path half is covered by nothing here, and the hand-written document in
 * `drawFrame.test.ts` ("re-opens a path whose operations were issued under two
 * different transforms") is the only place it is asserted at all. That the player
 * handles one against real pixels was verified in Chromium by hand.
 *
 * It is not covered here because the generator builds each path as one
 * uninterrupted run, and it has to: this canvas disturbs a path that is already
 * open where a browser does not. Measured, building `rect(0, 0, 10, 10)` and then
 * moving the transform before the fill — `translate(20, 0)` and `scale(2, 2)` leave
 * the fill at 0..9, which is what a browser does, while
 * `setTransform(1, 0, 0, 1, 20, 0)` moves it to 20..29 and
 * `setTransform(2, 0, 0, 2, 0, 0)` grows it to 0..19, which is not. Replaying a
 * multi-segment path means issuing exactly those `setTransform` calls between the
 * runs, so a script that changed the transform mid-path would compare this host's
 * path semantics rather than the format's.
 */

import {
  createCanvas,
  loadImage,
  DOMMatrix,
  Image,
  ImageData,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { drawFrame, prepareRecording, type ReplayResources } from "./drawFrame";
import { parseRecording, type Recording } from "./format";

/** The logical surface every scenario draws on, in device pixels. */
const WIDTH = 96;
const HEIGHT = 64;

/**
 * The colour a frame is cleared to, and the one the player blanks to.
 *
 * Opaque, and the same on both sides. A frame is only independently drawable if
 * every pixel it does not repaint is the background — the player blanks to
 * `recording.background` and then draws that frame alone, where the original
 * surface still carries whatever the frames before it left. Every script here
 * therefore opens each frame by clearing to this colour, which is what the engine's
 * own frame preparation does before a game draws.
 */
const BACKGROUND = "#101014";

/** The context a script draws through: the native one, or the recorder's wrapper. */
type Ctx = SKRSContext2D;

/**
 * One scenario's drawing, as a fresh closure each time it is asked for.
 *
 * A factory rather than a value, because a script holds the objects it made — the
 * gradient created before the recorder was armed is the point of the first scenario
 * — and the recorded pass and the bare pass must each get their own. `setup` is
 * drawing done *before* the recorder is armed, which is where a build establishes
 * the things this format has to carry across the arming boundary.
 */
interface Script {
  readonly setup?: (ctx: Ctx) => void;
  readonly frames: readonly ((ctx: Ctx) => void)[];
}

/** A surface's pixels, at the size it had when they were read. */
interface Shot {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * The recorder surface this suite drives, which both engines' `ContextRecorder`
 * classes present: constructed over a raw context, drawn through via
 * {@link ParityRecorder.context}, armed with the design size and background,
 * and bracketed a frame at a time — exactly the way the engine itself drives
 * it. `stop` answers the engine's own `Recording`, which the rig never trusts
 * as a type: it is serialized and re-read through the player's
 * `parseRecording`, the only form a reviewer ever sees.
 */
export interface ParityRecorder {
  readonly context: CanvasRenderingContext2D;
  start(options: {
    width: number;
    height: number;
    background: string | null;
  }): void;
  beginFrame(): void;
  endFrame(
    info: { count: number; timeMs: number; deltaMs: number },
    surface: { width: number; height: number },
  ): void;
  stop(): unknown;
}

/** Builds one engine's recorder over the context a scenario draws through. */
export type MakeRecorder = (ctx: CanvasRenderingContext2D) => ParityRecorder;

/** The engine binding, installed by {@link describeRecordingParity}. */
let makeRecorder: MakeRecorder = () => {
  throw new Error("describeRecordingParity has not bound an engine's recorder");
};

/**
 * Point the browser type names the recorder looks for at the native classes that
 * play those roles, and give the player the two constructors it decodes with.
 *
 * The recorder asks `globalThis` for `HTMLCanvasElement`, `HTMLImageElement` and
 * `ImageData` to decide whether an argument is a bitmap source it should capture,
 * a pixel buffer it should carry as bytes, or data it should write out field by
 * field. That is the browser's vocabulary and Node has none of it, so without this
 * every image in every scenario would record as an opaque marker and the suite
 * would prove nothing about the half of the format that carries pictures.
 *
 * The canvas class is read off an instance rather than taken from the package's
 * exports: `createCanvas` does not answer an instance of the exported `Canvas`, and
 * what the recorder has to recognise is the class of the object a script actually
 * hands it.
 */
function installHostTypes(): void {
  const probe = createCanvas(1, 1);
  vi.stubGlobal("HTMLCanvasElement", probe.constructor);
  vi.stubGlobal("HTMLImageElement", Image);
  vi.stubGlobal("ImageData", ImageData);
  vi.stubGlobal("DOMMatrix", DOMMatrix);
  // The player's own decoder builds an image element from the PNG a `bitmap` entry
  // carries. Stubbing it is what keeps `prepareRecording` on its real path here
  // rather than behind the injected decoder its other tests use.
  vi.stubGlobal("Image", Image);
}

/** A context over a fresh surface of the given size. */
function surface(width: number, height: number): Ctx {
  return createCanvas(width, height).getContext("2d");
}

/**
 * A surface for the player to draw into, with a `reset()` that means what the
 * canvas specification says it means.
 *
 * `reset()` is required to clear the bitmap, empty the path, empty the state stack
 * and return every property to its default — and clearing the clip is part of
 * returning the state to its default. `@napi-rs/canvas` implements all of that
 * *except* the clip: a region clipped at depth zero survives its `reset()` and goes
 * on masking everything drawn afterwards. A browser clears it, `drawFrame`'s
 * blanking step is written against the browser, and leaving the host's version in
 * place would make every scenario that inherits a clip fail for a reason that has
 * nothing to do with the player — the frame's background would be masked to the
 * clip of the frame before it.
 *
 * Writing the backing store size is the one operation this canvas has that resets
 * everything the specification's `reset()` resets, so that is what stands in for it.
 * Nothing else about the player's path is changed: it still finds a `reset`, still
 * takes the same branch, and still does its own clear and background fill after it.
 */
function replaySurface(width: number, height: number): Ctx {
  const ctx = surface(width, height);
  const canvas = ctx.canvas;
  (ctx as unknown as { reset: () => void }).reset = () => {
    const size = canvas.width;
    canvas.width = size;
  };
  return ctx;
}

/** Everything a context currently holds, as bytes. */
function read(ctx: Ctx): Shot {
  const { width, height } = ctx.canvas;
  const pixels = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(pixels.data) };
}

/**
 * Clear the whole surface to the background, whatever state the frame inherited.
 *
 * This is the engine's `prepare` in miniature, and every property it neutralizes is
 * one that would otherwise make the clear itself depend on the frame before it: a
 * `globalAlpha` of a half would leave a translucent background, a composite
 * operation would blend it, a shadow would smear it, and the next frame's picture
 * would then depend on how many frames had run — which is exactly the property a
 * seek breaks. The transform is reset because the clear is stated in device pixels;
 * the save/restore around it puts back the state the frame inherited, so what
 * follows draws under it.
 *
 * The clear is clipped by whatever clip the frame inherited, and that is correct:
 * outside that clip the surface has not been painted since before the clip was
 * taken, and by induction every such pixel is already the background.
 */
function clearFrame(ctx: Ctx): void {
  // Read before the save and written back after the restore. `@napi-rs/canvas`
  // restores the paint a `restore()` should restore and leaves `fillStyle` and
  // `strokeStyle` *reading* as whatever was assigned inside the save — measured
  // over every property a frame inherits, and those two are the only ones it gets
  // wrong. The recorder reads its state back from the context, so a frame that
  // opened on that disagreement would inherit the background colour where the
  // build is painting with something else, and the difference would be reported
  // against the format rather than against the host. Restating it puts the
  // property and the paint back in step.
  const fill = ctx.fillStyle;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.filter = "none";
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  ctx.fillStyle = fill;
}

/**
 * How two surfaces differ, or `null` when they do not.
 *
 * Phrased as a count and a first offender rather than as a diff, because the whole
 * byte array is useless to read and "4,032 of 4,096 pixels, first at (8, 0)" says
 * what kind of failure it is: a handful of pixels is an antialiasing edge, a
 * rectangle's worth is a clip or a fill, and everything is a transform.
 */
function difference(expected: Shot, actual: Shot): string | null {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return `the surfaces are ${expected.width}×${expected.height} and ${actual.width}×${actual.height}`;
  }
  let wrong = 0;
  let first: string | null = null;
  for (let at = 0; at < expected.data.length; at += 4) {
    const same =
      expected.data[at] === actual.data[at] &&
      expected.data[at + 1] === actual.data[at + 1] &&
      expected.data[at + 2] === actual.data[at + 2] &&
      expected.data[at + 3] === actual.data[at + 3];
    if (same) continue;
    wrong += 1;
    if (first !== null) continue;
    const pixel = at / 4;
    const x = pixel % expected.width;
    const y = Math.floor(pixel / expected.width);
    first =
      `(${x}, ${y}) is ` +
      `[${actual.data.slice(at, at + 4).join(", ")}]` +
      ` where the build drew [${expected.data.slice(at, at + 4).join(", ")}]`;
  }
  if (wrong === 0) return null;
  const total = expected.width * expected.height;
  return `${wrong} of ${total} pixels differ; first at ${first}`;
}

/** What the recorded pass produced: the document, and what was on screen per frame. */
interface Capture {
  readonly recording: Recording;
  readonly shots: readonly Shot[];
}

/**
 * Run a script through the recorder, keeping the surface at the end of every frame.
 *
 * The frame bracket is the engine's: `beginFrame` before the game draws, so the
 * state snapshot is the state the frame *inherited*, and `endFrame` after, with the
 * backing store read at that moment — a frame that resized the canvas reports the
 * size it ended at, which is the size the player will draw it at.
 *
 * The document is put through `JSON.parse(JSON.stringify(...))` and then through the
 * player's own `parseRecording`, because that is the only form a reviewer ever sees:
 * a recording is written to a file by one process and read by another, and anything
 * that survives only as a live object reference would pass here and fail there.
 */
function record(build: () => Script): Capture {
  const ctx = surface(WIDTH, HEIGHT);
  const recorder = makeRecorder(ctx as unknown as CanvasRenderingContext2D);
  const script = build();
  const drawing = recorder.context as unknown as Ctx;

  script.setup?.(drawing);
  recorder.start({ width: WIDTH, height: HEIGHT, background: BACKGROUND });

  const shots: Shot[] = [];
  script.frames.forEach((frame, at) => {
    recorder.beginFrame();
    frame(drawing);
    recorder.endFrame(
      { count: at, timeMs: at * 16, deltaMs: 16 },
      { width: ctx.canvas.width, height: ctx.canvas.height },
    );
    shots.push(read(ctx));
  });

  const written = recorder.stop();
  const parsed = parseRecording(JSON.parse(JSON.stringify(written)) as unknown);
  if (!parsed.ok)
    throw new Error(`the player refused the recording: ${parsed.message}`);
  // One parse reads both drawing spaces, so what it answers with is the space the
  // document states. A 2D recorder that wrote a 3D document would otherwise reach
  // the pixel comparison below as though nothing had changed.
  if (parsed.recording.space === "3d") {
    throw new Error("this engine's recorder wrote a 3D document");
  }
  return { recording: parsed.recording, shots };
}

/** Run the same script against a bare context, keeping the same surfaces. */
function bare(build: () => Script): readonly Shot[] {
  const ctx = surface(WIDTH, HEIGHT);
  const script = build();
  script.setup?.(ctx);
  const shots: Shot[] = [];
  for (const frame of script.frames) {
    frame(ctx);
    shots.push(read(ctx));
  }
  return shots;
}

/**
 * Size a replay surface for one frame, the way `ReplayPlayer` does.
 *
 * The canvas is sized from the frame's own recorded backing store, so a recording
 * whose surface changed part way through is drawn at the size each frame actually
 * had. Writing the size also blanks the canvas, which is why it is only written
 * when it changed — `drawFrame` does its own blanking and a needless one here would
 * hide a frame that failed to.
 */
function fit(ctx: Ctx, recording: Recording, at: number): void {
  const shot = recording.frames[at];
  const width =
    shot !== undefined && shot.surface.width > 0
      ? shot.surface.width
      : recording.width;
  const height =
    shot !== undefined && shot.surface.height > 0
      ? shot.surface.height
      : recording.height;
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;
}

/** One frame's replay: what it reported, and what it drew. */
interface Replayed {
  readonly skipped: number;
  readonly unreproducible: readonly string[];
  readonly shot: Shot;
}

/** Replay every frame in order into one context, as a reviewer watching it play. */
function replayInOrder(
  recording: Recording,
  resources: ReplayResources,
): readonly Replayed[] {
  const ctx = replaySurface(recording.width, recording.height);
  return recording.frames.map((_frame, at) => {
    fit(ctx, recording, at);
    const report = drawFrame(
      ctx as unknown as CanvasRenderingContext2D,
      recording,
      resources,
      at,
    );
    return {
      skipped: report.skipped,
      unreproducible: report.unreproducible,
      shot: read(ctx),
    };
  });
}

/** Replay one frame into a context nothing has been drawn into: a cold seek. */
function replayCold(
  recording: Recording,
  resources: ReplayResources,
  at: number,
): Replayed {
  const ctx = replaySurface(recording.width, recording.height);
  fit(ctx, recording, at);
  const report = drawFrame(
    ctx as unknown as CanvasRenderingContext2D,
    recording,
    resources,
    at,
  );
  return {
    skipped: report.skipped,
    unreproducible: report.unreproducible,
    shot: read(ctx),
  };
}

/**
 * The whole check, for one script.
 *
 * `context` is whatever the caller wants printed beside a failure — a seed and the
 * script that produced it, for the generated ones — because a scenario that fails
 * has to be reproducible from what the failure says.
 */
async function verify(build: () => Script, context = ""): Promise<void> {
  const suffix = context === "" ? "" : `\n${context}`;
  const { recording, shots } = record(build);
  const unwatched = bare(build);
  const resources = await prepareRecording(recording);

  expect(recording.frames.length, `frames recorded${suffix}`).toBe(
    shots.length,
  );

  shots.forEach((expected, at) => {
    const drawn = unwatched[at];
    if (drawn === undefined)
      throw new Error(`the bare pass drew no frame ${at}${suffix}`);
    const differs = difference(expected, drawn);
    if (differs !== null) {
      throw new Error(
        `the recorder changed what frame ${at} drew: ${differs}${suffix}`,
      );
    }
  });

  const played = replayInOrder(recording, resources);
  shots.forEach((expected, at) => {
    const actual = played[at];
    if (actual === undefined)
      throw new Error(`the replay drew no frame ${at}${suffix}`);
    expect(
      actual.unreproducible,
      `frame ${at} replayed in order reported something it could not draw${suffix}`,
    ).toEqual([]);
    expect(actual.skipped, `frame ${at} replayed in order${suffix}`).toBe(0);
    const differs = difference(expected, actual.shot);
    if (differs !== null) {
      throw new Error(`frame ${at} replayed in order: ${differs}${suffix}`);
    }
  });

  shots.forEach((expected, at) => {
    const actual = replayCold(recording, resources, at);
    expect(
      actual.unreproducible,
      `frame ${at} seeked to cold reported something it could not draw${suffix}`,
    ).toEqual([]);
    expect(actual.skipped, `frame ${at} seeked to cold${suffix}`).toBe(0);
    const differs = difference(expected, actual.shot);
    if (differs !== null) {
      throw new Error(`frame ${at} seeked to cold: ${differs}${suffix}`);
    }
  });
}

/**
 * A fixed source every scenario that blits can share.
 *
 * Opaque throughout, deliberately. A canvas holds premultiplied colour, so a
 * partially transparent pixel that goes through a PNG and back is quantized to
 * eight bits twice and can come back a neighbouring value — a real property of the
 * platform rather than of this format, and one that would make a `bitmap` capture
 * flake by a unit here and there. The format carries partial alpha exactly through
 * `kind: "pixels"`, which is what the `putImageData` scenario tests.
 */
let sprite: Image;

/**
 * Register the whole suite, bound to one engine's recorder.
 *
 * Called once, at the top level of each per-engine test file, so the suites it
 * registers land in that file. The two engines never share state: vitest
 * evaluates this module afresh per test file, so the binding and the shared
 * sprite are that file's own.
 */
export function describeRecordingParity(make: MakeRecorder): void {
  makeRecorder = make;
  spriteSetup();
  namedScenarios();
  generatedScenarios();
}

/** Build the shared sprite once, before any scenario runs. */
function spriteSetup(): void {
  beforeAll(async () => {
    installHostTypes();
    const ctx = surface(16, 16);
    ctx.fillStyle = "#1b2f6b";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#ffcc00";
    ctx.fillRect(2, 2, 8, 8);
    ctx.fillStyle = "#ff2d55";
    ctx.beginPath();
    ctx.arc(11, 11, 4, 0, Math.PI * 2);
    ctx.fill();
    sprite = await loadImage(ctx.canvas.toDataURL("image/png"));
  });
}

/** The hand-written scenarios: each one a defect class a review round found. */
function namedScenarios(): void {
  describe("the engine's recorder replayed by this player", () => {
    it("draws a gradient created before the recorder was armed", async () => {
      await verify(() => {
        let paint: CanvasGradient;
        return {
          setup: (ctx) => {
            paint = ctx.createLinearGradient(0, 0, WIDTH, 0);
            paint.addColorStop(0, "#ff2d55");
            paint.addColorStop(0.5, "#ffcc00");
            paint.addColorStop(1, "#0a84ff");
          },
          frames: [
            (ctx) => {
              clearFrame(ctx);
              ctx.fillStyle = paint;
              ctx.fillRect(8, 8, WIDTH - 16, HEIGHT - 16);
            },
            (ctx) => {
              clearFrame(ctx);
              ctx.fillStyle = paint;
              ctx.fillRect(4, 20, WIDTH - 8, 24);
            },
          ],
        };
      });
    });

    it("re-states a gradient given another stop after it was assigned", () => {
      // The one property in this file that cannot be stated in pixels here, and the
      // reason is the host rather than the format. A canvas style property holds a
      // live reference: in a browser, a gradient given another stop after it was
      // assigned paints with that stop, which is why the recorder re-states the
      // property before the paint. `@napi-rs/canvas` snapshots the gradient at the
      // assignment instead — measured: the same script paints a flat red there and
      // red→blue→red in Chromium — so on this canvas the corrective assignment makes
      // the replay differ from the build *because the replay is right*. What is
      // checked is therefore what the recording says, which is the half this process
      // can observe; the pixels were demonstrated in Chromium, and the re-assignment
      // case below covers what both hosts agree on.
      const { recording } = record(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            const paint = ctx.createLinearGradient(0, 0, WIDTH, 0);
            paint.addColorStop(0, "#ff0000");
            paint.addColorStop(1, "#ff0000");
            ctx.fillStyle = paint;
            paint.addColorStop(0.5, "#0000ff");
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
        ],
      }));

      const frame = recording.frames[0];
      if (frame === undefined) throw new Error("the recording kept no frame");
      const ops = frame.ops.map((at) => recording.ops[at]);
      const assigned = ops.filter(
        (op) =>
          op !== undefined &&
          op.op === "set" &&
          op.property === "fillStyle" &&
          typeof op.value === "object" &&
          op.value !== null &&
          "$res" in op.value,
      );
      // Two: the build's own, and the corrective one. The stops the build had at
      // each of them are what the two resources hold.
      expect(assigned).toHaveLength(2);
      const stops = assigned.map((op) => {
        const named = (op as { value: { $res: number } }).value;
        return recording.resources[named.$res]?.then ?? [];
      });
      expect(stops[0]).toHaveLength(2);
      expect(stops[1]).toHaveLength(3);
      expect(JSON.stringify(stops[1])).toContain("#0000ff");
      // And the corrective assignment stands in front of the paint it corrects.
      const corrective = ops.indexOf(assigned[1]);
      const painted = ops.map((op, at) =>
        op !== undefined && op.op === "call" && op.method === "fillRect"
          ? at
          : -1,
      );
      expect(corrective).toBeLessThan(Math.max(...painted));
    });

    it("draws a gradient re-assigned after another stop", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            const paint = ctx.createLinearGradient(0, 0, WIDTH, 0);
            paint.addColorStop(0, "#ff0000");
            paint.addColorStop(1, "#ff0000");
            ctx.fillStyle = paint;
            ctx.fillRect(0, 0, WIDTH, 24);
            // One value, two uses, two histories: the top band must stay flat red
            // and the bottom one must carry the blue.
            paint.addColorStop(0.5, "#0000ff");
            ctx.fillStyle = paint;
            ctx.fillRect(0, 24, WIDTH, HEIGHT - 24);
          },
        ],
      }));
    });

    it("draws a pattern whose source was repainted after it was made", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            // One flat colour per tile, which is what keeps this measurable: skia
            // samples a canvas-backed pattern and an image-backed one differently
            // at a tile's edges — measured at ±10 on every boundary pixel of a
            // two-colour tile — and the recording necessarily carries the source as
            // captured pixels. A tile with no internal edge has nothing to sample
            // differently, so what is left to compare is the only thing this
            // scenario is about: which picture the pattern kept.
            const source = surface(8, 8);
            source.fillStyle = "#ffcc00";
            source.fillRect(0, 0, 8, 8);
            const paint = ctx.createPattern(source.canvas, "repeat");
            // `createPattern` copied its source at the call above, so this repaint
            // must not reach the picture.
            source.fillStyle = "#34c759";
            source.fillRect(0, 0, 8, 8);
            ctx.fillStyle = paint;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
        ],
      }));
    });

    it("draws a mutable source repainted between two blits", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            const source = surface(12, 12);
            source.fillStyle = "#1b2f6b";
            source.fillRect(0, 0, 12, 12);
            source.fillStyle = "#ffcc00";
            source.fillRect(3, 3, 6, 6);
            ctx.drawImage(source.canvas, 8, 8);
            // The same source, a different picture. A recorder that captured a
            // canvas once and reused the bytes would blit the first picture twice
            // and report nothing.
            source.fillStyle = "#34c759";
            source.fillRect(0, 0, 12, 12);
            source.fillStyle = "#ff2d55";
            source.fillRect(2, 2, 4, 4);
            ctx.drawImage(source.canvas, 40, 30);
          },
        ],
      }));
    });

    it("draws a frame that restores what the frame before it saved", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#0a84ff";
            ctx.lineWidth = 5;
            ctx.save();
            ctx.fillStyle = "#ff2d55";
            ctx.lineWidth = 1;
            ctx.fillRect(8, 8, 24, 24);
          },
          (ctx) => {
            clearFrame(ctx);
            // Pops to the state frame 0 saved: a blue fill and a wide stroke.
            ctx.restore();
            ctx.fillRect(8, 8, 24, 24);
            ctx.strokeStyle = "#ffcc00";
            ctx.strokeRect(48, 16, 32, 32);
          },
        ],
      }));
    });

    it("draws a frame under a clip set several frames earlier", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.beginPath();
            ctx.rect(16, 12, 48, 32);
            ctx.clip();
            ctx.fillStyle = "#ff9f0a";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#34c759";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#af52de";
            ctx.fillRect(20, 0, 20, HEIGHT);
          },
        ],
      }));
    });

    it("draws a clip taken under one transform from a frame drawn under another", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            // Translated and scaled rather than rotated, so the clip lands on whole
            // device pixels. An antialiased clip edge is a boundary pixel that no
            // frame can fully repaint — the build's covers it partly over what the
            // frame before it drew, and a seek covers it partly over the background
            // — so a rotated clip measures canvas antialiasing rather than this
            // format. The transform is still a different one from the frame below.
            ctx.translate(20, 10);
            ctx.scale(2, 1);
            ctx.beginPath();
            ctx.rect(0, 0, 20, 30);
            ctx.clip();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#ff2d55";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
          (ctx) => {
            clearFrame(ctx);
            ctx.scale(2, 2);
            ctx.fillStyle = "#5ac8fa";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
        ],
      }));
    });

    it("draws two clips taken with no beginPath between them", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.beginPath();
            ctx.rect(8, 8, 60, 40);
            ctx.clip();
            // No `beginPath`: the current path still holds the first rectangle, so
            // the second clip intersects with the union of the two.
            ctx.rect(30, 4, 40, 50);
            ctx.clip();
            ctx.fillStyle = "#ffcc00";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
          },
        ],
      }));
    });

    it("fills a path begun on the frame before", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.beginPath();
            ctx.moveTo(10, 10);
            ctx.lineTo(70, 16);
            ctx.lineTo(44, 52);
            ctx.closePath();
          },
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#5ac8fa";
            ctx.fill();
          },
        ],
      }));
    });

    it("does not let an inherited clip become the path a bare fill fills", async () => {
      // The measured shape of the defect this closes: a 30×30 fill replaying as a
      // fill of everything the clip allows, reported as clean. The frame that draws
      // it issues nothing but `fill()`, so what it fills is entirely what it
      // inherited — the clip has to be re-applied and must not be left current as a
      // path. (Of the two things that separate them, only one is measurable from
      // here: this recorder keeps the `beginPath` that opened the path, so the
      // player's own separating `beginPath` is belt and braces against a document
      // written by the other recorder rather than something this rig can isolate.
      // Losing the inherited path outright is measurable, and this scenario and the
      // one above both catch it.)
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.beginPath();
            ctx.rect(4, 4, WIDTH - 8, HEIGHT - 8);
            ctx.clip();
            // The path the frame leaves current is this one, and nothing else.
            ctx.beginPath();
            ctx.rect(20, 16, 30, 30);
          },
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#ff2d55";
            ctx.fill();
          },
        ],
      }));
    });

    it("draws a frame that resized the canvas before drawing", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            ctx.translate(10, 6);
            ctx.beginPath();
            ctx.rect(0, 0, 20, 20);
            ctx.clip();
            ctx.fillStyle = "#ff2d55";
            ctx.fillRect(-20, -20, WIDTH, HEIGHT);
          },
          (ctx) => {
            // Writing the backing store size resets the context completely: the
            // transform, the properties, the clip and the save stack all go. The
            // frame inherits none of what frame 0 established.
            ctx.canvas.width = 64;
            ctx.canvas.height = 48;
            clearFrame(ctx);
            ctx.fillStyle = "#34c759";
            ctx.fillRect(8, 8, 40, 24);
          },
        ],
      }));
    });

    it("draws pixels written with partial alpha", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            const bytes = new Uint8ClampedArray(16 * 16 * 4);
            for (let y = 0; y < 16; y += 1) {
              for (let x = 0; x < 16; x += 1) {
                const at = (y * 16 + x) * 4;
                bytes[at] = 200;
                bytes[at + 1] = 100 + x * 4;
                bytes[at + 2] = 50;
                bytes[at + 3] = x * 16 + 8;
              }
            }
            ctx.putImageData(new ImageData(bytes, 16, 16), 20, 12);
          },
        ],
      }));
    });

    it("draws a fixed source blitted many times", async () => {
      await verify(() => ({
        frames: [
          (ctx) => {
            clearFrame(ctx);
            for (let at = 0; at < 12; at += 1) {
              ctx.drawImage(
                sprite,
                (at * 7) % (WIDTH - 16),
                (at * 5) % (HEIGHT - 16),
              );
            }
          },
          (ctx) => {
            clearFrame(ctx);
            for (let at = 0; at < 12; at += 1) {
              ctx.drawImage(
                sprite,
                (at * 5) % (WIDTH - 16),
                (at * 9) % (HEIGHT - 16),
                8,
                8,
              );
            }
          },
        ],
      }));
    });

    it("seeks cold to the last frame of a long recording", async () => {
      const build = (): Script => {
        const frames: ((ctx: Ctx) => void)[] = [
          (ctx) => {
            clearFrame(ctx);
            ctx.fillStyle = "#34c759";
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 2]);
            ctx.beginPath();
            ctx.rect(4, 4, WIDTH - 8, HEIGHT - 8);
            ctx.clip();
            ctx.save();
            ctx.fillStyle = "#ff2d55";
          },
        ];
        // Thirty-eight frames that draw with nothing but what frame 0 established:
        // the stroke colour, the width and the dash, all under its clip and inside
        // its save. A player that seeks here has replayed none of them.
        for (let at = 1; at < 39; at += 1) {
          const x = 8 + ((at * 3) % (WIDTH - 26));
          frames.push((ctx) => {
            clearFrame(ctx);
            ctx.strokeRect(x, 10, 12, 12);
          });
        }
        frames.push((ctx) => {
          clearFrame(ctx);
          ctx.restore();
          ctx.fillRect(6, 32, 24, 20);
          ctx.strokeRect(40, 32, 24, 20);
        });
        return { frames };
      };

      await verify(build);

      // And the named property on its own: the last frame, into a context that has
      // drawn nothing, with no frame before it prepared.
      const { recording, shots } = record(build);
      const resources = await prepareRecording(recording);
      const last = recording.frames.length - 1;
      const cold = replayCold(recording, resources, last);
      expect(cold.skipped).toBe(0);
      const expected = shots[last];
      if (expected === undefined)
        throw new Error("the recording kept no last frame");
      expect(difference(expected, cold.shot)).toBeNull();
    });
  });
}

// ---- The generated scripts ----------------------------------------------

/**
 * A seeded pseudo-random source.
 *
 * Small, exact, and reproducible from a single integer, which is the whole point:
 * a failing seed is printed and the script it generated is printed with it, so the
 * case is replayable from the failure alone.
 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Colours a generated script paints with. Opaque; translucency comes from alpha. */
const PALETTE = [
  "#ff2d55",
  "#ffcc00",
  "#34c759",
  "#0a84ff",
  "#af52de",
  "#ff9f0a",
  "#5ac8fa",
  "#ffffff",
  "#8e8e93",
  "#1b2f6b",
];

/** One statement of a generated script: data, so a failure can print it. */
type Step =
  | { readonly k: "clear" }
  | {
      readonly k: "style";
      readonly which: "fillStyle" | "strokeStyle";
      readonly color: string;
    }
  | { readonly k: "number"; readonly prop: string; readonly value: number }
  | { readonly k: "text-style"; readonly prop: string; readonly value: string }
  | {
      readonly k: "dash";
      readonly pattern: readonly number[];
      readonly offset: number;
    }
  | {
      readonly k: "rect";
      readonly op: "fillRect" | "strokeRect" | "clearRect";
      readonly box: readonly number[];
    }
  | { readonly k: "path"; readonly ops: readonly PathStep[] }
  | { readonly k: "paint"; readonly op: "fill" | "stroke" }
  | {
      readonly k: "clip";
      readonly box: readonly number[];
      readonly at: readonly number[];
    }
  | {
      readonly k: "transform";
      readonly op: string;
      readonly args: readonly number[];
    }
  | { readonly k: "save" }
  | { readonly k: "restore" }
  | {
      readonly k: "gradient";
      readonly slot: number;
      readonly kind: "linear" | "radial" | "conic";
      readonly args: readonly number[];
      readonly stops: readonly (readonly [number, string])[];
    }
  | {
      readonly k: "stop";
      readonly slot: number;
      readonly offset: number;
      readonly color: string;
    }
  | {
      readonly k: "use-gradient";
      readonly slot: number;
      readonly which: "fillStyle" | "strokeStyle";
    }
  | {
      readonly k: "pattern";
      readonly slot: number;
      readonly color: string;
      readonly repeat: string;
    }
  | { readonly k: "repaint"; readonly slot: number; readonly color: string }
  | {
      readonly k: "use-pattern";
      readonly slot: number;
      readonly which: "fillStyle" | "strokeStyle";
    }
  | {
      readonly k: "text";
      readonly op: "fillText" | "strokeText";
      readonly value: string;
      readonly at: readonly number[];
    }
  | {
      readonly k: "grab";
      readonly slot: number;
      readonly box: readonly number[];
    }
  | { readonly k: "put"; readonly slot: number; readonly at: readonly number[] }
  | { readonly k: "blit"; readonly at: readonly number[] };

/** One step of a generated path. */
type PathStep = { readonly op: string; readonly args: readonly number[] };

/** What a generated script has made so far, so it only ever names a slot it filled. */
interface Made {
  gradients: number;
  patterns: number;
  buffers: number;
  /**
   * Whether a clip has been taken, in this frame or an earlier one.
   *
   * `putImageData` is the one operation that ignores the clip, so a frame under a
   * clip can write pixels outside it — and the next frame's clear, which is
   * clipped, cannot reach them. Those pixels then belong to no frame at all: the
   * build carries them forward and a seek does not, and the difference is a fact
   * about `putImageData` rather than about this format.
   */
  clipped: boolean;
}

/** What the interpreter is holding while it runs one generated script. */
interface Bag {
  readonly gradients: Map<number, CanvasGradient>;
  readonly patterns: Map<number, CanvasPattern>;
  readonly sources: Map<number, Ctx>;
  readonly buffers: Map<number, ImageData>;
}

/** Build a random path: a `beginPath` and a few segments, in bounds. */
function makePath(next: () => number): PathStep[] {
  const ops: PathStep[] = [{ op: "beginPath", args: [] }];
  const x = () => Math.round(next() * WIDTH);
  const y = () => Math.round(next() * HEIGHT);
  // Angles to four decimals, and a whole turn as the same. Every number a
  // recording carries is written to nine significant digits, which is a
  // documented part of the format and about a millionth of a pixel — but an
  // antialiased edge whose coverage lands exactly on a rounding boundary still
  // comes back one unit different, and a script that generated a sixteen-digit
  // angle would report that as a defect. Four decimals survive the rule exactly,
  // so what is compared is the drawing rather than the last digit of the arithmetic.
  const angle = () => Math.round(next() * 62832) / 10000;
  ops.push({ op: "moveTo", args: [x(), y()] });
  const count = 1 + Math.floor(next() * 3);
  for (let at = 0; at < count; at += 1) {
    const pick = next();
    if (pick < 0.25) ops.push({ op: "lineTo", args: [x(), y()] });
    else if (pick < 0.4)
      ops.push({ op: "quadraticCurveTo", args: [x(), y(), x(), y()] });
    else if (pick < 0.55)
      ops.push({ op: "bezierCurveTo", args: [x(), y(), x(), y(), x(), y()] });
    else if (pick < 0.65)
      ops.push({
        op: "arcTo",
        args: [x(), y(), x(), y(), 4 + Math.round(next() * 12)],
      });
    else if (pick < 0.78) {
      ops.push({
        op: "arc",
        args: [x(), y(), 3 + Math.round(next() * 20), 0, angle()],
      });
    } else if (pick < 0.88) {
      ops.push({
        op: "ellipse",
        args: [
          x(),
          y(),
          3 + Math.round(next() * 14),
          3 + Math.round(next() * 14),
          angle(),
          0,
          6.2832,
        ],
      });
    } else if (pick < 0.95)
      ops.push({
        op: "rect",
        args: [
          x(),
          y(),
          4 + Math.round(next() * 30),
          4 + Math.round(next() * 24),
        ],
      });
    else {
      ops.push({
        op: "roundRect",
        args: [
          x(),
          y(),
          8 + Math.round(next() * 24),
          8 + Math.round(next() * 20),
          2 + Math.round(next() * 5),
        ],
      });
    }
  }
  if (next() < 0.5) ops.push({ op: "closePath", args: [] });
  return ops;
}

/**
 * Generate one script's frames.
 *
 * Two rules shape the shape of a frame, and both are about what a *frame* has to be
 * rather than about what a canvas allows.
 *
 * The frame opens with a clear, always, because a frame the player can draw on its
 * own is a frame that repaints what it shows. And a `clip` may only appear in the
 * frame's prologue — after the clear and before anything is painted — because a
 * clip narrowed part way through a frame leaves the pixels painted before it
 * outside the region the next frame's clear can reach, and those pixels would then
 * belong to no frame at all. A `restore` only ever widens the clip, so it is free
 * to appear anywhere.
 *
 * The rest of what the generator may not emit is native-canvas ground rather than
 * format ground, and each restriction is stated where it is applied: no
 * `putImageData` once a clip is in force (it is the one call that ignores one), no
 * paint left holding a gradient across a mutation, both paint properties restated
 * after a `restore`, patterns tiled rather than clamped, alphas on the eight-bit
 * grid, and angles inside nine significant digits. Every one of them is a place
 * where this canvas would report a difference the format is not responsible for.
 */
function generate(next: () => number, frames: number): Step[][] {
  const script: Step[][] = [];
  const made: Made = { gradients: 0, patterns: 0, buffers: 0, clipped: false };
  const color = (): string =>
    PALETTE[Math.floor(next() * PALETTE.length)] ?? "#ffffff";
  const x = () => Math.round(next() * (WIDTH - 8));
  const y = () => Math.round(next() * (HEIGHT - 8));

  for (let frame = 0; frame < frames; frame += 1) {
    const steps: Step[] = [{ k: "clear" }];
    if (next() < 0.35) steps.push({ k: "save" });
    if (next() < 0.4) {
      steps.push({
        k: "transform",
        op: "translate",
        args: [Math.round(next() * 20) - 10, Math.round(next() * 20) - 10],
      });
    }
    if (next() < 0.35) {
      made.clipped = true;
      steps.push({
        k: "clip",
        box: [
          x(),
          y(),
          20 + Math.round(next() * 40),
          16 + Math.round(next() * 30),
        ],
        at: [Math.round(next() * 16) - 8, Math.round(next() * 16) - 8],
      });
    }

    const body = 6 + Math.floor(next() * 8);
    for (let at = 0; at < body; at += 1) {
      const pick = next();
      if (pick < 0.1) {
        steps.push({
          k: "style",
          which: next() < 0.5 ? "fillStyle" : "strokeStyle",
          color: color(),
        });
      } else if (pick < 0.16) {
        const props = [
          "globalAlpha",
          "lineWidth",
          "lineDashOffset",
          "miterLimit",
          "shadowBlur",
        ] as const;
        const prop = props[Math.floor(next() * props.length)] ?? "lineWidth";
        // The alpha comes off a short list, and both constraints on it are real.
        // `@napi-rs/canvas` blends with the double it was handed and reads the
        // property back quantized to eight bits, so the value has to be a whole
        // number of 255ths or the build and the recorder disagree about what it
        // is. And every number a recording carries is written to nine significant
        // digits, so it also has to be one that survives that. Five of the 255ths
        // are: a fifth, and its multiples.
        const alphas = [0.2, 0.4, 0.6, 0.8, 1];
        const value =
          prop === "globalAlpha"
            ? (alphas[Math.floor(next() * alphas.length)] ?? 1)
            : Math.round(next() * 8) + 1;
        steps.push({ k: "number", prop, value });
      } else if (pick < 0.21) {
        const choices: readonly (readonly [string, readonly string[]])[] = [
          ["lineCap", ["butt", "round", "square"]],
          ["lineJoin", ["miter", "round", "bevel"]],
          ["textAlign", ["start", "center", "right"]],
          ["textBaseline", ["alphabetic", "top", "middle"]],
          [
            "globalCompositeOperation",
            ["source-over", "lighter", "multiply", "screen"],
          ],
          ["shadowColor", PALETTE],
          [
            "font",
            ["10px sans-serif", "bold 16px sans-serif", "italic 13px serif"],
          ],
        ];
        const entry =
          choices[Math.floor(next() * choices.length)] ?? choices[0];
        const [prop, values] = entry as readonly [string, readonly string[]];
        steps.push({
          k: "text-style",
          prop,
          value: values[Math.floor(next() * values.length)] ?? values[0]!,
        });
      } else if (pick < 0.26) {
        const length = 1 + Math.floor(next() * 3);
        const pattern: number[] = [];
        for (let n = 0; n < length; n += 1)
          pattern.push(1 + Math.round(next() * 8));
        steps.push({ k: "dash", pattern, offset: Math.round(next() * 6) });
      } else if (pick < 0.42) {
        const op =
          next() < 0.6
            ? "fillRect"
            : next() < 0.85
              ? "strokeRect"
              : "clearRect";
        steps.push({
          k: "rect",
          op,
          box: [
            x(),
            y(),
            4 + Math.round(next() * 40),
            4 + Math.round(next() * 30),
          ],
        });
      } else if (pick < 0.56) {
        steps.push({ k: "path", ops: makePath(next) });
        steps.push({ k: "paint", op: next() < 0.6 ? "fill" : "stroke" });
      } else if (pick < 0.63) {
        const op = next();
        if (op < 0.3)
          steps.push({
            k: "transform",
            op: "translate",
            args: [Math.round(next() * 24) - 12, Math.round(next() * 24) - 12],
          });
        else if (op < 0.5)
          steps.push({
            k: "transform",
            op: "rotate",
            args: [Math.round(next() * 100) / 100],
          });
        else if (op < 0.7)
          steps.push({
            k: "transform",
            op: "scale",
            args: [
              0.5 + Math.round(next() * 100) / 100,
              0.5 + Math.round(next() * 100) / 100,
            ],
          });
        else if (op < 0.85)
          steps.push({
            k: "transform",
            op: "transform",
            args: [
              1,
              Math.round(next() * 40) / 100,
              Math.round(next() * 40) / 100,
              1,
              0,
              0,
            ],
          });
        else if (op < 0.95)
          steps.push({
            k: "transform",
            op: "setTransform",
            args: [
              1,
              0,
              0,
              1,
              Math.round(next() * 20) - 10,
              Math.round(next() * 20) - 10,
            ],
          });
        else steps.push({ k: "transform", op: "resetTransform", args: [] });
      } else if (pick < 0.69) {
        if (next() < 0.55) steps.push({ k: "save" });
        else {
          steps.push({ k: "restore" });
          // Both paint properties are re-stated straight after, because
          // `@napi-rs/canvas` does not put a gradient or a pattern back on
          // `restore()`: the paint it draws with is restored and the property
          // still reads as the value that was assigned inside the save. The
          // recorder reads its state back from the context, so a frame that
          // opened on that disagreement would inherit a fill the build is not
          // painting with — a fact about this canvas, not about the format, and
          // one that assigning a colour clears. What a restore does to a produced
          // value is covered where a host can answer for it: see the save-stack
          // scenario above, which restores colours.
          steps.push({ k: "style", which: "fillStyle", color: color() });
          steps.push({ k: "style", which: "strokeStyle", color: color() });
        }
      } else if (pick < 0.78) {
        const slot = made.gradients;
        made.gradients += 1;
        const kind =
          next() < 0.5 ? "linear" : next() < 0.8 ? "radial" : "conic";
        const args =
          kind === "linear"
            ? [x(), y(), x(), y()]
            : kind === "radial"
              ? [
                  x(),
                  y(),
                  2 + Math.round(next() * 8),
                  x(),
                  y(),
                  12 + Math.round(next() * 30),
                ]
              : [Math.round(next() * 62832) / 10000, x(), y()];
        const stops: (readonly [number, string])[] = [
          [0, color()],
          [1, color()],
        ];
        const which = next() < 0.7 ? "fillStyle" : "strokeStyle";
        steps.push({ k: "gradient", slot, kind, args, stops });
        steps.push({ k: "use-gradient", slot, which });
        // A stop added after the assignment, and then the assignment again: one
        // value, two uses, two histories, which is what capture-at-use has to keep
        // apart. The re-assignment is not optional here — a mutation with no
        // assignment after it is the one shape this host cannot measure, because
        // it snapshots a gradient where a browser holds a reference to it (see
        // "re-states a gradient given another stop after it was assigned").
        if (next() < 0.6) {
          steps.push({
            k: "stop",
            slot,
            offset: Math.round(next() * 90) / 100,
            color: color(),
          });
          // Back onto the same property the assignment above named: a property
          // left holding the value across the mutation is the shape this host
          // cannot measure.
          steps.push({ k: "use-gradient", slot, which });
        }
      } else if (pick < 0.84 && made.gradients > 0) {
        const slot = Math.floor(next() * made.gradients);
        steps.push({
          k: "use-gradient",
          slot,
          which: next() < 0.7 ? "fillStyle" : "strokeStyle",
        });
      } else if (pick < 0.9) {
        const slot = made.patterns;
        made.patterns += 1;
        // `repeat` only. A pattern is carried as captured pixels, so the replay
        // builds it from an image where the build built it from a canvas, and skia
        // treats the two differently at a tile's outer edge: measured over a flat
        // 8×8 tile, `repeat` agrees byte for byte while `repeat-x`, `repeat-y` and
        // `no-repeat` each disagree by up to 255 along the edge the mode leaves
        // uncovered. A fully tiled pattern has no such edge.
        steps.push({ k: "pattern", slot, color: color(), repeat: "repeat" });
        // Repainted after the pattern copied it: the picture must be the one the
        // source carried at the producing call.
        if (next() < 0.6) steps.push({ k: "repaint", slot, color: color() });
        steps.push({
          k: "use-pattern",
          slot,
          which: next() < 0.8 ? "fillStyle" : "strokeStyle",
        });
      } else if (pick < 0.94) {
        const words = ["Carom", "42", "replay", "AVG", "x9"];
        steps.push({
          k: "text",
          op: next() < 0.7 ? "fillText" : "strokeText",
          value: words[Math.floor(next() * words.length)] ?? "Carom",
          at: [x(), 12 + y()],
        });
      } else if (pick < 0.98 && !made.clipped) {
        const slot = made.buffers;
        made.buffers += 1;
        const w = 4 + Math.round(next() * 20);
        const h = 4 + Math.round(next() * 16);
        steps.push({
          k: "grab",
          slot,
          box: [
            Math.round(next() * (WIDTH - w)),
            Math.round(next() * (HEIGHT - h)),
            w,
            h,
          ],
        });
        steps.push({
          k: "put",
          slot,
          at: [
            Math.round(next() * (WIDTH - w)),
            Math.round(next() * (HEIGHT - h)),
          ],
        });
      } else {
        steps.push({ k: "blit", at: [x(), y()] });
      }
    }
    script.push(steps);
  }
  return script;
}

/** Run one generated statement against a context. */
function perform(ctx: Ctx, bag: Bag, step: Step): void {
  const host = ctx as unknown as Record<string, unknown>;
  switch (step.k) {
    case "clear":
      clearFrame(ctx);
      return;
    case "style":
      host[step.which] = step.color;
      return;
    case "number":
    case "text-style":
      host[step.prop] = step.value;
      return;
    case "dash":
      ctx.setLineDash([...step.pattern]);
      ctx.lineDashOffset = step.offset;
      return;
    case "rect": {
      const [a, b, c, d] = step.box as [number, number, number, number];
      (host[step.op] as (...rest: number[]) => void).call(ctx, a, b, c, d);
      return;
    }
    case "path": {
      for (const op of step.ops) {
        (host[op.op] as (...rest: number[]) => void).apply(ctx, [...op.args]);
      }
      return;
    }
    case "clip": {
      // The transform is stated rather than inherited, and both it and the
      // rectangle are whole numbers, so the clip lands on whole device pixels.
      // See the note on the "clip taken under one transform" scenario: an
      // antialiased clip edge is a boundary pixel no frame can fully repaint, so
      // a generated clip that had one would report a difference on every seed
      // that is a fact about canvas antialiasing rather than about this format.
      const [tx, ty] = step.at as [number, number];
      ctx.setTransform(1, 0, 0, 1, tx, ty);
      const [a, b, c, d] = step.box as [number, number, number, number];
      ctx.beginPath();
      ctx.rect(a, b, c, d);
      ctx.clip();
      return;
    }
    case "paint":
      if (step.op === "fill") ctx.fill();
      else ctx.stroke();
      return;
    case "transform":
      (host[step.op] as (...rest: number[]) => void).apply(ctx, [...step.args]);
      return;
    case "save":
      ctx.save();
      return;
    case "restore":
      ctx.restore();
      return;
    case "gradient": {
      const [a, b, c, d, e, f] = step.args as number[];
      const paint =
        step.kind === "linear"
          ? ctx.createLinearGradient(a!, b!, c!, d!)
          : step.kind === "radial"
            ? ctx.createRadialGradient(a!, b!, c!, d!, e!, f!)
            : ctx.createConicGradient(a!, b!, c!);
      for (const [offset, color] of step.stops)
        paint.addColorStop(offset, color);
      bag.gradients.set(step.slot, paint);
      return;
    }
    case "stop": {
      bag.gradients.get(step.slot)?.addColorStop(step.offset, step.color);
      return;
    }
    case "use-gradient": {
      const paint = bag.gradients.get(step.slot);
      if (paint !== undefined) host[step.which] = paint;
      return;
    }
    case "pattern": {
      const source = surface(8, 8);
      // Opaque, and one flat colour: a pattern is carried as captured pixels, a
      // canvas holds premultiplied colour so only opaque pixels round-trip
      // exactly, and skia samples a canvas-backed pattern and an image-backed one
      // differently wherever a tile has an internal edge.
      source.fillStyle = step.color;
      source.fillRect(0, 0, 8, 8);
      bag.sources.set(step.slot, source);
      const paint = ctx.createPattern(source.canvas, step.repeat as "repeat");
      bag.patterns.set(step.slot, paint);
      return;
    }
    case "repaint": {
      const source = bag.sources.get(step.slot);
      if (source === undefined) return;
      source.fillStyle = step.color;
      source.fillRect(0, 0, 8, 8);
      return;
    }
    case "use-pattern": {
      const paint = bag.patterns.get(step.slot);
      if (paint !== undefined) host[step.which] = paint;
      return;
    }
    case "text": {
      const [a, b] = step.at as [number, number];
      (host[step.op] as (text: string, x: number, y: number) => void).call(
        ctx,
        step.value,
        a,
        b,
      );
      return;
    }
    case "grab": {
      const [a, b, c, d] = step.box as [number, number, number, number];
      bag.buffers.set(step.slot, ctx.getImageData(a, b, c, d));
      return;
    }
    case "put": {
      const buffer = bag.buffers.get(step.slot);
      if (buffer === undefined) return;
      const [a, b] = step.at as [number, number];
      ctx.putImageData(buffer, a, b);
      return;
    }
    case "blit": {
      const [a, b] = step.at as [number, number];
      ctx.drawImage(sprite, a, b);
      return;
    }
  }
}

/** A generated script, as a {@link Script} the rig can run twice. */
function scripted(steps: readonly (readonly Step[])[]): () => Script {
  return () => {
    const bag: Bag = {
      gradients: new Map(),
      patterns: new Map(),
      sources: new Map(),
      buffers: new Map(),
    };
    return {
      frames: steps.map((frame) => (ctx: Ctx) => {
        for (const step of frame) perform(ctx, bag, step);
      }),
    };
  };
}

/**
 * How many seeds run by default, and how to ask for more.
 *
 * Small enough that the suite stays fast on every change, and raised from the
 * environment when someone is hunting: `TCAB_REPLAY_PARITY_SEEDS=500 npx vitest run`
 * is the shape the reviewers' rigs had, and it is the shape that found the defects
 * this format was corrected for.
 */
const SEEDS = (() => {
  const host = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  const asked = Number(host.process?.env?.["TCAB_REPLAY_PARITY_SEEDS"]);
  return Number.isInteger(asked) && asked > 0 ? asked : 12;
})();

/** How many frames one generated script draws. */
const GENERATED_FRAMES = 4;

/**
 * How many seeds the coverage guard below samples.
 *
 * Fixed, and independent of how many seeds are being replayed. What it asks is
 * whether the generator still emits every part of the format, which a couple of
 * dozen scripts settle; running it over a sweep of thousands would answer the same
 * question and take as long as the sweep.
 */
const COVERAGE_SEEDS = 24;

/** The randomised sweep, and the guard that keeps the generator honest. */
function generatedScenarios(): void {
  describe("generated scripts replay pixel for pixel", () => {
    it("draw everything the format has to carry", () => {
      // A generator that quietly stopped emitting patterns, or clips, or a save the
      // next frame restores, would go on passing every seed and prove nothing. Each
      // part of the format the default seeds are meant to exercise is counted, so a
      // change that narrows the generator fails here instead of going unnoticed.
      const seen = {
        gradients: 0,
        patterns: 0,
        sprites: 0,
        buffers: 0,
        clips: 0,
        paths: 0,
        stacked: 0,
        dashes: 0,
      };
      for (let seed = 1; seed <= COVERAGE_SEEDS; seed += 1) {
        const { recording } = record(
          scripted(generate(random(seed), GENERATED_FRAMES)),
        );
        for (const resource of recording.resources) {
          if (resource.make.method === "createPattern") seen.patterns += 1;
          else seen.gradients += 1;
        }
        for (const image of recording.images) {
          if (image.kind === "pixels") seen.buffers += 1;
          // The sprite is the only bitmap that is not an eight-pixel pattern tile.
          else if (image.width === 16) seen.sprites += 1;
        }
        for (const state of recording.states) {
          seen.clips += state.clip.length;
          // A clip's prologue leaves `beginPath` and a `rect` current, so a path of
          // its own is one with more than that in it.
          seen.paths += state.path.filter(
            (segment) => segment.ops.length > 2,
          ).length;
          seen.dashes +=
            state.lineDash !== null && state.lineDash.length > 0 ? 1 : 0;
        }
        for (const frame of recording.frames)
          seen.stacked += frame.stack.length;
      }
      const drawn = Object.fromEntries(
        Object.entries(seen).map(([name, count]) => [name, count > 0]),
      );
      expect(drawn).toEqual({
        gradients: true,
        patterns: true,
        sprites: true,
        buffers: true,
        clips: true,
        paths: true,
        stacked: true,
        dashes: true,
      });
    });

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      it(`seed ${seed}`, async () => {
        const steps = generate(random(seed), GENERATED_FRAMES);
        await verify(
          scripted(steps),
          `seed ${seed}, replay it with TCAB_REPLAY_PARITY_SEEDS and this script:\n${JSON.stringify(steps)}`,
        );
      });
    }
  });
}
