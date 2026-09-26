# Orrery's Ghost, Rise And Set Baselines Show A Bare Field

`test-cases/full-stack/medium/orrery/v1.0.0` ships baseline media for every
scripted review item under `validation-baseline/<engine>/<variant>/`, captured
from the variant's reference implementation by `tcab capture-baselines`.

## Current behaviour

Three review items place a `wane` on a hex away from the square they read, so
that no reading of theirs is taken over an empty field. A build is free to draw
a prompt over a field with no parts on it, and that prompt stops being drawn the
moment a part is placed, which would otherwise change a square these items
require to be unchanged.

The four stills those items capture predate the placed `wane`:

- `editor.the-ghost-reads-legal-or-illegal__legal.png`
- `editor.the-ghost-reads-legal-or-illegal__illegal.png`
- `presentation.rise-shows-its-reagent-pattern__rise.png`
- `presentation.set-shows-its-product-pattern__set.png`

under `validation-baseline/{none,simple-2d,structured-2d}/base/`. The capture
labels are unchanged, so every still still has an item that names it. A reviewer
comparing a run's evidence against the baseline reads a field carrying one part
against a field carrying none.

No gate consumes `validation-baseline/`, so nothing fails today. The cost is a
reviewer's, and a later capture that rewrites these files reads as drift with no
cause attached to it.

## Design

Run `tcab capture-baselines orrery 1.0.0 --all-variants` and commit what it
writes. The directory is regenerated wholesale per variant and engine pair, so
the fix is the capture itself, and the diff is expected to touch the media of any
other item whose drive the same version changed.

The capture needs the case's toolchain and a browser, and it builds each
reference implementation before producing that pair's outputs.
