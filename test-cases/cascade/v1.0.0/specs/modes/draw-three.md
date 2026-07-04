# Draw Three

## Overview

This mode spec defines the one setting that varies by mode: the stock's **turn
count**. It builds on the stock and waste rules in `specs/rules.md` and the layout
in `specs/layout.md`.

## Deal mode

This build plays **Draw Three**: the classic Klondike deal.

- The stock's **turn count is three**. Clicking the stock turns **three** cards
  face-up onto the waste at once (or all that remain, if fewer than three are
  left). Only the **top** card of the waste is playable; the two beneath it become
  playable only as the top card is removed.
- The three turned cards are **fanned to the right** in the waste so all three are
  visible, with the playable top card frontmost and clear of the stock and the
  foundations (`specs/layout.md`). When only one or two cards were turned (the last
  of the stock), fan just those.
- Recycling is unlimited, exactly as `specs/rules.md` states: when the stock is
  empty, clicking its slot returns the whole waste to the stock, face-down and in
  order, for another pass. There is no pass limit.

## Menu and HUD label

- The mode's menu/HUD label is **`DRAW THREE`** (see the title menu and the HUD
  in `specs/flow.md`).
