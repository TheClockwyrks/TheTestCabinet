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
// EVERY SCREEN AND TWO WHOLE RUNS, because a file behind one screen would only be
// fetched on reaching it and a build is free to fetch late. The title, howto and
// select screens are shown, a site is opened, a structure is edited and part of
// it removed, a run is driven into a collapse — which sounds `creak`, `break`,
// `collapse` and `fail` and shows the failure copy — and a second run clears the
// site, which sounds `attach`, `placed` and `complete` and shows the results
// screen.
//
// AND BOTH RUNS ARE THE SHORTEST THAT REACH WHAT THEY ARE FOR. What this point
// needs of a run is the screens it passes and the cues it sounds, never the lift
// it performs. So both run on the smallest crane that stands: the first hangs a
// mass no crane carries and comes down within a second, and the second draws the
// cable in, takes the load waiting at the hook's own resting point and sets it
// down on the pad it is already standing on — a clear in some fifty ticks.
// Playing site 1's reference design and reference tape instead sounds the same
// cues and shows the same screens through a fifty-nine-member solve run a
// thousand times, and makes this point turn on a lift that has validators of its
// own: a build whose reference run misses its pad would fail this one for it.
//
// THE DEBUG OVERLAY IS NOT DRIVEN. specs/instrumentation.md leaves the overlay's
// toggle to the runtime layer the build writes and `specs/controls.md` binds no
// action to it, so there is no specified way for a validator to raise it; a
// build that drew it from a produced file would be caught by the same file
// showing up in a request the moment the overlay was raised, but no validator can
// raise it without asserting a binding the specification does not fix.
//
// THE REQUEST BUFFER IS THE PAGE'S OWN, so files fetched while the bundle was
// booting — before a validator could attach a listener — are counted too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
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
import { HOIST_MAX_RATE, HOIST_MIN, HOIST_START } from "../constants";

/** The site both runs play on; every site plays the same way. */
const SITE = 0;

/** Ticks per crossing while a run plays out, and the cap on one run. */
const STRIDE = 10;
const MAX_TICKS = 600;

/** Enough tape for a run to start and keep ticking. */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 4, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The crate the clearing run lifts. */
const MASS = 40;

/**
 * Where the bare hook comes to rest once the cable is drawn in to `HOIST_MIN`.
 *
 * The minimal crane's pivot is its track origin `(0, 4, 0)`, so a cable of
 * `HOIST_MIN` hangs the bob at `(0, 3, 0)` — which is where the crate waits and
 * where its pad is, so the attach is at a distance of zero and the release is
 * inside every set-down tolerance by the whole of it (specs/rigging.md).
 */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

/** Draw the cable in, take the load, set it down — and the site is cleared. */
const CLEARING_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
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

  // One edit taken back and put again, for the two cues an edit sounds. Putting
  // the one member back costs a single crossing where posing the whole crane
  // again costs twenty-three, and the crane standing at the end is the same one.
  const last = MINIMAL_CRANE.members[MINIMAL_CRANE.members.length - 1]!;
  await h.debug.removeMember(MINIMAL_CRANE.members.length - 1);
  await h.debug.addMember(
    last[0][0],
    last[0][1],
    last[0][2],
    last[1][0],
    last[1][1],
    last[1][2],
    last[2],
  );

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

  // And a run that clears the site: the `attach` and `placed` cues, the
  // `complete` cue, and the results screen.
  //
  // `openSite` puts the run back to its idle placeholder and the site's authored
  // loads back in the yard, and leaves the structure standing — so the crane the
  // collapse ran on is the crane this run uses, and only the yard and the tape
  // are posed again. A site keeps its tape, so the collapse run's is emptied
  // before the clearing tape is appended.
  await openSite(h, SITE);
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  // The one frame the program screen is drawn on, taken while the screen is
  // already showing: whatever a build draws there is fetched by now.
  await h.advance(1);
  await h.debug.setScreen("build");
  await h.debug.clearObstacles();
  await addOneLoad(h, "crate", MASS, HOOK, HOOK);
  await poseTape(h, CLEARING_TAPE);
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
    `the three-step tape to clear site ${SITE + 1} within ${MAX_TICKS} ticks, ` +
      "so the results screen is reached before the request buffer is read",
  );
  await h.advance(1);

  const fetched = (await h.page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  )) as string[];

  const paths = [...new Set(fetched)]
    .map((url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })
    .filter((path) => ASSET_FILE.test(path))
    .sort();

  const models = paths.filter((path) => /\.(glb|gltf)$/i.test(path));
  const audio = paths.filter((path) => /\.(wav)$/i.test(path));
  const other = paths.filter(
    (path) => !models.includes(path) && !audio.includes(path),
  );

  await h.capture("requests", "Every asset the played-through site requested");

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
});
