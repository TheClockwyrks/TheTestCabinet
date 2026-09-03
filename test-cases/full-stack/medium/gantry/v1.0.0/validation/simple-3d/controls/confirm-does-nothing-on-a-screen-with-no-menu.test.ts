// controls/confirm-does-nothing-on-a-screen-with-no-menu — `confirm` does nothing
// on a screen that shows no menu.
//
// `specs/controls.md` § The actions: `confirm` (`Enter`) does "take the
// highlighted menu item, ON THE SCREENS SHOWING A MENU", and "Every action
// applies where the table says and does nothing elsewhere." `specs/ui.md` § The
// screens fixes which those are — `title`, `select` and `results` show menus —
// and `specs/instrumentation.md` names the other four in as many words: "a screen
// with no menu — `howto`, `build`, `program`, and `run`".
//
// SO THE READING IS THAT NOTHING MOVED, over the four screens that show no menu.
// A build that answers `confirm` wherever it is pressed is wrong in whatever way
// its own menu handler happens to be wrong — it may change the screen, take a
// site, enter a tool, or move the highlight — so the honest reading is the whole
// snapshot rather than the one field a particular mistake would touch.
//
// WHAT IS COMPARED IS EVERYTHING A MENU ENTRY LEADS TO. `specs/ui.md` gives the
// entries of the three menus and where each leads: a screen (`title`, `howto`,
// `select`, `results`), a site opened onto its `build` screen (`SITES`, a site
// entry, `NEXT SITE`, `REPLAY`), and the highlight itself. So the reading is the
// screen, the highlight, the open site and what opening one carries — the undo
// history, the structure, the tape, the shown check result — and the clears that
// decide which sites a menu offers. What is left out is what a FRAME moves rather
// than a key: `simTime`, which "accumulates every update's delta time in seconds,
// whatever the screen", and the run, which ticks while the run screen is showing.
//
// THE HIGHLIGHT IS LEFT SOMEWHERE A MENU HANDLER COULD ACT ON, which is what
// makes the reading sharp: `menuIndex` on a screen with no menu is "what the last
// menu screen left it holding" (`specs/instrumentation.md`), so it is set to `1`
// on the site select and the screen is then taken away with `setScreen`, which
// "shows a named screen and sets nothing else". A build that ran the site
// select's `confirm` from the build screen would enter site `1` and empty
// everything this scenario built; a build that ran the title's would open
// `howto`.
//
// The four screens are one requirement read four times, not four requirements:
// the rule is the row of the action table, and it is exercised the same way on
// each. The world is emptied and a crane and a tape are posed, so what stands
// across the press is exactly what this validator put there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type Screen,
  type TapeStepSpec,
} from "../harness";

/** The `confirm` action's binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** The highlight left behind: an entry a menu handler could act on. */
const HELD = 1;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The screens showing no menu that need no run to reach. */
const STILL_SCREENS: readonly Screen[] = ["howto", "build", "program"];

/**
 * Everything a menu entry would move, and nothing a frame moves on its own.
 *
 * Read as one string rather than field by field, so the reading is "nothing
 * moved" in one direction rather than eight assertions; and as this projection
 * rather than the whole snapshot, so a build that moved one of them says which in
 * a line a reviewer can read.
 */
function unmoved(s: GantrySnapshot): string {
  return JSON.stringify({
    screen: s.screen,
    menuIndex: s.menuIndex,
    siteIndex: s.siteIndex,
    cleared: s.cleared,
    historyDepth: s.historyDepth,
    members: s.structure.members.length,
    ring: s.structure.ring,
    steps: s.program.length,
    checkResult: s.checkResult,
    tool: s.tool,
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing on the screens that show no menu", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  for (const screen of STILL_SCREENS) {
    // The highlight is left where a menu handler would find something to take.
    await h.debug.setScreen("select");
    await h.debug.setMenuIndex(HELD);
    await h.debug.setScreen(screen);
    await h.advance(1);
    const before = await h.snapshot();
    assertEqual(before.screen, screen, "the screen the press lands on");

    await h.press(CONFIRM);
    await h.advance(1);

    assertEqual(
      unmoved(await h.snapshot()),
      unmoved(before),
      `the screen, the highlight, the open site and what it carries, ` +
        `across ${CONFIRM} on the \`${screen}\` screen, which shows no menu: \`confirm\` takes the ` +
        "highlighted menu item on the screens showing a menu and does " +
        "nothing elsewhere (specs/controls.md § The actions, " +
        "specs/ui.md § The screens)",
    );
    if (screen === "build") {
      await h.capture("no-confirm", "The build screen after confirm");
    }
  }

  // And the fourth, which needs a run in progress to stand on.
  await startRun(h);
  const running = await runTicks(h, 10);
  assertEqual(running.screen, "run", "the screen the press lands on");
  assertEqual(running.run.phase, "running", "the run the press lands during");

  await h.press(CONFIRM);
  await h.advance(1);

  assertEqual(
    unmoved(await h.snapshot()),
    unmoved(running),
    `the screen, the highlight, the open site and what it carries, ` +
      `across ${CONFIRM} on the \`run\` ` +
      "screen, which shows no menu: `confirm` takes the highlighted menu " +
      "item on the screens showing a menu and does nothing elsewhere " +
      "(specs/controls.md § The actions, specs/ui.md § The screens)",
  );
});
