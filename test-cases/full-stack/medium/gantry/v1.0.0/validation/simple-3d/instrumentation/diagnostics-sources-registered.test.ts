// instrumentation/diagnostics-sources-registered — the overlay reports the
// game's own figures, and follows them as they change.
//
// `specs/instrumentation.md` § Diagnostics: "The debug overlay shows the values
// the game registers with it as diagnostic sources. Register at least the current
// screen and site, the structure's member count, cost, and readiness issue count,
// the run's phase, step index, clock, and cause, each axis's value, the bob's
// position, the highest current utilization and the broken-member count, and the
// camera pose … and KEEP EVERY SOURCE A PURE READ."
//
// COUNTING THE SOURCES IS NOT THE READING, and cannot be. A build is free to pack
// several figures onto one line or to spread one over two, and it names them in
// its own words — so both a count and a search for particular words would be
// asserting a build's presentation rather than the requirement. What the
// requirement fixes is WHICH PARTS OF THE GAME the panel is a window onto.
//
// SO THE READING IS THAT IT FOLLOWS THEM. Three of the listed figures are changed
// one at a time — the screen, the camera pose, and the structure's member count —
// and after each the panel must report something it was not reporting before. A
// panel that is a window onto the game moves when the game does; one that draws a
// fixed card does not, whatever it says on it.
//
// EACH CHANGE IS MADE THROUGH THE SURFACE and is one the specification states:
// `setScreen` "shows a named screen", `setCamera` "sets the orbit camera's pose
// as the orbit controls set it", and `addMember` "places a member between the two
// lattice nodes".

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
} from "../harness";

/** The key the overlay is shown by (`specs/instrumentation.md`). */
const TOGGLE = "Backquote";

/** Two camera poses a player can reach (`specs/controls.md`). */
const FROM = { yaw: 0, pitch: 30, dist: 24 };
const TO = { yaw: 120, pitch: 45, dist: 18 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the panel is reporting now, as one comparable reading. */
const panel = async (): Promise<string> => (await h.diagnostics()).join("\n");

it("reports the game's own figures, and follows them as they change", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setCamera(FROM.yaw, FROM.pitch, FROM.dist);
  // Shown, because under no engine the overlay is the build's own and a panel
  // that is not drawn draws no text.
  await h.press(TOGGLE);
  await h.advance(1);

  const first = await panel();
  assertTrue(
    first.trim().length > 0,
    "the overlay to report something once it is shown " +
      "(specs/instrumentation.md)",
  );

  await h.debug.setCamera(TO.yaw, TO.pitch, TO.dist);
  await h.advance(1);
  const moved = await panel();

  await h.debug.setRing(0, 2, 0);
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.advance(1);
  const built = await panel();

  await h.debug.setScreen("program");
  await h.advance(1);
  const elsewhere = await panel();

  await h.capture("panel", "The overlay reporting the game's own figures");

  assertTrue(
    moved !== first,
    "the overlay to follow the camera pose, which is one of the figures " +
      "specs/instrumentation.md lists — it reported the same thing before and " +
      "after the camera moved",
  );
  assertTrue(
    built !== moved,
    "the overlay to follow the structure's member count — it reported the " +
      "same thing before and after a member was placed",
  );
  assertTrue(
    elsewhere !== built,
    "the overlay to follow the current screen — it reported the same thing on " +
      "the build screen and the program screen",
  );
});
