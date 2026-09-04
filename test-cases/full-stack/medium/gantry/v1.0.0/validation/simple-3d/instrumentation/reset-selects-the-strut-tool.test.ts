// instrumentation/reset-selects-the-strut-tool — a reset leaves the strut tool
// selected, whatever tool was chosen before it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: … every site's
// stored structure and tape emptied, the open site's loads and obstacles back to
// the ones `specs/sites.md` gives it, the strut tool, no pending node, …". The
// snapshot reports the selection as `tool`.
//
// ANOTHER TOOL IS SELECTED FIRST, through the pose that stands for the tool
// actions: "`setTool(tool)` selects a build tool, as the tool actions do". The
// tool poses are the build screen's — "These pose single edits on the build
// screen" — so the check stands there, which is where `openSite` leaves it. The
// `delete` tool is the one furthest from a placement tool, so a build that only
// re-picked among the three materials still fails here.
//
// The world is cleared first: a selected tool acts on nothing until something is
// clicked, and nothing about which tool is selected concerns the yard or the
// crane standing in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the strut tool", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("delete");
  assertEqual(
    (await h.snapshot()).tool,
    "delete",
    "the tool setTool posed, before the reset",
  );

  await h.debug.reset();
  const tool = (await h.snapshot()).tool;
  await h.advance(1);
  await h.capture("tool", "The build tool a reset leaves selected");

  assertEqual(
    tool,
    "strut",
    "the tool a reset leaves selected (specs/instrumentation.md)",
  );
});
