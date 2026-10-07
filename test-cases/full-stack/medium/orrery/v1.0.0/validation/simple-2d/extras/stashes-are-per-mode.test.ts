// extras/stashes-are-per-mode — an Extras machine and a campaign machine at the
// same challenge number are stashed apart.
//
// THE RULE. "Machines persist per challenge for the session, as
// `specs/editor.md` states" (`specs/modes/extras.md`, Progression; the same
// sentence stands in `specs/modes/campaign.md`), and `specs/editor.md` states it:
// "The first visit in a session opens an empty field; leaving by any route keeps
// the machine, and every later visit in the session restores it exactly, tapes
// included. EACH CHALLENGE CARRIES ITS OWN MACHINE and its own records."
//
// THE TWO MODES ARE TWO COURSES. "`state.mode` is `campaign` or `extras`, and
// decides which course the `select` and `editor` screens serve" (`specs/ui.md`),
// and the snapshot keeps the stashes once per mode, as `campaign.stashed` and
// `extras.stashed`, "ascending indices with a stashed machine"
// (`specs/instrumentation.md`). So Extras 3 and campaign challenge 3 are two
// challenges, not one, and each carries its own machine.
//
// THE CHALLENGES ARE ENTERED AND RE-ENTERED THE PLAYER'S WAY, from a select screen
// with `confirm`, because that is the visit the rule is about: "Opening a
// challenge from a select screen shows this editor with that challenge's tray"
// (`specs/editor.md`). The surface's `openChallenge` is not that visit — it "moves
// to the editor with an empty machine" whatever is stashed — so it could not
// observe a restoration. Each editor is left with `back`, which "returns to that
// select screen", and leaving "by any route keeps the machine".
//
// THE TWO MACHINES SHARE NOT ONE FIGURE: a different kind on a different hex at a
// different rotation and a different length, carrying a different tape. So a build
// that handed one challenge the other's machine cannot be reported as having
// restored the right one by accident, and "with neither showing the other's parts"
// is decided by the whole machine rather than by a count.
//
// A machine is posed through `loadSolution`, which "replaces the open challenge's
// machine with `solution`" and is checked "against the placement rules of
// `specs/parts.md` alone", and read back off `editor.parts` — "placement order",
// each entry carrying the pose and the tape the solution format fixes
// (`specs/formats.md`).
//
// THE VERDICT. The campaign challenge's first visit opens empty rather than
// showing the Extras machine, and returning to each challenge afterwards restores
// that challenge's own machine exactly, tapes included, with none of the other's
// parts on the field.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { type ModeName } from "../constants";
import { armPart, solution, type Solution } from "../formats";
import {
  captureStill,
  createHarness,
  loadMachine,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The row both modes are worked at: challenge 3 of each. */
const INDEX = 2;

/** The Extras machine: one arm on the field's west side, tape `grab`. */
const EXTRAS_MACHINE: Solution = solution([
  armPart("arm", -3, 0, 0, 1, ["grab"]),
]);

/** The campaign machine: a piston on the east side, turned, long, tape of three. */
const CAMPAIGN_MACHINE: Solution = solution([
  armPart("piston", 3, -1, 2, 3, ["extend", "retract", "drop"]),
]);

/** One placed part, projected onto the fields `specs/formats.md` fixes for it. */
interface PlacedPart {
  kind: string;
  q: number;
  r: number;
  rotation: number;
  length: number;
  tape: (string | null)[] | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The machine on the field, as the pose and tape of each part in placement order.
 *
 * The snapshot's own record is read rather than deep-equalled whole: a build is
 * free to carry a field on a part that no sentence of `specs/` forbids, so what is
 * compared is exactly what the solution format fixes about an arm.
 */
function machineOf(snapshot: OrrerySnapshot): PlacedPart[] {
  return snapshot.editor.parts.map((part) => ({
    kind: part.kind,
    q: part.q,
    r: part.r,
    rotation: part.rotation,
    length: part.length,
    tape: part.tape,
  }));
}

/** The same projection over a solution document, which is what a visit must restore. */
function machineIn(document: Solution): PlacedPart[] {
  return document.parts.map((part) => ({
    kind: part.kind,
    q: part.q ?? 0,
    r: part.r ?? 0,
    rotation: part.rotation ?? 0,
    length: part.length ?? 1,
    tape: part.tape ?? null,
  }));
}

/** Enter a challenge from its mode's select screen, the way a player enters one. */
async function enter(mode: ModeName, index: number): Promise<OrrerySnapshot> {
  await openSelect(h, mode);
  await h.debug.setSelectIndex(index);
  await pressAction(h, "confirm");
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "editor",
    `confirm on row ${index + 1} of the ${mode} select screen opens that ` +
      "challenge in the editor",
  );
  assertEqual(
    entered.challenge?.source,
    mode,
    `the challenge entered is the ${mode}'s own`,
  );
  assertEqual(
    entered.challenge?.index,
    index,
    `and it is challenge ${index + 1} of that mode`,
  );
  return entered;
}

/** Leave the editor with `back`, which stashes the machine and shows the shelf. */
async function leave(): Promise<void> {
  await pressAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back while editing returns to the select screen the challenge was opened from",
  );
}

it("restores each mode's own machine at challenge 3, neither showing the other's", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.campaign.count,
    INDEX + 1,
    "the course holds at least CAMPAIGN_MIN (8) challenges, so it has a " +
      "challenge 3 to stand beside the Extras'",
  );
  assertDeepEqual(
    fresh.extras.stashed,
    [],
    "a reset leaves every stash empty, so both machines below are this " +
      "session's own",
  );
  assertDeepEqual(fresh.campaign.stashed, [], "in both modes alike");
  await h.debug.setUnlockedCount(INDEX + 1);

  await enter("extras", INDEX);
  assertDeepEqual(
    machineOf(await h.snapshot()),
    [],
    "the first visit to Extras 3 in this session opens an empty field",
  );
  await loadMachine(h, EXTRAS_MACHINE);
  assertDeepEqual(
    machineOf(await h.snapshot()),
    machineIn(EXTRAS_MACHINE),
    "the Extras machine is on the field before the challenge is left",
  );
  await leave();

  await enter("campaign", INDEX);
  assertDeepEqual(
    machineOf(await h.snapshot()),
    [],
    "campaign challenge 3 is a challenge of its own, so its first visit opens an " +
      "empty field rather than the machine built on Extras 3",
  );
  await loadMachine(h, CAMPAIGN_MACHINE);
  await leave();

  const stashes = await h.snapshot();
  assertDeepEqual(
    stashes.extras.stashed,
    [INDEX],
    "the Extras hold a stashed machine for challenge 3, and for no other",
  );
  assertDeepEqual(
    stashes.campaign.stashed,
    [INDEX],
    "and the campaign holds its own, for its own challenge 3",
  );

  await enter("extras", INDEX);
  await h.advance(1);
  await captureStill(h, "restored");
  assertDeepEqual(
    machineOf(await h.snapshot()),
    machineIn(EXTRAS_MACHINE),
    "returning to Extras 3 restores the machine built there exactly, tape " +
      "included, with none of the campaign machine's parts on the field",
  );
  await leave();

  await enter("campaign", INDEX);
  assertDeepEqual(
    machineOf(await h.snapshot()),
    machineIn(CAMPAIGN_MACHINE),
    "and returning to campaign challenge 3 restores its own machine, tape " +
      "included, with none of the Extras machine's parts on the field",
  );
});
