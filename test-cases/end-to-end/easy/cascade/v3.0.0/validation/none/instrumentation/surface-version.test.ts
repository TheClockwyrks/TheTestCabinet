// instrumentation/surface-version — the surface reports its version, as a plain
// number.
//
// THE RULE. `specs/instrumentation.md`, The operations: "The surface carries
// `version` (`CASCADE_DEBUG_VERSION`, `1`), a plain number, and the operations
// below."
//
// WHY IT IS ITS OWN POINT, AND WHY IT IS `broken`. It is the one member of the
// surface that says WHICH surface a build installed, so a reviewer reading a run
// against a future revision of this file can tell a build that implemented the
// contract from one that implemented an older one. It fails independently of the
// operations — a build can carry every operation and no version, or a version and
// no operations — and `instrumentation/surface-present` is the point that grades
// the operations.
//
// IT IS READ BY REFLECTION, invoking nothing: the value is a property rather than
// a call, and a build that installed a function there has not carried "a plain
// number".
//
// THE SURFACE FAULT IS NAMED FIRST, so a build that installed nothing at all is
// reported for exactly that rather than failing on a read it never had.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CASCADE_DEBUG_VERSION } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries version as the number the specification fixes", async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  // Reflection through a read that invokes nothing.
  const probed = await h.probe([]);

  await openTable(h);
  await h.advance(1);
  // Before the assertions, so a wrong version still leaves the picture of the
  // table it was read off.
  await captureStill(h, "version");

  assertEqual(
    typeof probed.version,
    "number",
    "typeof window.__cascade.version, which specs/instrumentation.md carries " +
      "as a plain number",
  );
  assertEqual(
    probed.version,
    CASCADE_DEBUG_VERSION,
    `window.__cascade.version, which specs/instrumentation.md fixes as ` +
      `CASCADE_DEBUG_VERSION (${CASCADE_DEBUG_VERSION})`,
  );
});
