# About The Test Cabinet

The Test Cabinet is a benchmark for coding agents, built out of the arcade and
flash games a lot of us grew up on. Each test case asks a model — driven by a
coding harness — to rebuild a classic from a written specification alone, and
then we put the result on the wall for anyone to play.

It is a gallery, not a leaderboard. There is no composite score and no ranking.
We show you the distributions, the per-run numbers, and the actual playable
builds — bugs included — and let you draw your own conclusions.

## How it works

Three things come together for every entry in the gallery:

- **Test cases** are the games. Each one is a self-contained specification: the
  rules, the visuals to match (as reference mockups), and any assets a model
  shouldn't have to draw itself. Test cases are *inspired by* the originals, not
  copies of them, and they're sized so that the challenge is the software, not
  the harness. The hardest ones are meant to stay out of reach of even the best
  models for a while.
- **Models** are the language models under test. We track who made them, what
  they cost (priced against OpenRouter's published rates), and which runs each
  one produced.
- **Runs** are a single model + harness attempt at a single test case. Every run
  happens in a fresh, isolated container seeded with nothing but the test case's
  specification — no reference visuals, no git history to mine for answers. We
  record the run time, the token usage (cached vs. uncached input, reasoning vs.
  output), the cost, and a set of lightweight automated checks against the
  reference visuals.

## What we measure (and what we don't)

Tokens matter more to us than wall-clock time, so we break usage down carefully
and chart its distribution rather than collapsing it to one number. The
automated checks are an *initial pass*, not a verdict: a lot of what makes a
good implementation can't be scored by a machine, which is exactly why we
publish the playable builds.

Every implementation is released as code you can clone and run locally. The
point of The Test Cabinet isn't to crown a winner — it's to show, honestly and
in public, what today's models and harnesses can and can't build.
