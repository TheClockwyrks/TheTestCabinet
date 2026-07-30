import type { CSSProperties } from "react";

// The shared shape of gg's explorer sidebars — the filesystem tree both the Agents
// explorer and the Project explorer are laid out as.
//
// Both draw the same thing (folders whose rows nest under them) and must draw it the
// same way, so the one rule that makes a tree read as a tree — the per-depth indent —
// lives here rather than in whichever explorer happened to need it first. It is an
// inline style rather than a CSS rule because nesting depth is unbounded in the Agents
// tree (an agent's subagents' subagents…), which a fixed set of descendant selectors
// cannot express.

// The left padding for a row at nesting `depth` (0 = a top-level folder): a 0.5rem base
// plus 0.85rem a level. The base is a shade wider than `.fsRow`'s own 0.25rem horizontal
// padding it replaces, so the top level reads as the tree keeping a margin off the
// sidebar's edge rather than as an indent level of its own, and each level below it steps
// in by roughly a caret's width — enough that a child clears the guideline its parent
// drops (see `fsGuide`) rather than landing on it.
//
// Because this is an inline style it beats anything the stylesheet says about a row's
// `padding-left`, which is why a file row makes room for its missing caret with a spacer
// *inside* the row (`.fsFile::before`) rather than with extra padding. The same three
// numbers are written down in `GgPanels.module.scss` as `$fs-indent-base`,
// `$fs-indent-step` and `$fs-caret-size`; the two copies have to agree.
export function fsIndent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${0.5 + depth * 0.85}rem` };
}

// The depth an open folder's *own* guideline is drawn at — the vertical rule that drops
// from its caret down through everything it holds, so a row's folder is legible without
// counting indents (and, on hover, so the whole lineage of the row under the pointer
// lights up: see `.fsChildren::before` and the tiers below it in `GgPanels.module.scss`).
//
// It rides on the child list rather than on the folder row because the rule spans the
// children's box, and it is a custom property rather than a class because the Agents tree
// nests without bound (an agent's subagents' subagents…), which no fixed set of selectors
// can express. Pass the *folder's* depth — the same `depth` its row was given — and the
// stylesheet puts the rule on the centre line of that row's caret slot: `fsIndent(depth)`
// is the slot's left edge, and half the slot's 0.9rem width steps in to its centre (0.95rem
// at depth 0, 2.65rem at depth 2). An open caret is a chevron rotated to point straight
// down that line, so the rule descends from the arrow's tip.
export function fsGuide(depth: number): CSSProperties {
  // A custom property is not part of `CSSProperties`, so the cast is what lets a caller
  // hand this straight to `style` (React passes unknown `--*` keys through verbatim).
  return { "--gg-guide-depth": depth } as CSSProperties;
}

// Join class names, dropping the falsy ones — the conditional-class idiom both
// explorers use for their active/selected rows.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
