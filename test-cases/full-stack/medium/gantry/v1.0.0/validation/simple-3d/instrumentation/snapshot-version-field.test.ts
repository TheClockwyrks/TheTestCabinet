// instrumentation/snapshot-version-field — every snapshot carries version 1.
//
// `specs/instrumentation.md` § The operations: "The surface carries `version`
// (`GANTRY_DEBUG_VERSION`, `1`), a plain number", and § Snapshot shape opens the
// object it returns with `version: 1`. So the number is fixed, and it is a plain
// number rather than a string a caller would have to parse.
//
// § Snapshot shape also says "The shape is fixed and every field is present
// whatever the screen", so the reading is taken on two screens — the title screen
// a reset leaves, and the build screen a site opening shows. Nothing else is
// posed: a version is a fact about the surface rather than about a scenario, so
// the isolated world here is the one the harness's own reset stands the game up
// in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GANTRY_DEBUG_VERSION } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports version 1 as a plain number, on every screen", async () => {
  const title = await h.snapshot();
  assertEqual(
    typeof title.version,
    "number",
    "the type of snapshot().version (specs/instrumentation.md: a plain number)",
  );
  assertEqual(
    title.version,
    GANTRY_DEBUG_VERSION,
    "snapshot().version on the title screen",
  );

  await openSite(h, 0);
  const build = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    build.version,
    GANTRY_DEBUG_VERSION,
    "snapshot().version on the build screen, the shape being fixed whatever " +
      "the screen",
  );
});
