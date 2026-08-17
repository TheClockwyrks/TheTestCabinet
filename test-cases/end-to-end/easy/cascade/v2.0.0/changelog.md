## The build must expose a `window.__cascade` API and a debug overlay

A new common spec, `specs/instrumentation.md`, seeded for every variant, requires
a deterministic, seedable, render-free core behind a `window.__cascade` API — core
operations, a JSON-serializable snapshot, control operations that pose a board and
drive the real rules, a `selectMenu`, and injected pointer input — plus a read-only
overlay toggled with the backtick key. An `autoStep` flag decides whether the
victory cascade advances from the wall clock or by hand, so a scripted cascade is
exact. A new mandatory deliverable, hence the major bump.

## The reviewer checklist is reorganized into categories with automated validation

The checklist now uses the categories grammar (`[review] format = 2`), with every
graded point a one-point item and most carrying a validation script that drives the
build through `window.__cascade` and decides its own verdict. The deal, foundation,
tableau, run, stock and waste, auto-move, win-detection, and victory-cascade
behaviors are each checked more finely than before; presentation stays
reviewer-judged.

Win detection is checked once per gesture that can cause it — `detect-drag` and
`detect-double-click` in place of the single `detect` — and each drives the last
card home from both the waste and a tableau column. Completing the foundations is
one rule, but reaching it is two different input paths, and a build can get one
right and the other wrong: a drag commits on release, over a target the player
chose, while a double-click hands the card to the auto-move, which picks the
foundation itself. Both items run the whole gesture — the drag through the pointer
operations, the double-click as a real browser double-click rather than the
`doubleClick` operation — and assert that the cascade is still running once the
gesture is over. A build that detects the win correctly and then undoes it with the
rest of that same gesture fails: on the won screen a click deals a fresh game, so a
build that recognizes the double on the second press and lets that press run on into
the dismiss deals a new game before the cascade draws a frame, and a player never
sees the ending the game is named for.

## The seeded specs are renamed and tightened

`layout.md` became `table.md`, `flow.md` became `states.md`, and `cascade.md`
became `victory.md`. The per-variant deal-mode spec is gone: its turn count, waste
fan, and menu label are now a variant branch inside `specs/rules.md.hbs`. Historical
and edge-case call-outs were removed so each variant's seeded set reads as one
self-contained game.

## Other changes

- The prompt's mandatory verification pass is replaced by a note that Playwright
  and Chromium are available for driving and validating the build, leaving their use
  to the model's judgment.
- `specs/proof.md` drops the validator and review-UI framing; the captures and their
  fixed paths are unchanged.
- `specs/overview.md` drops the "inspired by classic patience card games" framing.
- Touchscreen support is now a hard requirement: the game must be fully playable
  with a mouse and on a touchscreen alike (v1 listed touch as out of scope).

## The render-decoupling requirement no longer contradicts itself

`specs/victory.md` and `specs/instrumentation.md` require the simulation to run
on a fixed timestep **decoupled from rendering**, and then described that
decoupling as "Rendering reads the state, never the other way around." Read as a
constraint on the renderer, the second sentence says the opposite of the first:
it pins what is drawn to whatever the last completed step left behind, tying the
picture to the tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentence that could be read against it is gone.

The reference implementation needed no matching change. The victory cascade is
the only thing in the game that moves under the clock, and each in-flight card
is stamped onto a persistent trail layer once per simulation step rather than
redrawn at a live position — one mark per step, however many steps a frame
happens to run. What is drawn is already independent of the frame rate.
