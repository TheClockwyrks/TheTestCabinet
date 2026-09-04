## Overview

**Cascade** is a browser game of **Klondike solitaire**, the patience most people
just call "Solitaire", played on a felt table. Twenty-eight cards are dealt into
seven tableau columns; the player builds four foundations up from Ace to King,
one suit each, by moving cards between columns, turning the stock, and freeing
the buried face-down cards underneath. Clear all fifty-two home and the game is
won.

The game is named for its finish. The moment the fifty-second card lands, every
foundation card launches off the table in turn, arcs under gravity, bounces along
the floor, and paints itself onto the felt as it flies, until the table is buried
under overlapping cards and the last flyer has drifted off a side edge. It is the
classic patience victory animation, rebuilt here from an original deck on an
original table.

The whole game is played with the pointer, and a mouse and a touchscreen stand on
the same footing: press to lift a card or an ordered run, drag it over the table,
release to drop it, or double-click a card to send it home on its own.

## The two deal modes

Both deals are the same table, the same rules, and the same ending, and they
differ only in how many cards a stock turn moves.

- **Draw One** — the gentler deal. A turn moves one card, so every card in the
  stock is reachable and the game is markedly more winnable.
- **Draw Three** — the classic Klondike deal. A turn moves three cards, fanned,
  with only the frontmost of them playable.

## Why it is a benchmark

Solitaire looks simple and is genuinely approachable, but a version a person
would actually enjoy is a real front-end build. There is no opponent to model and
nothing tuned by feel: every rule is a statement about one of thirteen piles.
What the case asks for is a lot of exact rules holding at once.

- Four foundations and seven columns, each with its own rule for what it accepts
  and what it refuses, including the empty-pile cases that decide half the game.
- An ordered run that is lifted, carried and landed as a single unit, and a
  face-down card that turns face-up when and only when it is exposed.
- A stock whose waste remembers each turn as a set, so what the waste shows once
  its turned cards have been played off is determined rather than guessed, and a
  recycle that clears that memory with the pile.
- A double-click auto-move that finds the one foundation a card belongs on, and
  reliable win detection the moment the last card lands.
- A pointer whose grab, drag threshold, drop and double-click rules are all
  fixed, four screens, a HUD, and ten audio cues.
- A victory cascade whose launch cadence, gravity, floor bounce and painted trail
  are fixed to the figure and integrated against the frame's own delta time.

Every one of those is stated exactly and checked exactly, so a build that is
nearly right in many places is told apart from one that is right.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them. On an engineless
run the project carries no source at all, and the run writes the runtime as well
as the game.

There is no art to supply: every card face, every card back, the table and every
screen is drawn in code. The specification fixes the table geometry, the rules of
every pile, the pointer, the screens and the cascade's motion exactly, and states
about the look only what a player must be able to read at a glance. The palette,
the type, the card design and the layout of everything else are the build's own.
Every review point is decided by a validator derived from those rules, and the
reviewer's judgement goes into the per-domain ratings of visuals, polish and
feel.
