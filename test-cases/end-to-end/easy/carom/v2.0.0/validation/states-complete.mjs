// Automated validation for the `states-complete` review item.
//
// Drives the game's debug API (window.__carom) through the core screen
// transitions and reads the reported screen back at each step, then captures the
// title screen as the item's synthesized proof. This checks only the objective,
// mechanically-verifiable half of "every game state is reachable" — the title →
// pre-serve countdown → live-play progression the control operations can reach
// deterministically; a reviewer still judges the menus, pause, and match-over
// screens by eye.
//
// The driver `api` is documented in packages/browser-driver/driver.mjs: reset,
// step, wait, snapshot, and call(op, …args) forward to window.__carom; screenshot
// captures a declared image output.

export default async function drive(api) {
  // A fresh build opens on the title screen.
  await api.reset();
  await api.wait(300); // let the title paint before the screenshot
  const title = await api.snapshot();
  await api.screenshot("title");

  // Starting a match opens the pre-serve countdown, with the ball held.
  api.call("startMatch", "versus");
  const countdown = await api.snapshot();

  // Serving launches the ball; stepping the real simulation forward reaches the
  // live-play state.
  api.call("serve");
  await api.step(0.2);
  const playing = await api.snapshot();

  const pass =
    title.screen === "title" &&
    countdown.screen === "countdown" &&
    playing.screen === "playing";

  return {
    verdicts: { "states-complete": pass },
    notes: {
      "states-complete": `title=${title.screen}, countdown=${countdown.screen}, playing=${playing.screen}`,
    },
  };
}
