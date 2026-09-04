// instrumentation/surface-version — the surface reports its version, as a plain
// number.
//
// THE RULE. specs/instrumentation.md, The operations: "The surface carries
// `version` (`CASCADE_DEBUG_VERSION`, `1`), a plain number, and the operations
// below."
//
// WHY IT IS ITS OWN POINT, AND WHY IT IS `broken`. It is the one member of the
// surface that says WHICH surface a build implemented, so a reviewer reading a
// run against a future revision of this file can tell a build that implemented
// the contract from one that implemented an older one. It fails independently of
// the operations — a build can carry every operation and no version, or a version
// and no operations — and `instrumentation/surface-present` is the point that
// grades the operations.
//
// IT IS READ BY REFLECTION, invoking nothing: the value is a property rather than
// a call, and a build that installed a function there has not carried "a plain
// number".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";
import { CASCADE_DEBUG_VERSION } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries version as the number the specification fixes", async () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  openTable(h);
  await h.advance(1);
  // Before the assertions, so a wrong version still leaves the picture of the
  // table it was read off.
  captureStill(h, "version");

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, CASCADE_DEBUG_VERSION, "CASCADE_DEBUG_VERSION");
});
