- Reordered the common reviewer checklist so a reviewer testing one thing finds
  all of its checks together: the per-entity mechanics run first (ball and paddle
  physics, obstacles, scoring and match, the AI), then one contiguous
  global/systems block — `gameplay-keybinds`, `audio`, `menu-rendering`,
  `states-complete`, `fits-window` — with the two menu and screen items adjacent.
- No requirement was added, removed, or reworded, and no `weight`, `domain`,
  `reference`, `proof`, `id`, or `sub_items` changed. Scoring is
  order-independent, so this is purely reviewer ergonomics. The per-variant
  checklists are unchanged.
