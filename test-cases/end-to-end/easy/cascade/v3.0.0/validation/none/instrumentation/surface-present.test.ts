// instrumentation/surface-present — every operation the specification names is a
// function on the surface the build installed.
//
// THE RULE. `specs/instrumentation.md` makes the surface a deliverable: "the
// build installs the finished surface on `window.__cascade` as soon as the game
// has initialized", and "Every scenario driven from code reaches the game through
// it, so it is present and exactly as specified here." Under this engine that
// includes the two clock operations, `setAutoStep` and `advance`, and the
// `setMuted` that exists only where nothing outside the build owns the mute bit.
//
// WHY IT IS `broken`. Every other point in this suite reaches the game through
// this surface, so a build missing one operation loses the points that operation
// carries and this one besides — and the failure below names the operation rather
// than leaving fifty checks to fail on a call that was never there.
//
// IT IS REFLECTION AND NOTHING ELSE. Each name is read with `typeof`, invoking
// nothing, so a build whose operations throw is still told which ones it has.
// That the surface is WIRED to the running game is
// `instrumentation/surface-live`'s, and the version it reports is
// `instrumentation/surface-version`'s.
//
// THE LIST IS `REQUIRED_OPS`, which `harness.ts` states in the order
// `specs/instrumentation.md` names them, so a build missing anything is named for
// exactly what it is missing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  failSurface,
  openTable,
  REQUIRED_OPS,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every documented operation as a function", async () => {
  // The surface itself first, so a build that installed nothing — or something
  // incomplete — is named for exactly that rather than failing later on a call
  // it never had.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  const probed = await h.probe(REQUIRED_OPS);

  await openTable(h);
  await h.advance(1);
  // Before the assertions, so a missing operation still leaves the picture of
  // the table the surface was read off.
  await captureStill(h, "surface");

  for (const op of REQUIRED_OPS) {
    assertEqual(
      probed.ops[op],
      "function",
      `typeof window.__cascade.${op}, an operation specs/instrumentation.md ` +
        `requires on the surface`,
    );
  }
});
