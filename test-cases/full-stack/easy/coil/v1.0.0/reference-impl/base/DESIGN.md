# Coil — Design notes

A short tour of how this reference implementation is built and why. The authoritative rules
are the specs under [`../../specs/`](../../specs/); this document explains the code.

## 1. Fixed timestep, decoupled rendering

The simulation advances in discrete **125 ms ticks** (8 ticks/sec), constant for the whole
round — there is no speed-up. `src/main.ts` accumulates real elapsed time and drains it in
whole `TICK_DT` steps (`while (acc >= TICK_DT) game.autoTick()`), so the tick rate is
independent of the frame rate: two machines running the same inputs produce the same sequence
of board states. Rendering runs every `requestAnimationFrame` and never advances the sim.

The combo window is measured in **simulation time** and decremented by the tick's `dt`, not by
wall-clock or frame count, so it too is frame-rate-independent (3.5 s = 28 ticks = a 28-cell
travel budget at base speed).

## 2. The tick — exact order of operations

`Sim.tick(dt)` follows the spec's order precisely, and the subtle cases fall out of it:

1. **Apply input** — take the oldest buffered turn and apply it *only if perpendicular to the
   direction actually moving this tick*.
2. **Advance the head** — head cell + current direction.
3. **Resolve collision** — test the new head cell; fatal ⇒ end immediately, skip 4–6.
4. **Eat or move** — prepend the new head; drop the tail unless a pellet was eaten (growth).
5. **Resolve food** — score `10 * M`, update the combo, spawn the next pellet.
6. **Advance timers** — drain the combo window; expire it (reset `M` to 1) at zero.

**Turning / the turn buffer.** Requested turns are buffered (max two). Validity is decided at
step 1 against the direction *actually moving this tick*, not at key-press time. This is what
stops a fast double-press from folding the snake: moving right, pressing *down* then *left*
buffers both; the *down* applies this tick, and *left* — now a valid perpendicular turn —
applies next tick, never both at once. A same-axis request (straight or a reversal into the
neck) is discarded. `requestTurn` also dedupes an immediate repeat so a held key can't stuff
the buffer.

**The tail-follow rule.** Collision is evaluated against the **post-move body**: on a normal
tick the current tail cell is excluded (it vacates, so the head may follow it); on a growth
tick the whole body including the tail is solid (it does not retract), so entering any of it is
fatal. `Sim.fatal(col,row,willEat)` encodes exactly this by testing `snake.length` vs
`snake.length - 1` cells depending on `willEat`.

**Pellet placement** collects the valid cells once (interior, not on the snake, and in Maze not
on an obstacle) and picks one uniformly — correct and fast even when few cells remain, with no
rejection-sampling stall. If none remain, the round ends on the **board-cleared** win.

## 3. The combo

`M` starts at 1, caps at 5. On an eat: if the window was open, `M++`; if it had lapsed (or it's
the first pellet), `M` resets to 1. The pellet then awards `10 * M` with the updated `M` and
reopens the 3.5 s window. Letting the window lapse resets `M` to 1. The HUD shows the readout
and a draining bar only while `M ≥ 2` (`Sim.comboFraction()` drives the bar).

## 4. States

`src/game.ts` is a six-state machine — title, howto, playing, paused, gameover, cleared —
wrapped around the current `Sim`. It advances the sim only while `playing`, keeps BEST live the
instant the score passes it, and transitions to gameover / cleared when a round ends. BEST is
the only thing persisted (`localStorage` `coil.best`); the mute flag (`coil.muted`) is the only
other stored value. `src/menus.ts` is the single source of truth for each state's menu items,
shared by navigation and drawing.

## 5. Rendering

Everything but the snake is code-drawn in the Coil palette: the wall ring, the interior field
and its faint per-cell grid, the glowing pellet, the Maze obstacle bars, the HUD (score, best,
the combo readout + draining bar, the mode tag, the sound hint), and all menus/overlays.

The **snake is drawn entirely from the produced sprite set** (`src/render.ts drawSnake`). Each
sprite is authored in one canonical orientation and rotated/flipped in code:

- **Head** — the 4-frame sheet, rotated to the current facing; the bite (frames 1→2→3→rest)
  plays on the eat tick, advanced on a timer in `main.ts`. Its back is the body's tube
  cross-section, so it joins the neck seamlessly in every facing.
- **Straight body** — oriented to the run **direction** (`ANGLE[toHead]`) so its scale chevrons
  flow tail-ward.
- **Corner** — the canonical east(head)+south(tail) bend, mapped onto each bend by sending its
  east opening to the head neighbour and its south opening to the tail neighbour (`drawCorner`:
  a rotation, or a rotation+reflection when the bend turns the other way). This keeps its scale
  chevrons flowing tail-ward around the curve, continuous with the straights, so a turning snake
  reads as one coil.
- **Tail** — rotated so its taper points along the tail's outgoing direction.

A blurred neon glow underlay is drawn behind the snake (brighter behind the head), and sprites
are sampled nearest-neighbour (`imageSmoothingEnabled = false`) so the pixel art stays crisp at
any scale.

## 6. Fit & presentation

`main.ts resize()` fits the fixed 1280×720 stage into the window uniformly, letterboxed with
the background colour and centred by the flex body, crisp at any device-pixel ratio and correct
on load before any input. The render transform maps the logical stage onto the backing store.

## 7. Modes

Classic and Maze share this entire codebase; the difference is isolated to `src/mode.ts`
(`MODE`). Maze adds the four fixed, fatal, point-symmetric obstacle bars (`MAZE_OBSTACLES` in
`constants.ts`), which the sim treats as solid like walls and excludes from pellet cells, and
which `render.ts` draws in the obstacle colour. The `maze` reference-impl is a copy of this
project with that one line flipped.

## 8. Verification

`scripts/verify.mjs` serves the built `dist/` under a non-root sub-path (proving base-path
safety) and drives the sim through the real input path via `window.__coil`, asserting the
movement, turning, reversal-ignore, growth, combo, and wall-death behaviours a reviewer checks,
with zero console/request errors.
