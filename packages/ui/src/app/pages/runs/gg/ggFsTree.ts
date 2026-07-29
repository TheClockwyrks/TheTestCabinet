// The shared shape of gg's explorer sidebars — the filesystem tree both the Agents
// explorer and the Project explorer are laid out as.
//
// Both draw the same thing (folders whose rows nest under them) and must draw it the
// same way, so the one rule that makes a tree read as a tree — the per-depth indent —
// lives here rather than in whichever explorer happened to need it first. It is an
// inline style rather than a CSS rule because nesting depth is unbounded in the Agents
// tree (an agent's subagents' subagents…), which a fixed set of descendant selectors
// cannot express.

// The left padding for a row at nesting `depth` (0 = a top-level folder). The base is
// `.fsRow`'s own horizontal padding, so a depth-0 row is exactly where it would have
// been without an indent, and each level steps in by a caret's width.
export function fsIndent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${0.5 + depth * 0.85}rem` };
}

// Join class names, dropping the falsy ones — the conditional-class idiom both
// explorers use for their active/selected rows.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
