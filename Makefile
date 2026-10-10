# The project's entry points. `make gate` is the command a developer runs over
# the whole tree, and it is the command the template's own gate runs against a
# freshly rendered workspace.

.DEFAULT_GOAL := gate

.PHONY: gate docs clean

# Every gate under ci/gates/, in id order, through the runner that a commit hook
# and a pipeline step run one at a time. `--keep-going` is what makes one run
# enough to see the whole picture: a failing gate names itself and the ones
# after it still run, so a developer fixes everything in one pass rather than
# one gate per run. See ci/README.md.
gate:
	@uv run --quiet --project ci gate run --all --keep-going

docs:
	@npm run --workspace apps/docs build

# What this project's own tooling writes, removed with it. A project that grows
# other build output adds it here.
#
# `target` is Cargo's build output, which stays in the checkout so this target
# can reach it.
#
# The installed dependencies go with it: they are the bulk of what a workspace
# holds on disk, `npm ci` puts exactly them back from the lockfile, and the
# gates that need them say so when they are absent.
#
# Every workspace's own `node_modules` goes with the root one. npm hoists the
# packages a workspace depends on to the root, so a nested `node_modules` holds
# the tooling's caches and nothing else: Astro writes its content store and Vite
# its bundled dependencies into `apps/docs/node_modules` and `apps/web/node_modules`,
# both of which grow with what they serve. The globs are the `workspaces`
# package.json declares, so a workspace added there is cleaned without touching
# this target.
#
# `apps/web/dist` is the web app's bundle, which `vite build` writes and the
# web gate runs, and `apps/docs/dist` the documentation site's.
#
# The `ci` project's own leavings go with them: the environment uv builds for it
# the first time a gate runs, and what the tools inside that environment
# remember between runs. All of it is rebuilt from `pyproject.toml` and
# `uv.lock`, and the bytecode caches are found rather than named because Python
# writes one beside every package it imports.
clean:
	@rm -rf target node_modules apps/*/node_modules packages/*/node_modules contracts/packages/*/node_modules \
		apps/docs/.astro apps/docs/dist apps/web/dist .cspellcache \
		ci/.venv ci/.pytest_cache ci/.ruff_cache .ruff_cache
	@find ci -type d -name __pycache__ -prune -exec rm -rf {} +
