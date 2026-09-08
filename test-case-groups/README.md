# Test-Case Groups

Each test-case group The Test Cabinet's home page presents is defined here, one
directory per group, named with the group's stable slug.

A group is a global, ordered set of related test-case or game-jam slugs. The
home page renders one cross-case leaderboard per group, so a visitor sees which
models build the best game of each kind. A group is presentation only: it is
**not** a case's `tags`, which classify a single case for filtering, and it is
**not** the per-account "case group" of the console's
[coverage plans](../apps/docs/src/content/docs/components/backend/coverage.md),
which schedules a reviewer's runs.

```
test-case-groups/
├── arcade-physics/test-case-group.toml   # one manifest per group
├── sim-economy/test-case-group.toml
└── tower-defense/test-case-group.toml
```

Groups are read from this directory at run time, like the test-case catalog,
and the backend ingests them into its definition store alongside the cases, so
a backend-driven deployment serves the same set a local checkout resolves. The
authoritative design lives at
[`components/core/test-case-groups.md`](../apps/docs/src/content/docs/components/core/test-case-groups.md).

## Manifest

Each `test-case-group.toml` declares:

| Field     | Meaning                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `slug`    | Stable slug; must match the directory name.                                                                                |
| `name`    | Human-readable name, heading the group's home-page leaderboard.                                                            |
| `summary` | Optional one-line description.                                                                                             |
| `rank`    | Optional ordering key. Groups order by rank ascending, then by name; ranked groups precede unranked ones.                  |
| `cases`   | Ordered, non-empty list of member test-case or game-jam slugs, without duplicates. Every slug must resolve in the catalog. |
