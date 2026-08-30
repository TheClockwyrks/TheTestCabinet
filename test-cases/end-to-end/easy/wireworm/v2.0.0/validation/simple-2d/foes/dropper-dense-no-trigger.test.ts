// Wireworm — foes.dropper-dense-no-trigger, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A dense lower field draws none
//
// With setFoeSpawning(true) at level 3 and thirty nodes in rows 10..19, no
// dropper appears over ten seconds. The glitch spawner is running too — that
// is what foeSpawning gates — so the item reads the dropper roster alone and
// re-poses the thirty nodes each check interval, since a glitch may eat one.

import { test } from "vitest";

test("foes.dropper-dense-no-trigger", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/foes/dropper-dense-no-trigger.test.ts has not been written yet",
  );
});
