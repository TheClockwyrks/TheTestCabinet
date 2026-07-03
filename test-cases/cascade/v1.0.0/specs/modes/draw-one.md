# Draw One

## Overview

This mode spec defines the one setting that varies by mode: the stock's **turn
count**. It builds on the stock and waste rules in `specs/rules.md` and the layout
in `specs/layout.md`.

## Deal mode

This build plays **Draw One**: the gentler Klondike deal.

- The stock's **turn count is one**. Clicking the stock turns exactly **one** card
  face-up onto the waste. That single card sits on top of the waste and is the
  playable card; the card beneath it (the previous turn) shows behind it.
- Because only one card is turned per click, the waste needs no multi-card fan;
  a single top card is shown at the waste position (`specs/layout.md`), with the
  prior card(s) squared beneath it.
- Recycling is unlimited, exactly as `specs/rules.md` states: when the stock is
  empty, clicking its slot returns the whole waste to the stock, face-down and in
  order, for another pass. There is no pass limit. (With Draw One and unlimited
  passes, every stock card is reachable, so this deal is the more winnable one.)

## Menu and HUD label

- The mode's menu/HUD label is **`DRAW ONE`** (see the title menu and the HUD in
  `specs/flow.md`).
