## Added the `window.__carom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires every build to expose a
debugging and automation surface: core operations (`reset`, `step`, a
JSON-serializable `snapshot`), control operations that pose a scenario through
the game's real systems (`startMatch`, `serve`, `setScore`, `setPaddle`,
`setBall`, `setAiControl`), injected keyboard input (`keyDown`, `keyUp`,
`press`), and a read-only overlay of the live internal state toggled with the
backtick key. `specs/physics.md` now also requires the core to be render-free and
any randomness to run off a seedable generator, so a scenario replays
identically. It is a required deliverable, hence the major bump.

## Every mechanical review point is checked by an automated script

Each graded point now carries a validation script that drives the real build
through the debug handle and decides the point, leaving feel, art, and audio to
human review. Serve direction, the countdown, scoring, spin, the obstacles, and
the controls are all read from the running game. The new Color category samples
the pixels the build actually paints at known on-field locations rather than
trusting a reported value, and each game state is reached and captured through
the debug API so a reviewer sees the real screen beside the reference build's.
Beatable AI becomes three scripted points that hand the AI its own paddle and
read whether it blocks the shot: it runs down a reachable shot, a fast shot out
of its reach gets past, and a shot that banks off a wall gets past.

## Reviewer checklist regrouped into categories

The checklist is now categories of sub-items — Gameplay, Paddles, Ball, Spin,
Single Player Controls, Multi Player Controls, Color, UI, and Audio — with every
graded point worth one whole point and no fractional scoring. Points that used to
be bundled are split so a build fails exactly the rule it breaks: one point per
goal, center and edge hit angle apart, rally acceleration apart from the speed
cap, and each key checked on its own (in Versus a movement key must move only its
own paddle). New points cover pausing during the pre-serve countdown, the
countdown freezing while paused, an obstacle bounce keeping the ball's speed, a
paddle held against the field bound imparting no spin, gyre's sway and spin, and
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
