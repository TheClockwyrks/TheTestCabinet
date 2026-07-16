Reordered the common reviewer checklist so a reviewer testing one thing finds all
its checks together. No requirement was added, removed, or reworded, and no
`weight`, `domain`, `reference`, `proof`, `id`, or `sub_items` changed — scoring
is `scored/total` and order-independent, so this is purely a reviewer-ergonomics
change. The per-variant checklists (`base`, `gyre`, `multi`) were already well
grouped and are unchanged.

## Grouped the global/systems items away from the entity checks

`gameplay-keybinds` — a global input item (paddle movement keys and the pause
key) — previously sat at position seven, stranded between the ball-in-play
mechanics (spin, hit angle, rally speed, ball trail, obstacle bank shots) above it
and the scoring items below it. That interruption split the two entity clusters a
reviewer works through in one continuous rally. It now moves down into the tail
alongside the other cross-cutting/systems items, so the entity checks run
uninterrupted: the ball-and-paddle mechanics flow straight into scoring
(`scoring-point`, `match-win`, `match-deuce`) and then the AI check
(`ai-beatable`).

The checklist now reads as two clean blocks: the per-entity mechanics first
(ball/paddle physics, obstacles, scoring/match, AI), then one contiguous
global/systems cluster — `gameplay-keybinds`, `audio`, `states-complete`,
`menu-rendering`, `fits-window` — with no entity item interleaved among them.

## Put the two menu/screen items next to each other

Within that global cluster, `menu-rendering` (menus render cleanly and are
navigable) and `states-complete` (which enumerates the title, how-to-play, pause,
and match-over screens) are both about the game's menus and screens, but were
separated by `fits-window`. They are now adjacent, with `fits-window` (the field
fits and stays centered at any window size) following them.
