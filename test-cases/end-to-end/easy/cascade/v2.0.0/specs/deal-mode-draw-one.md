# Draw One

## Overview

This spec defines this build's deal mode: the stock's turn count and its menu
label. It builds on the stock and waste rules in `specs/rules.md` and the layout
in `specs/table.md`.

## Deal mode

This build plays Draw One, the gentler Klondike deal.

- The stock's turn count is one. Clicking the stock turns exactly one card face-up
  onto the waste. That single card sits on top of the waste and is the playable
  card; the card beneath it (the previous turn) shows behind it.
- Because only one card is turned per click, the waste needs no multi-card fan; a
  single top card is shown at the waste position (`specs/table.md`), with the prior
  cards squared beneath it.
- Recycling is unlimited, exactly as `specs/rules.md` states: when the stock is
  empty, clicking its slot returns the whole waste to the stock, face-down and in
  order, for another pass. There is no pass limit. With Draw One and unlimited
  passes, every stock card is reachable, so this deal is the more winnable one.

## Menu and HUD label

- The mode's menu and HUD label is `DRAW ONE` (see the title menu and the HUD in
  `specs/states.md`).
