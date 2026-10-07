// editor/set-tool-selects-a-tool — setTool selects each of the six build tools.
//
// `specs/instrumentation.md` § The structure: "`setTool(tool)` — Selects a build
// tool, as the tool actions do." `specs/state.md` § The editor fixes the domain:
// "The selected build tool, one of `strut`, `cable`, `rail`, `ring`,
// `counterweight`, and `delete`", and `specs/controls.md` binds one tool action
// to each of the six. The snapshot reports the field, and
// `specs/instrumentation.md` says every field an operation sets is reported "so a
// call is checked by setting a value and reading it back" — which is this check,
// once per tool.
//
// ALL SIX IN ONE CHECK, because they are one operation over one closed
// vocabulary rather than six requirements: a build that reaches this surface at
// all reaches every entry of it the same way. The walk starts at `cable` rather
// than `strut` — `specs/instrumentation.md` says a `reset` leaves "the strut
// tool" — and ends on `strut`, so every step of it moves the selection and no
// reading can be the value that was already there.
//
// The world is emptied first: the tool is the editor's own state and nothing in
// the yard bears on it, so the check runs against a site with nothing built,
// nothing standing and nothing in the way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Tool,
} from "../harness";

/** Every tool, walked from the one a reset leaves and back round to it. */
const WALK: readonly Tool[] = [
  "cable",
  "rail",
  "ring",
  "counterweight",
  "delete",
  "strut",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects each of the six build tools in turn", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  assertEqual(
    (await h.snapshot()).tool,
    "strut",
    "the tool standing before the walk, which a reset leaves " +
      "(specs/instrumentation.md)",
  );

  try {
    for (const tool of WALK) {
      await h.debug.setTool(tool);
      await h.advance(1);
      assertEqual(
        (await h.snapshot()).tool,
        tool,
        `the tool setTool("${tool}") selects (specs/instrumentation.md)`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture(
      "set-tool-selects-a-tool",
      "The build screen with the last selected tool",
    );
  }
});
