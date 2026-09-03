// assets/everything-else-drawn-in-code — the produced files are the only files,
// and everything else on screen is drawn in code.
//
// specs/assets.md, "What is drawn in code": "Everything else on screen is drawn
// in code, with no produced file behind it: the yard's ground, sky, and light;
// the lattice and envelope aids; the members, each as real drawn geometry
// telling strut, cable, and rail apart, colored by utilization during a run; the
// hoist cable; the pads and their yaw marks; every readout, menu, and screen;
// and the debug overlay. The produced models sit in that scene; the scene itself
// is the build's."
//
// HOW A DRAWING THAT IS NOT DRAWN IN CODE SHOWS UP. It arrives as a file: a
// sprite sheet for the readouts, a texture for the ground, a skybox, an icon set
// for the tool palette, a font. So the reading is the set of ASSET FILES the
// played site fetched, and the requirement is that it is exactly the produced
// set specs/assets.md lists — the eight `.glb` models and the twelve `.wav`
// sounds, being the eleven cues of `specs/ui.md` and the music bed — with no
// model, audio, image or font file beside them.
//
// EVERY SCREEN AND A WHOLE RUN, because a file behind one screen would only be
// fetched on reaching it and a build is free to fetch late. The title, howto and
// select screens are shown, a site is opened, a structure is edited and part of
// it removed, a run is driven into a collapse — which sounds `creak`, `break`,
// `collapse` and `fail` and shows the failure copy — and a second run clears the
// site, which sounds `complete` and shows the results screen.
//
// THE DEBUG OVERLAY IS NOT DRIVEN. Under this engine the overlay is the engine's
// own — "Drawing the panel, showing and hiding it with the backtick key… are the
// engine's" (specs/instrumentation.md § Diagnostics) — so a file behind it would
// not be the build's file at all.
//
// THE REQUEST LIST IS THIS ENGINE'S HALF OF THE POINT. There is no page here:
// this project stands the engine up in this process, and `h.assetRequests()`
// carries every path the build has fetched since it was initialized, including
// the ones its own `initialize` made before a check could look. Under this engine
// those requests are the engine's asset loader's, because `specs/assets.md`
// leaves the build no other door: "Load each model through that loader rather
// than fetching a URL of your own… No part of the build decodes glTF itself, and
// nothing else fetches an asset."

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  DESIGNS,
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";

/** The site whose reference design and tape clear it (`designs.json`). */
const SITE = 0;

/** Ticks per crossing while a run plays out, and the cap on one run. */
const STRIDE = 30;
const MAX_TICKS = 7200;

/** Enough tape for a run to start and keep ticking. */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 4, rate: HOIST_MAX_RATE },
    ],
  },
];

/**
 * A mass no minimal crane carries, so the run this hangs it from breaks members
 * and comes down: the path that sounds `creak`, `break`, `collapse` and `fail`.
 */
const CRUSHING_MASS = 200_000;

/** The eight produced models and the twelve produced sounds (specs/assets.md). */
const MODEL_COUNT = 8;
const AUDIO_COUNT = 12;

/**
 * What counts as an asset file: anything a scene, a screen or a sound could be
 * drawn or played from. `.js`, `.css`, `.html`, `.map` and data files are the
 * build's own code and are not what this point is about.
 */
const ASSET_FILE =
  /\.(glb|gltf|bin|obj|fbx|dae|stl|ply|usdz|wav|mp3|ogg|oga|opus|m4a|aac|flac|weba|mid|midi|png|jpg|jpeg|gif|webp|avif|bmp|svg|ktx|ktx2|basis|dds|tga|hdr|exr|ttf|otf|woff|woff2|eot)$/i;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fetches the eight models and the twelve sounds and no other asset file", async () => {
  for (const screen of ["title", "howto", "select"] as const) {
    await h.debug.setScreen(screen);
    await h.advance(1);
  }

  // A run that collapses: the failure screens, the breakage colors, and the
  // cues a build might have held a file back for.
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, MINIMAL_CRANE);
  await h.debug.removeMember(MINIMAL_CRANE.members.length - 1);
  await poseCrane(h, MINIMAL_CRANE);
  await addOneLoad(
    h,
    "crate",
    CRUSHING_MASS,
    { x: 3, y: 2, z: 0, yaw: 0 },
    { x: -3, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  let broke = "running";
  for (let ran = 0; ran < MAX_TICKS; ran += STRIDE) {
    const state = await runTicks(h, STRIDE);
    broke = state.run.phase;
    if (broke !== "running") break;
  }
  assertTrue(
    broke === "failed",
    "the overloaded crane to come down, so the failure path's screens and " +
      `cues are reached before the request buffer is read — the run is "${broke}"`,
  );
  await h.advance(1);

  // And a run that clears the site: the `complete` cue and the results screen.
  await openSite(h, SITE);
  // A site keeps its tape, so the collapse run's tape is emptied before the
  // reference tape is appended; `clearAll` also empties the yard, and opening
  // the site puts that site's authored loads back below.
  await clearAll(h);
  await openSite(h, SITE);
  const design = DESIGNS[SITE]!;
  await poseCrane(h, design);
  await poseTape(h, design.tape);
  await h.debug.setScreen("program");
  await h.advance(1);
  await h.debug.setScreen("build");
  await startRun(h);
  let cleared = "running";
  for (let ran = 0; ran < MAX_TICKS; ran += STRIDE) {
    const state = await runTicks(h, STRIDE);
    cleared = state.run.phase;
    if (cleared !== "running") break;
  }
  assertEqual(
    cleared,
    "cleared",
    `the reference tape for site ${SITE + 1} to clear it, so the results ` +
      "screen is reached before the request buffer is read",
  );
  await h.advance(1);

  const paths = [...new Set(h.assetRequests().map((one) => one.path))]
    .filter((path) => ASSET_FILE.test(path))
    .sort();

  const models = paths.filter((path) => /\.(glb|gltf)$/i.test(path));
  const audio = paths.filter((path) => /\.(wav)$/i.test(path));
  const other = paths.filter(
    (path) => !models.includes(path) && !audio.includes(path),
  );

  assertEqual(
    other.join(", "),
    "",
    "no asset file beside the produced models and sounds, since the ground, " +
      "sky and light, the aids, the members, the cable, the pads, every " +
      "readout, menu and screen and the overlay are all drawn in code " +
      "(specs/assets.md) — these were fetched as well",
  );
  assertEqual(
    models.length,
    MODEL_COUNT,
    "the produced `.glb` models the played site fetched (specs/assets.md " +
      `lists eight) — it fetched [${models.join(", ")}]`,
  );
  assertEqual(
    audio.length,
    AUDIO_COUNT,
    "the produced `.wav` sounds the played site fetched (specs/assets.md " +
      "lists eleven cues and the music bed) — it fetched " +
      `[${audio.join(", ")}]`,
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      paths.join("\n  "),
  );

  await h.capture("requests", "Every asset the played-through site requested");
});
