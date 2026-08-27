---
title: Evaluation
---

A game jam run is validated like a [full-stack](/testing/full-stack/evaluation/)
run and then reviewed by a person who plays it. The automated pass builds the
produced game with the manifest's `[build]` commands, serves the static output,
loads it in a headless browser, and records whether it runs at all. A build that
never loads leaves nothing to review, so the run is recorded as a catastrophic
failure rather than sent to review.

The review is where a jam differs. A jam has no specification to conform to and
no scoring domains, so it is graded on categories instead of scored against a
pass/fail checklist.

## The graded scale

The reviewer plays the entry and picks one of five tiers for each review
category.

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

The default categories are Playability, Fun, Theme, Presentation, Audio, Polish,
and Creativity. A jam may author its own; see
[Manifests](/testing/game-jam/manifests/).

## Scoring

A category's available points are `weight × 10`, and it earns its tier's points
times its weight. The default categories all have weight 1, so each is worth up
to 10 points. A run's score is the points earned over the points available, and
a run carrying several reviews averages the earned points across them over the
shared total. The [leaderboard](/components/site/overview/) ranks a jam's runs
by that score, the same points-based ranking every other type uses.

## The overall grade

Separately from the categories, the reviewer gives the game one overall grade on
the same five-level scale: a holistic read of the whole entry. It is supplied
directly rather than derived from the category grades, and it becomes the run's
rating badge on the site in place of the functional rating a jam does not carry.
When a run has more than one review, the displayed overall grade is the worst
any reviewer gave, mirroring how a domain-scored run's functional rating is the
worst across its domains.

The overall grade rides the ordinary review checklist under the reserved id
`overall` (`crate::review::OVERALL_VERDICT_ID`). It is not a declared category,
so it is excluded from the point score.

## Publishing

Publishing a completed run requires at least one review, so every published jam
entry has been played and graded by a person. A jam review records the category
grades, the overall grade, and a writeup, which is the prose shown before the
playable build.
