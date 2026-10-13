---
title: Test Case Groups
---

## Overview

A test-case group is a repo-defined, ordered set of related test cases, such as
the tower-defense cases. Groups exist for presentation: the home page renders
one cross-case leaderboard per group, so a visitor sees which models build the
best game of each kind without opening every member case.

Groups are global and shared by every visitor, and they decide only what the
home page presents. A case's `tags` classify one case for filtering, and the
per-reviewer case groups of [coverage plans](/components/backend/coverage/)
schedule a reviewer's runs.

## The group catalogue

A group is a directory under `test-case-groups/<slug>/` in the `test-suites`
repository, containing one manifest, `test-case-group.toml`, which declares:

- `slug`, the stable identifier, matching the directory name;
- `name`, the display name;
- `summary`, an optional one-line description;
- `rank`, an optional ordering key. Groups order by rank ascending, then by
  name, and ranked groups precede unranked ones.
- `cases`, the ordered list of member test-case or game-jam slugs. The list
  must be non-empty and free of duplicates.

A manifest carrying an unrecognized field is rejected. The catalogue is read
from the checkout at ingest, like the test-case catalog, so authoring a group
is a manifest edit with no rebuild.

## Member validation

Every member slug must resolve in the test-case catalog, which covers test
cases and game jams alike. `test-suites`' manifest test checks this against the
checkout, and the backend's ingest checks it again against the catalog it
is ingesting: a group naming a slug the catalog cannot resolve is rejected with
a logged error, and the remaining groups still ingest.

## Serving

The backend parses the groups on a whole-catalog ingest scan and writes the set
to its definition store, so a deployment serves the same groups a local
checkout resolves. A scan that accepts no group leaves a non-empty stored set in
place and reports the refusal, so an absent or misplaced `test-case-groups/`
cannot empty the home page. Retiring every group is therefore applied by hand,
by deleting `test-case-groups/test-case-groups.json` from the definition store,
which then reads as no group (see [the prune
guard](/components/backend/overview/#test-case-definitions)). The set is served
in display order at
[`GET /test-case-groups`](/components/backend/api/#get-test-case-groups), with
the ordering rank already applied. An ingest that changes the set rewrites the
public dataset's index objects, which carry the set as an object of their own,
so the static gallery renders the same groups; see [Public
Snapshot](/components/backend/snapshot/#test-case-groups).

## The home page leaderboard

A group's leaderboard is folded from the scored runs of its member cases at each
case's current version, grouped by harness, model, and engine. Entries rank by
mean score fraction: a run contributes its earned share of its own case's
checklist weight, so runs of cases with different point totals stay comparable.
Ties break by the better best rating, then by recency. A game jam member
contributes its whole-game grade in place of a functional rating.
