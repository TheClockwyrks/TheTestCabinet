# Carom — Reference Visuals

These files are the **canonical visual reference** for the Carom test case. They
are authored as self-contained static HTML on a fixed `1280x720` logical stage
so the testing harness can render and screenshot them deterministically, and so
they double as the reference images used for the
[reference comparison](../validation.md#reference-comparison) step of validation.

## Important: not seeded to the run

The contents of this `reference/` folder are **harness-side only**. They must
**not** be seeded into a run's repository. Only [`../specification.md`](../specification.md)
(and a test case's assets, of which Carom has none) is handed to the model. If
the reference visuals were seeded, a model could simply copy them instead of
building the game from the spec.

## Views

Each file corresponds to a canonical view slug used by validation:

| View slug   | File              | Description                                  |
| ----------- | ----------------- | -------------------------------------------- |
| `title`     | `menu.html`       | Title screen and main menu.                  |
| `gameplay`  | `gameplay.html`   | Representative in-match frame.               |
| `game-over` | `game-over.html`  | Match-over result panel.                     |

`theme.css` holds the shared palette, type, and field furniture referenced by
all three views and by the specification.

## Generating screenshots

The mockups are the source of truth; their rendered screenshots are a build
output and are **git-ignored** (see [`../.gitignore`](../.gitignore)). The
testing harness is expected to render each file at a `1280x720` viewport (for
example with Playwright) and write the images under `reference/screenshots/`:

```
reference/screenshots/title.png
reference/screenshots/gameplay.png
reference/screenshots/game-over.png
```

Because the files are plain static HTML with no scripts or network access, they
can be opened directly (`file://`) or served as static files for rendering.
