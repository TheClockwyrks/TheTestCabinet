# The repository's entry points. `make gate` is the command a developer runs
# over the whole tree.

.DEFAULT_GOAL := gate

.PHONY: gate clean

# Every gate under ci/gates/, in id order, through the runner that a commit
# hook and a pipeline step run one at a time. `--keep-going` makes one run
# enough to see the whole picture. See ci/README.md.
gate:
	@uv run --quiet --project ci gate run --all --keep-going

# What this repository's own tooling writes, removed with it: Cargo's build
# output, the installed npm packages the prose gates run, the `ci` project's
# environment and the caches beside it.
clean:
	@rm -rf target node_modules .cspellcache ci/.venv ci/.pytest_cache ci/.ruff_cache .ruff_cache
	@find ci -type d -name __pycache__ -prune -exec rm -rf {} +
