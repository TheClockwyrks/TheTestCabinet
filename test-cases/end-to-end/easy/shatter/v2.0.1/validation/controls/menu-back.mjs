// Automated validation for the Controls item `menu-back`: Esc goes back from a sub-screen.
// From the title, How to Play is opened, then Esc must return to the title.
//
// Only the reset to the title is a precondition (`arrange`); the navigation itself is the
// behavior, so the key presses live in `act`, with a short advance after each so the clip
// shows the screen change rather than jumping straight to the end state. Key presses are
// control ops, which are legal in `act` — only `api.reset` is not.

import { title } from "../_helpers.mjs";

export default function item() {
  // The screen after opening How to Play, and after backing out, read by `assert`.
  let opened;
  let backedOut;

  return {
    id: "controls.menu-back",

    async arrange(api) {
      await title(api);
      await api.call("press", "ArrowDown"); // highlight HOW TO PLAY
    },

    async act(api) {
      await api.call("press", "Enter");
      opened = (await api.snapshot()).screen;
      await api.advance(60); // 0.5 s — hold on How to Play so it reads in the clip

      await api.call("press", "Escape");
      backedOut = (await api.snapshot()).screen;
      await api.advance(60); // 0.5 s — hold on the title it returned to
    },

    async assert(api, check) {
      check.expectEq("How to Play opens", opened, "howto");
      check.expectEq(
        "Esc returns from How to Play to the title",
        backedOut,
        "title",
      );
    },
  };
}
