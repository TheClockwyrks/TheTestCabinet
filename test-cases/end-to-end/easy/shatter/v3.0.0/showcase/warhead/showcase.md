SCAFFOLD PLACEHOLDER — not the showcase.

This directory exists so `variants/warhead.toml` resolves: a declared showcase
must hold a non-empty `showcase.md`, a `showcase.toml` naming at least one
media file, and that file. The Showcase stage of the v3.0.0 rework replaces
all three, capturing from `references/none/warhead` driven through its own
`window.__shatter` surface with Playwright, and deletes `placeholder.png`.
