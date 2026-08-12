---
title: Evaluation
---

A game jam run is validated like a [full-stack](/testing/full-stack/evaluation/)
run — the automated [load check](/testing/end-to-end/evaluation/#load-check) builds
the produced game with the manifest's `[build]` commands, serves it, and records
whether it runs at all — and then **reviewed** by a person who plays it. What is
different is the **shape of the review**: a jam is not scored pass/fail against a
spec, because there is no spec. It is **graded**.

## Graded review, not pass/fail

Every other type reviews a run with per-domain quality ratings plus a pass/fail
checklist. A jam replaces both with a single **graded scale**. The reviewer plays
the entry and, for each review **category**, picks one of five tiers:

| Tier | Emoji | Points |
| --- | --- | --- |
| Broken | 💩 | 0 |
| Not great | 🙁 | 2 |
| Neutral | 😐 | 5 |
| Great | 😀 | 8 |
| Incredible | 💎 | 10 |

The scale is centred rather than punitive: a neutral category earns half its
available points and a great one four fifths, so a jam's percentage reads
comparably to a pass/fail case's earned-over-declared score.

The default categories are **Playability**, **Fun**, **Theme**, **Presentation**,
**Audio**, **Polish**, and **Creativity** (a jam may author its own; see
[Manifests](/testing/game-jam/manifests/)).

## Scoring

Each category is worth `weight × 10` points and earns its graded tier's points times
its weight; the default categories all have weight 1, so each is worth up to 10
points. A run's **score** is the total points earned across its categories, and the
[leaderboard](/components/site/overview/#leaderboard) ranks a jam's runs by their
average score across reviews — the same points-based ranking every other type uses,
just sourced from graded categories instead of a weighted pass/fail checklist.

## The overall grade

Separately from the categories, the reviewer gives the game **one overall grade** on
the same five-level scale — a holistic read of the whole entry. It is **supplied
directly, never derived** from the category grades, and it becomes the run's rating
**badge** on the site, standing in for the per-domain rating a jam does not carry.
When a run has more than one review, the displayed overall grade is the **worst**
any reviewer gave, mirroring how a domain-scored run's overall rating is the worst
across its domains.

Under the hood the overall grade rides the ordinary review checklist under the
reserved id **`overall`** (see `crate::review::OVERALL_VERDICT_ID`), so it needs no
separate storage; because it is not a declared category, it is excluded from the
point score.

## Publishing

As with every reviewed type, publishing refuses a jam run with no review, so every
published jam entry has been played and graded by a person. A jam review records the
category grades, the overall grade, and a **writeup** — the prose shown before the
playable build — and no per-domain ratings (a jam has no domains).
