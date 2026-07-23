## Added the `window.__carom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires every build to expose a
debugging and automation surface: core operations (`reset`, `step`, a
JSON-serializable `snapshot`), control operations that pose a scenario through
the game's real systems (`startMatch`, `serve`, `setScore`, `setPaddle`,
`setBall`, `setAiControl`), injected keyboard input (`keyDown`, `keyUp`,
`press`), and a read-only overlay of the live internal state toggled with the
backtick key. `specs/balls.md` now also requires the core to be render-free and
any randomness to run off a seedable generator, so a scenario replays
identically. It is a required deliverable, hence the major bump.

## Every mechanical review point is checked by an automated script

Each graded point now carries a validation script that drives the real build
through the debug handle and decides the point, leaving feel and art to human
review. Serve direction and speed, the countdown length, scoring, spin, the
obstacles, the paddle movement speeds, pausing, and the controls are all read
from the running game. The new Color category samples the pixels the build
actually paints at known on-field locations — the paddles, the obstacles, and the
ball — rather than trusting a reported value, and each game state is reached and
captured through the debug API so a reviewer sees the real screen beside the
reference build's. Beatable AI becomes three scripted points that hand the AI its
own paddle and read whether it blocks the shot: it runs down a reachable shot, a
fast shot out of its reach gets past, and a shot that banks off a wall gets past.
Audio is driven automatically too: the validator reads the Web Audio sources a
build starts and confirms a cue fires on a paddle hit, a wall bounce, an obstacle
bounce, and a scored point (the exact sound stays the model's own).

## Reviewer checklist regrouped into categories

The checklist is now categories of sub-items — Instrumentation, Gameplay,
Paddles, Paddle Movement, Ball, Spin, Pause, Single Player Controls, Multi Player
Controls, Color, UI, and Audio — with every graded point worth one whole point
and no fractional scoring. Points that used to be bundled are split so a build
fails exactly the rule it breaks: one point per goal, center and edge hit angle
apart, rally acceleration apart from the speed cap, the obstacle bounce checked
per face (each obstacle's left and right side), spin while moving checked for each
paddle and control context, and each key checked on its own (in Versus a movement
key must move only its own paddle). New points cover the debug API surface itself,
the serve speed and countdown length, each paddle's movement speed (the human
paddle in Solo and for both Versus players, and the AI's own slower chase),
pausing during the pre-serve countdown, the countdown freezing while paused, every
paddle and the ball freezing while paused and the ball continuing from where it
was on resume, an obstacle bounce keeping the ball's speed, a paddle held against
the field bound imparting no spin, the ball's color, gyre's sway and spin, and
multi's collision with a respawning ball. Serve direction becomes three points
that base and gyre add to the common Gameplay category, and that multi, launching
at random angles, simply omits.

## Other changes

- `M` toggles mute on any screen, and `snapshot` reports a `muted` flag.
- `specs/proof.md` notes that the debug API can put the game into the exact state
  each capture needs, so only the setup is fast-forwarded.
- The prompt no longer mandates a verification pass. Playwright and Chromium are
  described as available for driving the build, with their use left to the
  model's judgment.
- Rewrote the specs in plainer prose, dropping test-framing and heavy emphasis
  while leaving the rules themselves unchanged.
