---
title: Test Case Groups
---

## Overview

A test-case group is a repo-defined, ordered set of related test cases, such as
the tower-defense cases. Groups exist for presentation: the home page renders
one cross-case leaderboard per group, so a visitor sees which models build the
best game of each kind without opening every member case.

Groups are global and shared by every visitor. They are distinct from two
neighbouring concepts: a case's `tags`, which classify one case for filtering,
and the per-account case groups of [coverage
plans](/components/backend/coverage/), which schedule a reviewer's runs. A
test-case group decides only what the home page presents.

## The group catalogue

A group is a directory under `test-case-groups/<slug>/` in the repository,
containing one manifest, `test-case-group.toml`, which declares:

- `slug`, the stable identifier, matching the directory name;
- `name`, the display name heading the group's leaderboard;
- `summary`, an optional one-line description;
- `rank`, an optional ordering key. Groups order by rank ascending, then by
  name, and ranked groups precede unranked ones.
- `cases`, the ordered list of member test-case or game-jam slugs. The list
  must be non-empty and free of duplicates.

A manifest carrying an unrecognized field is rejected. The catalogue is read
from the checkout at run time, like the test-case catalog, so authoring a group
is a manifest edit with no rebuild. `tcab test-case-groups` lists the
catalogue.

## Member validation

Every member slug must resolve in the test-case catalog, which covers test
cases and game jams alike. The repository's manifest test checks this against
the checkout, and the backend's ingest checks it again against the catalog it
is ingesting: a group naming a slug the catalog cannot resolve is rejected with
a logged error, and the remaining groups still ingest.

## Serving

The backend parses the groups on a whole-catalog ingest scan and writes the set
to its definition store, so a deployment serves the same groups a local
checkout resolves. The set is served in display order at
[`GET /test-case-groups`](/components/backend/api/#get-test-case-groups), with
the ordering rank already applied. An ingest that changes the set queues a
public snapshot refresh, and the snapshot carries the set as its own object, so
the static gallery renders the same groups; see [Public
Snapshot](/components/backend/snapshot/#test-case-groups).

## The home page leaderboard

The home page renders one leaderboard per group, folded from the scored runs of
the group's member cases at each case's current version. One row is a harness,
model, and engine combination. Rows rank by mean score fraction: a run
contributes its earned share of its own case's checklist weight, so runs of
cases with different point totals stay comparable. Ties break by the better
best rating, then by recency.

The top five rows are shown. Each row carries the model, the harness, the mean
score as a percentage, the mean comparable cost, and the row's best rating,
with the aesthetic rating beside it when the row has one. A game jam member
contributes its whole-game grade in place of a domain rating.
