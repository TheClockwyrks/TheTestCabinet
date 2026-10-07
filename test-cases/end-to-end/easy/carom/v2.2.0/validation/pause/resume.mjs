// Automated validation for the Pause sub-item `resume`: both ways out of a pause work.
//
// `specs/ui.md` gives the paused screen two routes back into the match — confirming
// its RESUME entry (with `Enter` or `Space`, on a menu that opens with RESUME
// selected) and pressing the pause key again, which `specs/modes/single-player.md` and
// `specs/modes/versus.md` define as a toggle for both `Esc` and `P`. Leaving the match
// is the separate QUIT TO MENU entry.
//
// A live match is posed and then paused and resumed once per route, each time reading
// back that the pause opened, that the resume returned to the screen the pause was
// taken from, and that the match is genuinely running again afterwards rather than
// merely relabelled. See validation/_helpers.mjs.

import { arrangeLiveBall, ball0 } from "../_helpers.mjs";

// Every route the specification pins, each as the key that opens the pause and the key
// that leaves it. The two menu routes are a single press because the pause menu opens
// with RESUME already selected, the same convention `startWithKeys` relies on at the
// title.
const ROUTES = [
  { via: "the Esc pause key again", pauseWith: "Escape", resumeWith: "Escape" },
  { via: "the P pause key again", pauseWith: "KeyP", resumeWith: "KeyP" },
  {
    via: "Enter on the menu's RESUME entry",
    pauseWith: "Escape",
    resumeWith: "Enter",
  },
  {
    via: "Space on the menu's RESUME entry",
    pauseWith: "Escape",
    resumeWith: "Space",
  },
];

// Held on the pause menu long enough for a reviewer to read it, then run live long
// enough for the ball to visibly travel. The live stretch is the proof that the resume
// restarted the match rather than just changing a label, and it doubles as the run-up
// to the next route's pause, so the clip is a continuous rally punctuated by four
// pauses: 4 x (36 + 36) ticks, or 2.4 s.
const HELD_TICKS = 36;
const LIVE_TICKS = 36;

// How far the ball must travel over a live stretch to count as moving. It covers 120 px
// in LIVE_TICKS at the posed speed, so this is a wide margin around "not frozen".
const MIN_TRAVEL = 50;

export default function item() {
  // One entry per route, for `assert` to score.
  const observed = [];

  return {
    id: "pause.resume",

    // A live match with the ball posed on the y=360 lane, which clears both obstacles
    // and both goals for the whole sequence: 4 x 36 ticks at 400 px/s carries it 480 px
    // from x=400, so it never scores and never banks.
    async arrange(api) {
      await arrangeLiveBall(api, { x: 400, y: 360, vx: 400, vy: 0 });
    },

    // Pause and resume once per route. The loop is over a fixed list, so both passes
    // take the same path and the clip depicts exactly what is checked.
    async act(api) {
      for (const route of ROUTES) {
        const before = await api.snapshot();
        await api.call("press", route.pauseWith);
        const paused = await api.snapshot();
        await api.advance(HELD_TICKS);

        await api.call("press", route.resumeWith);
        const resumed = await api.snapshot();
        await api.advance(LIVE_TICKS);
        const live = await api.snapshot();

        observed.push({ route, before, paused, resumed, live });

        // Put the match back whatever this route did, so a route that failed to resume
        // does not leave the next one reading a paused game and reporting the opposite
        // of what it drove. Confirming RESUME is the recovery because it is a no-op
        // during play — `Enter` binds to nothing in a live match (specs/modes/*.md) —
        // so this is the same unconditional press in both passes, and every reading
        // above was already taken.
        await api.call("press", "Enter");
      }
    },

    async assert(api, check) {
      for (const { route, before, paused, resumed, live } of observed) {
        check.expectEq(
          `${route.pauseWith} opens the pause menu (${route.via})`,
          paused.screen,
          "paused",
        );

        // Back to the screen the pause was taken from — a build that quit to the title
        // (or left the menu up) does not match it.
        check.expectEq(
          `resuming with ${route.via} returns to the match`,
          resumed.screen,
          before.screen,
        );

        // And genuinely running again, not just relabelled.
        check.expectGt(
          `the match is live again after resuming with ${route.via} (px travelled)`,
          Math.hypot(
            ball0(live).x - ball0(resumed).x,
            ball0(live).y - ball0(resumed).y,
          ),
          MIN_TRAVEL,
        );
      }
    },
  };
}
