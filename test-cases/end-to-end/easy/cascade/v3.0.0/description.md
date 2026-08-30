## Overview

**Cascade** is a browser game of **Klondike solitaire** — the patience most
people just call "Solitaire" — played on a green felt table. Twenty-eight cards
are dealt into seven tableau columns; the player builds four foundations up from
Ace to King, one suit each, by moving cards between columns, turning the stock,
and freeing the buried face-down cards. Clear all fifty-two home and the game is
won.

The game is named for its finish. When the last card lands, every foundation card
launches off the table one after another and **bounces**, arcing under gravity
off the bottom edge and painting a permanent trail as it flies, until the whole
screen is buried in overlapping cards — the classic patience victory animation,
rebuilt here from an original deck on an original table.

## Why it is a benchmark

Solitaire looks simple and is genuinely approachable, but a version a person would
actually enjoy is a real front-end task. A strong implementation needs a clean
model of the deck and the thirteen piles, correct legal-move validation across the
tableau and the foundations, drag-and-drop of both single cards and ordered runs,
a double-click auto-move to the foundations, reliable win detection, and a
physics-driven victory animation — all wrapped in a title screen, a live table,
and a win screen that hang together. That makes it a clean mid-range case: mostly
state, rules, and interaction rather than raw rendering, with one showpiece
animation to get right.

The case ships in two deal modes as separate variants — **Draw Three** (the
classic deal, turning three cards at a time) and **Draw One** (the gentler,
more winnable deal, turning one) — which differ only in how the stock turns.

## What a model is given

A run receives the self-contained specification and the rendered reference
screenshots that act as visual targets — the title screen, a representative
mid-game table, and the win screen with its cascade. The reference *source*
mockups are withheld, so the look has to be rebuilt from the specification rather
than copied. There are no assets to provide: every card and the table are drawn
in code, guided by the palette and measurements in the specs.
