// instrumentation/structure-pose-off-the-build-screen-does-nothing — a structure
// pose lands on the build screen and nowhere else.
//
// `specs/instrumentation.md` § The operations: "Each pose applies on the screens
// its section names and does nothing on any other, exactly as the control it
// stands for does", and § The structure names one screen for all of them: "These
// pose single edits on the build screen, entering the rule pipeline the build tools
// feed". So `addMember`, `setRing`, `addCounterweight`, `removeMember` and
// `clearStructure` change nothing on the other six screens.
//
// EVERY SCREEN THE POINT NAMES IS DRIVEN, because the screens are not alike: the
// program screen is an editing screen where the SITE poses do apply, and the run
// screen is the one a run is watched on, so a build that gated the structure poses
// on "not a menu screen" or on "not mid-run" would pass on some of these and fail
// on others. Each screen is reached with `setScreen`, which "shows a named screen
// and sets nothing else", so nothing but the screen differs between the passes.
//
// THE FIVE CALLS ARE ALL ONES THAT WOULD LAND. A pose that the editor's rules would
// refuse anyway proves nothing about the screen, so the member, the ring node and
// the counterweight node are all legal against `specs/structure.md` on this
// structure, the removed id exists, and `clearStructure` "is refused by nothing".
// The last step of the check is that same `clearStructure` on the build screen,
// which empties the structure — the control that says these calls were live all
// along and the screen is what held them off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Screen,
} from "../harness";

/** Every screen but `build` (`specs/ui.md`), in the order the point names them. */
const OTHER_SCREENS: readonly Screen[] = [
  "program",
  "run",
  "title",
  "select",
  "howto",
  "results",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing when a structure pose is made off the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  // Two legs from two anchors to the ring's bottom flange: they give the check a
  // member to remove (id 0), a node a counterweight may stand on, and a base the
  // ring at (0, 2, 0) joins nothing across (specs/structure.md).
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut");

  const before = await h.snapshot();
  const structure = JSON.stringify(before.structure);

  for (const screen of OTHER_SCREENS) {
    await h.debug.setScreen(screen);
    await h.debug.addMember(0, 0, 2, 0, 2, 2, "strut");
    await h.debug.setRing(0, 2, 0);
    await h.debug.addCounterweight(0, 2, 0);
    await h.debug.removeMember(0);
    await h.debug.clearStructure();

    const after = await h.snapshot();
    assertEqual(
      JSON.stringify(after.structure),
      structure,
      `the structure across the five structure poses on the ${screen} screen ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      after.historyDepth,
      before.historyDepth,
      `historyDepth across the five structure poses on the ${screen} screen: ` +
        "an edit that lands pushes the history, and none of these landed",
    );
  }

  // The control: the same call, on the screen its section names, lands.
  await h.debug.setScreen("build");
  await h.debug.clearStructure();
  const emptied = await h.snapshot();
  await h.capture(
    "state",
    "the structure the build screen's own clear emptied",
  );
  assertLength(
    emptied.structure.members,
    0,
    "the members clearStructure removes on the build screen, where the " +
      "structure poses apply",
  );
});
