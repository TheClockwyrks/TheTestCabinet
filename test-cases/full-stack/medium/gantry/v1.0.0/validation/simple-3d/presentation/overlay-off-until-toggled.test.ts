// presentation/overlay-off-until-toggled — the debug overlay is not drawn until
// the backtick key is pressed.
//
// specs/instrumentation.md § Diagnostics, in its engineless branch: "The overlay
// is part of the runtime layer you write. It draws the registered sources, it is
// shown and hidden by the backtick key (`KeyboardEvent.code` `Backquote`), IT IS
// OFF UNTIL TOGGLED, and it reads the game without changing it." So what a player
// sees on load is the game's own display and nothing else.
//
// UNDER THIS ENGINE THE PANEL ITSELF IS THE ENGINE'S, AND THE POINT STILL BITES.
// specs/instrumentation.md § Diagnostics reads the other way here: "Registering
// those values is the whole of Gantry's part, through `InitApi.diagnostics`...
// Drawing the panel, showing and hiding it with the backtick key
// (`KeyboardEvent.code` `Backquote`), and keeping it read-only are the engine's."
// What a build can still get wrong is standing in the way of it — binding
// `Backquote` to something of its own, registering no source for the panel to
// draw, or registering one that writes as it reads — and each of those fails this
// reading exactly as an engineless build's own overlay would.
// THE READING IS TAKEN WHERE THE GAME LOADS, on the title screen, before any
// input reaches the game. The harness has pressed one key the game binds to
// nothing (specs/controls.md) to arm the page's audio, and nothing else.
//
// TELLING THE TWO STATES APART IS THE WHOLE PROBLEM, and pixels alone cannot do
// it: pressing the key changes the picture whichever way round the overlay
// started, and what a panel looks like is the build's own. What separates them is
// what the panel IS — "The debug overlay shows the values the game registers with
// it as diagnostic sources. Register at least the current screen and site... AND
// THE CAMERA POSE." So the region the key draws over is put to that test. The
// camera is posed somewhere else entirely, and:
//
//   - a stage that is REPORTING the camera pose redraws that region, because
//     every number in the line changed;
//   - a stage that is only drawing the game does not, because no screen in
//     specs/ui.md shows the camera's numbers.
//
// The title screen is where this reads cleanest: what it is required to draw —
// `TITLE_TEXT`, `TAGLINE_TEXT` and the menu (specs/ui.md § Title) — carries
// nothing of the camera, so the picture stands still under a pose that the
// overlay would answer.
//
// THE FIGURES. The region compared is the region the key itself changed, so this
// asks nothing about where a build puts its panel. Two dozen pixels is the floor
// for "reported": a line of legible text whose every number has changed cannot
// move fewer than that at the logical stage size. And the state before the press
// has to report it several times less than the state after, which is what says
// the panel appeared on the press rather than went away on it.

//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE PICTURE IS READ. Under this engine
// the panel is drawn on the engine's own screen layer — step 9 of its frame, "the
// diagnostics overlay draws on the screen layer, in device space" — which is the
// 2D layer `specs/overview.md` puts every readout on, and which this harness owns
// as a real canvas. So the reading is that layer's pixels rather than the page's
// composited frame; the yard beneath is rendered through WebGL, which this process
// has no driver for, and the panel is not in it either way. The requirement, the
// scenario and every figure below are unchanged.

// WHY THIS ONE STILL READS THE PICTURE, when nothing else in this project does.
//
// Every other check about drawing asks `drawn()`, which is the frame's own
// account of what it put on screen. This one cannot: what it is about is the
// DEBUG OVERLAY, and `specs/instrumentation.md` gives the panel to a different
// owner on each engine — "The overlay is part of the runtime layer you write"
// with no engine, and "Drawing the panel, showing and hiding it with the backtick
// key … are the engine's" under both of them. So under two of the three engines
// the panel is not the build's drawing at all, and there is nothing for a build
// to report about it. Neither engine exposes whether its panel is up.
//
// The picture is therefore the only instrument that answers the same question on
// all three, and the question — is the panel there — is one a reader can settle
// at a glance from the still beside the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
} from "../constants";
import { createHarness, type Harness } from "../harness";

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

/** A camera pose with every number different, inside the limits it is clamped to. */
const MOVED_CAMERA = { yaw: 100, pitch: 70, dist: 70 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** How far a colour must move to count as redrawn by the camera pose. */
const MOVED = 30;

/** The share of the stage the key must draw over for there to be a region. */
const PANEL_SHARE = 0.002;

/** Pixels of the region that must answer a camera pose once the panel is up. */
const REPORTED = 24;

/** How many times less the region may answer it before the key is pressed. */
const FACTOR = 3;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function picture(harness: Harness): Picture {
  const { width, height } = harness.screen;
  const { data } = harness.screen
    .getContext("2d")
    .getImageData(0, 0, width, height);
  return { width, height, data };
}

/** Every pixel `b` draws differently from `a`, as a mask. */
function differenceMask(a: Picture, b: Picture, gap: number): Uint8Array {
  const mask = new Uint8Array(a.width * a.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const i = pixel * 4;
    const apart = Math.hypot(
      a.data[i]! - b.data[i]!,
      a.data[i + 1]! - b.data[i + 1]!,
      a.data[i + 2]! - b.data[i + 2]!,
    );
    if (apart > gap) mask[pixel] = 1;
  }
  return mask;
}

/** How many pixels of `mask` are also in `within`. */
function countWithin(mask: Uint8Array, within: Uint8Array): number {
  let count = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] === 1 && within[pixel] === 1) count += 1;
  }
  return count;
}

/** How many pixels a mask holds. */
function count(mask: Uint8Array): number {
  let total = 0;
  for (const pixel of mask) total += pixel;
  return total;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no overlay before the backtick key is pressed", async () => {
  await h.advance(1);
  await h.capture("off", "The stage with the overlay hidden");

  const opening = await h.snapshot();
  assertEqual(
    opening.screen,
    "title",
    "the screen a loaded game stands on, which this reading is taken on " +
      "(specs/ui.md § Title)",
  );
  assertEqual(
    opening.camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw this reading starts from (specs/state.md)",
  );

  /** The stage as it stands, and the stage with the camera posed elsewhere. */
  const underACameraPose = async (): Promise<[Picture, Picture]> => {
    await h.debug.setCamera(
      CAMERA_START_YAW,
      CAMERA_START_PITCH,
      CAMERA_START_DIST,
    );
    await h.advance(1);
    const held = picture(h);
    await h.debug.setCamera(
      MOVED_CAMERA.yaw,
      MOVED_CAMERA.pitch,
      MOVED_CAMERA.dist,
    );
    await h.advance(1);
    const posed = picture(h);
    return [held, posed];
  };

  const [beforeHeld, beforePosed] = await underACameraPose();
  await h.press(TOGGLE);
  await h.advance(1);
  const [afterHeld, afterPosed] = await underACameraPose();

  // The region the key itself draws over: wherever this build puts its panel.
  const region = differenceMask(beforeHeld, afterHeld, CHANGED);
  const pixels = beforeHeld.width * beforeHeld.height;
  assertGreaterThan(
    count(region) / pixels,
    PANEL_SHARE,
    `the share of the stage the ${TOGGLE} key draws over on the title ` +
      "screen, which this reading needs in order to have a panel to ask " +
      "about: the overlay is shown by the backtick key and draws the sources " +
      "the specification asks a build to register (specs/instrumentation.md " +
      "§ Diagnostics)",
  );

  const reportedAfter = countWithin(
    differenceMask(afterHeld, afterPosed, MOVED),
    region,
  );
  const reportedBefore = countWithin(
    differenceMask(beforeHeld, beforePosed, MOVED),
    region,
  );

  assertGreaterThan(
    reportedAfter,
    REPORTED,
    "the pixels of that region that answer a camera pose once the key has " +
      "been pressed, which is what says the panel standing there is the " +
      "overlay reporting the game: the camera pose is one of the sources " +
      "§ Diagnostics requires registered (specs/instrumentation.md)",
  );

  assertLessThan(
    reportedBefore,
    reportedAfter / FACTOR,
    `the pixels of that same region that answered the same camera pose ` +
      "BEFORE the key was pressed, of the " +
      `${reportedAfter} that answer it after: on load the stage carries the ` +
      "game's own display, which shows the camera's numbers nowhere " +
      "(specs/ui.md), and the overlay is off until toggled " +
      "(specs/instrumentation.md § Diagnostics)",
  );
});
