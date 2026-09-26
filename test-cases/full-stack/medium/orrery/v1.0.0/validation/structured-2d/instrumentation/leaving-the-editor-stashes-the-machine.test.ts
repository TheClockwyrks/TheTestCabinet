// instrumentation/leaving-the-editor-stashes-the-machine — leaving keeps the
// machine and closes the challenge.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "A call to
// `setScreen` that leaves the editor leaves it exactly as leaving it in play does:
// a live run is stopped, the open challenge's machine is stashed as
// `specs/editor.md` states, and the challenge is closed, so `challenge` and `sim`
// both report `null` afterwards." `specs/editor.md` says what stashing is: "The
// first visit in a session opens an empty field; leaving by any route keeps the
// machine, and every later visit in the session restores it exactly, tapes
// included. Each challenge carries its own machine." And the Snapshot shape says
// where it shows: "stashed: [<number>], // ascending indices with a stashed
// machine".
//
// THE CONFIGURATION. A shipped Extras challenge, because "Every challenge is
// unlocked from the start and can be entered in any order"
// (`specs/modes/extras.md`), so the later visit can be made the player's own way —
// the select screen's row and `confirm` — which is the route `specs/editor.md`
// writes the restoring rule about. Three arms are placed on it, each given a tape
// of its own so a machine restored without its tapes is a different machine. Then
// one `setScreen("title")`.
//
// THE VERDICT. Afterwards `challenge` is `null`, the row appears in that mode's
// `stashed` list and nowhere else, and the next visit hands back the same machine,
// part for part and tape for tape, as one solution document beside the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openChallenge,
  partIds,
  pressAction,
  readMachine,
  type Harness,
} from "../harness";

/** The Extras row this check builds a machine on. */
const ROW = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the machine for the challenge it closed, tapes and all", async () => {
  await h.debug.reset();
  await h.debug.setMode("extras");
  await openChallenge(h, "extras", ROW);
  await h.debug.clearMachine();

  await h.debug.placePart("arm", -2, 0, 0);
  await h.debug.placePart("arm", 0, -2, 2);
  await h.debug.placePart("wheel", 2, 0, 0);
  const [first, second, third] = await partIds(h);
  await h.debug.setTapeCell(first ?? -1, 0, "grab");
  await h.debug.setTapeCell(first ?? -1, 1, "rotate-cw");
  await h.debug.setTapeCell(second ?? -1, 2, "drop");
  await h.debug.setTapeCell(third ?? -1, 0, "rotate-ccw");
  const built = await readMachine(h);
  assertEqual(built.parts.length, 3, "the machine is the three parts placed");

  await h.debug.setScreen("title");
  await h.advance(1);

  const left = await h.snapshot();
  assertEqual(left.screen, "title", "the session left the editor");
  assertNull(left.challenge, "the open challenge was closed");
  assertNull(left.sim, "no run is left behind");
  assertDeepEqual(
    left.extras.stashed,
    [ROW],
    "the row that was left appears in its own mode's stashed list",
  );
  assertDeepEqual(
    left.campaign.stashed,
    [],
    "the other mode keeps no machine: none of its challenges was entered",
  );
  assertEqual(
    left.editor.parts.length,
    0,
    "the editor itself is empty with no challenge open",
  );

  // The later visit `specs/editor.md` writes the rule about: the select row and
  // `confirm`, exactly as a player returns to a challenge.
  await h.debug.setScreen("select");
  await h.debug.setSelectIndex(ROW);
  await pressAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "restored");

  const revisited = await h.snapshot();
  assertEqual(revisited.screen, "editor", "the challenge opens again");
  assertEqual(
    revisited.challenge?.index,
    ROW,
    "the challenge opened is the one that was left",
  );
  assertDeepEqual(
    await readMachine(h),
    built,
    "the visit restores the machine exactly, tapes included",
  );
});
