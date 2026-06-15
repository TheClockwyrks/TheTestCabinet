# Carom — Reference Visuals

These files are the **canonical visual reference** for the Carom test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage so
the testing harness can render and screenshot them deterministically. The
rendered screenshots serve two purposes: they are seeded into a run as visual
targets, and they are the baselines for any [validation
check](../validation.md#checks) that names the view.

## Source is rendered, not seeded

The mockup **source** in this `reference/` folder is **harness-side only** and is
never seeded into a run. What the model receives is the *rendered screenshot* of
each view (see [Generating screenshots](#generating-screenshots)), seeded as a
visual target alongside [`../specification.md`](../specification.md). Handing over
the source HTML/CSS would let a model copy the intended UI instead of building it
from the spec; a screenshot shows the target without giving away the
implementation.

## Views

Each file corresponds to a canonical view slug:

| View slug   | File              | Description                                  |
| ----------- | ----------------- | -------------------------------------------- |
| `title`     | `menu.html`       | Title screen and main menu.                  |
| `gameplay`  | `gameplay.html`   | Representative in-match frame.               |
| `game-over` | `game-over.html`  | Match-over result panel.                     |

`theme.css` holds the shared palette, type, and field furniture referenced by
all three views and by the specification.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build
output and are **git-ignored** (the repository ignores
`test-cases/**/reference/screenshots/`). The testing harness is expected to
render each file at a `1280x720` viewport (for example with Playwright) and write
the images under `reference/screenshots/`:

```
reference/screenshots/title.png
reference/screenshots/gameplay.png
reference/screenshots/game-over.png
```

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
