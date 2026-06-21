---
title: Evaluation
---

An asset-generation run is scored on the image the model produced — but on the
image **regenerated from the recorded actions**, never on the pixels the model
left on disk. The output of a run is the ordered
[action log](/testing/asset-generation/manifests/) the drawing binary recorded,
and evaluation begins by turning that log back into an image.

## Regeneration

The harness replays the recorded operations through the **same drawing logic** the
binary used and takes the **regenerated image** as the test output. Because the
regeneration runs exactly the operations the model issued — and nothing else — an
image produced by any other means contributes nothing to the result. This is what
makes the constrained drawing channel enforceable rather than merely requested
(see [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).

## Fidelity to the target

The regenerated image is compared against the case's
[reference target](/testing/asset-generation/manifests/) to produce a
**similarity signal** — how close the drawing came to the goal. As with
end-to-end [checks](/testing/end-to-end/evaluation/#checks), this is a recorded
signal rather than a pass/fail gate: a faithful sprite scores well, a vague one
scores poorly, and the number is surfaced as recorded context for the reviewer.

For a **sprite sheet** this is unchanged: the regenerated **whole sheet** is
scored against the **whole target sheet** — fidelity is one number over the entire
image, not per frame or per sequence. The `[sheet]` table's named
[sequences](/testing/asset-generation/manifests/) do not enter scoring; they are
surfaced to the reviewer and **played back as live animations** in the review UI
(both the regenerated sheet and the target, sliced into each named sequence) so a
person can judge the motion the sheet encodes — a separate, human assessment
alongside the recorded fidelity number.

## Cheat detection

Comparing the **regenerated image** against the **final image from the model's
run** is a second, independent signal. If a model drew only through the binary,
the two match. If they **diverge**, the model put pixels on the canvas outside the
recorded operations — for instance by writing an image file directly — which is a
strong sign it tried to bypass the drawing tool. The divergence is recorded so a
reviewer sees it; because only the regenerated image is ever scored, a model gains
nothing from drawing outside the tool, and the mismatch simply marks the attempt.

## Review

As with the other types, a published asset-generation run may carry a human
[review](/components/core/results/#reviews) — a writeup of how convincingly the
asset matches the brief and how the model approached the drawing — alongside the
regenerated image and the recorded actions. The fidelity and cheat-detection
signals inform that assessment; they do not replace it.
