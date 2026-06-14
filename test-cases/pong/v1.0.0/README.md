# Pong — `v1.0.0` (Carom)

This is version `v1.0.0` of the **Pong** test case. The implemented game is an
original paddle-and-ball duel titled **Carom**: classic paddle mechanics plus a
**spin** mechanic (a paddle's motion curves the ball) and two **static
obstacles** in the field. A **Frenzy** mode adds an uncapped speed ramp.

Pong is the catalog slug for this lineage of paddle-and-ball cases; `Carom` is
the original in-game title. The case is inspired by classic paddle games but is
not a clone of any of them — the name, look, spin mechanic, and obstacle layout
are original to The Test Cabinet.

## Why Pong as the first test case

Pong is the simplest game in the catalog, which makes it the right case to
establish the test case format and exercise the harness end to end. It still
asks for a real, polished, rendered game with multiple screens, an AI opponent,
a physics loop, and a distinctive mechanic — enough to produce a meaningful run
without the scale of the harder cases.

## Contents

| Path                  | Seeded to run? | Purpose                                       |
| --------------------- | -------------- | --------------------------------------------- |
| `specification.md`    | **Yes**        | The spec handed to the model; the build task. |
| `reference/`          | No             | Canonical visual mockups for validation.      |
| `validation.md`       | No             | What the harness checks automatically.        |
| `README.md`           | No             | This overview.                                |

This version has **no assets**: Pong is simple enough to leave all visuals to the
model, guided by the palette and measurements in the specification.

Only `specification.md` (and assets, when a case has them) is seeded into a run's
repository. The reference visuals are deliberately withheld so a model cannot
copy them instead of building from the spec.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/pong/v1.0.0/`). Each version is self-contained and immutable once a
run references it; design revisions land as new version folders.
