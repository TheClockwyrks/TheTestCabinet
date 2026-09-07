// instrumentation/structure-pose-off-the-build-screen-does-nothing — a structure
// pose reaches the open site's structure from every screen.
//
// `specs/instrumentation.md` § The operations: "No operation asks which screen is
// showing, whether a run is in progress, or which tool is selected. Those are how
// a player reaches a control and are not an operation's conditions, so an
// operation acts from wherever the game stands: a structure pose edits the open
// site's structure with the program screen up". § The structure says the same of
// these five: "the build screen is how a player reaches the tools and is not a
// condition here, so these edit the open site's structure whatever screen is
// showing."
//
// EVERY SCREEN THE POINT NAMES IS DRIVEN, because the screens are not alike: the
// program screen is the tape editor's, and the run screen is the one a run is
// watched on, so a build that gated the structure poses on "not a menu screen" or
// on "not mid-run" would pass on some of these and fail on others. Each screen is
// reached with `setScreen`, which "shows a named screen and sets nothing else",
// so nothing but the screen differs between the passes.
//
// THE FIVE CALLS ARE ALL ONES THE EDITOR'S OWN RULES TAKE. What rule B removes is
// the reach — the screen — and not the edit's own rule, which is the edit rather
// than a gate on reaching it. So the member placed is legal against
// `specs/structure.md`, the removed id is one the structure carries, the pending
// node is a lattice node, and `clearStructure` "is refused by nothing". A build
// that quietly declined any of them on the strength of the screen leaves the
// structure empty and the tool unmoved, which is what this reads.

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

it("edits the open site's structure from every screen", async () => {
  await openSite(h, 0);
  await clearAll(h);

  for (const screen of OTHER_SCREENS) {
    await h.debug.setScreen(screen);
    // A leg from an anchor to the lattice node above it: legal against
    // specs/structure.md on an empty structure, so nothing but the screen could
    // hold it off. `clearStructure` returns `nextMemberId` to `0` first, so the
    // member this places carries id 0 whichever pass it is.
    await h.debug.clearStructure();
    await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
    await h.debug.setTool("cable");
    await h.debug.setPendingNode(0, 2, 0);
    await h.debug.reconcile();

    const placed = await h.snapshot();
    assertLength(
      placed.structure.members,
      1,
      `the members addMember placed from the ${screen} screen, which is a ` +
        "player's route to the tools and not the operation's condition " +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      placed.tool,
      "cable",
      `the tool setTool selected from the ${screen} screen ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      JSON.stringify(placed.pendingNode),
      JSON.stringify({ x: 0, y: 2, z: 0 }),
      `the node setPendingNode held from the ${screen} screen ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      placed.historyDepth > 0,
      true,
      `the history the landed edit pushed from the ${screen} screen: "Each ` +
        'edit that lands pushes the undo history exactly as a click would"',
    );

    await h.debug.clearPendingNode();
    await h.debug.removeMember(0);
    await h.debug.reconcile();
    assertLength(
      (await h.snapshot()).structure.members,
      0,
      `the members left after removeMember from the ${screen} screen ` +
        "(specs/instrumentation.md)",
    );
  }

  // The picture: the structure a pose made from the results screen stands in.
  await h.debug.setScreen("build");
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.reconcile();
  const standing = await h.snapshot();
  await h.capture("state", "the structure a pose reached from every screen");
  assertLength(
    standing.structure.members,
    1,
    "the member the same call places on the build screen, which is the same " +
      "call every screen above took",
  );
});
