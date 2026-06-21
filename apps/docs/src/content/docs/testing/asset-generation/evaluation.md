---
title: Evaluation
---

An asset-generation run's output is the image the model produced — but the image
**regenerated from the recorded actions**, never the pixels the model left on
disk. The output of a run is the ordered
[action log](/testing/asset-generation/manifests/) the drawing binary recorded,
and evaluation begins by turning that log back into an image. Assessment is then
**subjective**: there is no target image and no automated similarity score — the
regenerated asset is judged by a human against the case's brief.

## Regeneration

The harness replays the recorded operations through the **same drawing logic** the
binary used and takes the **regenerated image** as the run's output. Because the
regeneration runs exactly the operations the model issued — and nothing else — an
image produced by any other means contributes nothing to the result. This is what
makes the constrained drawing channel enforceable rather than merely requested
(see [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).

For a **sprite sheet** each frame is its own separate file, so each is regenerated
independently and carries its own cheat-divergence number; there is **no
whole-sheet aggregate**. The `[sheet]` table's named
[sequences](/testing/asset-generation/manifests/) are surfaced to the reviewer and
**played back as live animations** in the review UI (the regenerated frames in
each named sequence's order) so a person can judge the motion the sheet encodes
against the brief. A checklist item may also
[name the sequences and frames it is about](/testing/asset-generation/manifests/#review-items-can-reference-sequences-and-frames),
in which case the reviewer is shown exactly those animations and frames beside the
item — with a toggle between the live animation and the still frames — instead of
scanning the whole sheet to find them.

## Cheat detection

Comparing the **regenerated image** against the **final image from the model's
run** is a second, independent signal. If a model drew only through the binary,
the two match. If they **diverge**, the model put pixels on the canvas outside the
recorded operations — for instance by writing an image file directly — which is a
strong sign it tried to bypass the drawing tool. The divergence is recorded so a
reviewer sees it; because only the regenerated image is ever scored, a model gains
nothing from drawing outside the tool, and the mismatch simply marks the attempt.

## Review

The human [review](/components/core/results/#reviews) is the assessment, not a
supplement to it: a published asset-generation run carries a writeup of how
convincingly the regenerated asset realizes the brief and how the model approached
the drawing, alongside the regenerated image and the recorded actions. The
cheat-detection signal informs that assessment — flagging a run that drew outside
the tool — but the judgment of the asset itself is the reviewer's.
