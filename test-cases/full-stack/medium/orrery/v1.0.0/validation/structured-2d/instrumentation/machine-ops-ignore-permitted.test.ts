// instrumentation/machine-ops-ignore-permitted — the machine operations do not
// read the challenge's `permitted` list.
//
// THE RULE. "Each placement is checked against the placement rules of
// `specs/parts.md` alone, and throws an `Error` naming the first rule it breaks.
// The challenge's `permitted` list is a tray rule of `specs/editor.md` rather than
// a placement rule, so none of these reads it" (`specs/instrumentation.md`, The
// machine). What `permitted` governs is the tray: "The tray offers what the
// challenge permits. Its entries are, in order: the challenge's `permitted` part
// kinds, in the order of `PARTS`" (`specs/editor.md`), and `specs/parts.md`'s six
// placement rules say nothing about kinds at all.
//
// THE CONFIGURATION. The bare challenge, whose `permitted` list holds `arm` and
// nothing else, so every other kind is one the tray does not offer. Two of them
// are then placed through `placePart`: a `wheel`, which is a mechanism, and a
// `bind`, which is a sigil with a footprint — both at poses that break no
// placement rule. Nothing else is placed.
//
// THE VERDICT. The challenge's `permitted` list still offers `arm` alone, and both
// unpermitted kinds stand on the field, at the poses they were placed at.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a kind the challenge does not permit like any other", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const opened = await h.snapshot();

  const wheel = await placePart(h, "wheel", at(0, 0), 2);
  const bind = await placePart(h, "bind", at(2, 2), 0);
  await h.advance(1);
  await captureStill(h, "placed");
  const placed = await h.snapshot();

  assertDeepEqual(
    opened.challenge?.permitted,
    ["arm"],
    "the open challenge permits `arm` alone, so `wheel` and `bind` are not on its tray",
  );
  assertNotNull(
    partById(placed, wheel),
    "the unpermitted wheel stands on the field",
  );
  assertEqual(
    partById(placed, wheel)?.kind,
    "wheel",
    "the part placed is the wheel that was asked for",
  );
  assertEqual(
    partById(placed, wheel)?.rotation,
    2,
    "the wheel carries the rotation it was placed at",
  );
  assertNotNull(
    partById(placed, bind),
    "the unpermitted sigil stands on the field",
  );
  assertEqual(
    partById(placed, bind)?.kind,
    "bind",
    "the part placed is the sigil that was asked for",
  );
  assertEqual(
    placed.editor.parts.length,
    2,
    "both unpermitted kinds were placed, and nothing else",
  );
});
