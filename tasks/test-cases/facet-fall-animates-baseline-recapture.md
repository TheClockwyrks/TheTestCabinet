# Facet's Fall-Animates Baseline Shows A Different Drive

`test-cases/full-stack/easy/facet/v1.0.0` ships baseline media for every scripted
review item under `validation-baseline/<engine>/<variant>/`, captured from the
variant's reference implementation by `tcab capture-baselines`.

## Current behaviour

`appearance/fall-animates` opens its round the way a player does: the harness is
reset, the title is asserted, and `PLAY` is taken from the title menu, so the
frame that delivers `confirm` is the frame the fresh board is drawn on.

`validation-baseline/{simple-2d,structured-2d,none}/base/appearance.fall-animates__fall.json.gz`
holds a recording of the reference driven through the debug surface instead, with
the board posed by `dealBoard` and the round's other figures written field by
field. A reviewer comparing the build's recording against the reference's for
this item reads two different drives rather than two readings of one drive.

No gate consumes `validation-baseline/`, so nothing fails today. The cost is a
reviewer's, and a later capture that rewrites these files reads as drift with no
cause attached to it.

## Design

Run `tcab capture-baselines facet 1.0.0 --all-variants` and commit what it
writes. The directory is regenerated wholesale per variant and engine pair, so
the fix is the capture itself, and the diff is expected to touch the recordings
of any other item whose drive or media the same version changed.

The capture needs the case's toolchain and a browser, and it builds each
reference implementation before producing that pair's outputs.
