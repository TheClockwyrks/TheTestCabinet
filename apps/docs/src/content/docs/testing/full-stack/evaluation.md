---
title: Evaluation
---

A full-stack run is scored exactly as an [end-to-end](/testing/end-to-end/evaluation/)
run is: an automated **validation** pass that catches gross failures cheaply,
followed by a hand-written **review** by a person who plays the build and assigns
the numbers — a **score** in points and a quality **rating** per scoring domain.
The one thing full-stack adds is that the reviewer also judges the **assets the
model produced**, because in a full-stack run the model made them.

Because the mechanics are the same as end-to-end, this page covers only how
full-stack differs; read [End to End →
Evaluation](/testing/end-to-end/evaluation/) for the shared detail, and the Core
docs it points at — [Validation](/components/core/validation/) and
[Results](/components/core/results/) — for the underlying mechanisms.

## Validation is unchanged

The automated pass is identical to end-to-end. The
[load check](/testing/end-to-end/evaluation/#load-check) builds the produced
implementation with the manifest's required
[`[build]` commands](/testing/full-stack/manifests/), serves the static output,
loads it in a headless browser, and records whether it runs at all — a program
that never loads is the clearest possible negative signal.
[Checks](/testing/end-to-end/evaluation/#checks) (opt-in reference comparison) and
[proofs](/testing/end-to-end/evaluation/#proofs) (evidence written to a known
path, recorded but not graded) work exactly as they do for an end-to-end case.

Crucially, there is **no asset-generation-style validation** of the produced
assets — no action-log regeneration and no cheat detection. Those exist in an
[asset-generation](/testing/asset-generation/evaluation/) run because the asset
_is_ the scored output there. In a full-stack run the produced files are
[build inputs](/testing/full-stack/overview/#produced-assets-are-build-inputs):
they are exercised only by being loaded and played inside the running program,
and they are judged as part of that program by the reviewer.

## Review

The real evaluation is the [review](/components/core/results/#reviews), carrying
the same three things as an [end-to-end
review](/testing/end-to-end/evaluation/#review): a **writeup**, a **rating per
scoring domain** (one of **flawless**, **great**, **passable**, **scuffed**, or
**broken**, for each [`[[domain]]`](/testing/full-stack/manifests/) in the run's
effective set,
the overall rating being the _worst_ across them), and a **checklist** of binary
**pass**/**fail** verdicts, one per [`[[review_item]]`](/testing/full-stack/manifests/)
(or one per [sub-item](/testing/end-to-end/manifests/#sub-items) for an item that
declares them).

What full-stack adds is that the reviewer, playing the build, is judging assets
the model **produced** rather than assets a case provided. The **quality of the
produced assets — the art, the sprite motion, the particle effects, and the
sound — is part of the experience being rated**, not a separate score. A case
makes this explicit by wording its review items and scoring domains to cover the
asset dimensions that matter (a domain or item for the art direction, for the
feel of the effects, for the audio), the same way an end-to-end case words items
for the mechanics it cares about. A build whose code is solid but whose assets
are placeholder rectangles or silence — the very thing the [quality
directive](/testing/full-stack/overview/#the-standing-quality-directive) warns
against — is unfinished work and should be rated as such.

## Scoring

Scoring is [identical to end-to-end](/testing/end-to-end/evaluation/#scoring):
each `[[review_item]]` carries a point **weight**, a `pass` earns it and a `fail`
earns none, and the run's **score** is the earned weight over the total declared
weight. The score and the overall rating are shown together on the run, and the
case's [leaderboard](/components/site/overview/#leaderboard) ranks models by
points. Publishing refuses a run with no review, so every published full-stack
implementation is both scored and framed by a human who played it and judged the
whole product — code and assets alike.
