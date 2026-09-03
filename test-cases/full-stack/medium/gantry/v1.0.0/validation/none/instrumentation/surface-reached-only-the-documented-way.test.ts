// instrumentation/surface-reached-only-the-documented-way — the surface is where
// the specification says it is, from the moment the game has initialized.
//
// specs/instrumentation.md § The operations, the `none` branch: "the build
// installs the finished surface on `window.__gantry` as soon as the game has
// initialized." That is the whole contract on this build: one documented handle,
// and it is there before anything drives the game. (Under an engine the same
// sentence reads the other way — the surface is `engine.debug` and "nothing is
// installed on the page" — and there is no engine here to hold it instead.)
//
// TWO READINGS, AND THE SECOND IS THE ONE WITH TEETH. `window.__gantry` carrying
// the surface is read off the page. That it was carrying it "as soon as the game
// has initialized" is read off the opening snapshot: the harness takes one
// through the surface after the page has loaded and BEFORE it resets the game or
// advances a single frame, so a build that installed its handle on its first
// frame, or after its first input, would have had nothing to answer with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { HANDLE, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("installs the surface on window.__gantry as soon as the game has initialized", async () => {
  const handle = await h.page.evaluate((name) => {
    const held = (window as unknown as Record<string, unknown>)[name];
    return {
      kind: held === null ? "null" : typeof held,
      snapshot: typeof (held as Record<string, unknown> | undefined)?.snapshot,
    };
  }, HANDLE);

  assertEqual(handle.kind, "object", `the type of window.${HANDLE}`);
  assertEqual(
    handle.snapshot,
    "function",
    `window.${HANDLE}.snapshot, so what the handle carries is the surface`,
  );

  // Read through that handle before this harness reset the game or drove a
  // frame: the surface answered from the moment the page had loaded.
  assertNotNull(
    h.openingSnapshot,
    `the reading taken through window.${HANDLE} before anything was driven ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    typeof h.openingSnapshot?.screen,
    "string",
    "the screen that opening reading reported, so it was a real snapshot",
  );

  await h.advance(1);
  await h.capture(
    "surface-handle",
    "The build carrying its surface on the documented handle",
  );
});
