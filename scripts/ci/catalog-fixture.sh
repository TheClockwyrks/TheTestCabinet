# shellcheck shell=bash
# A catalog mirror and its cold storage, as two local repositories, for the tests of
# the catalog ingest (catalog-ingest.test.sh, catalog-ingest-sidecar.test.sh and
# deploy.test.sh).
#
# Sourced, not executed. The repositories are reached over file://, which shallow
# and filtered fetches treat as they treat a network remote, so the scripts under
# test run their real git commands against them and nothing reaches a network.
#
#   catalog_fixture <dir>          builds <dir>/TheTestCabinet.git, with the branches
#                                  `staging` and `master` at one commit that pins
#                                  cold storage, and <dir>/cold-storage beside it,
#                                  where `.gitmodules` (url = ../cold-storage) says
#   catalog_fixture_unpin <dir>    moves both branches onto a commit pinning a
#                                  cold-storage commit that no repository holds
#
# It sets CATALOG_REPO (the mirror's URL), CATALOG_TIP (the branches' commit) and
# CATALOG_PIN (the cold-storage commit the tip pins).
#
# The three are read by the sourcing test, across the source boundary.
# shellcheck disable=SC2034

# git as the fixtures and the scripts under test run it: no configuration but the
# fixture's own, an identity to commit with, and file:// allowed for a submodule.
catalog_fixture_env() {
	export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
	export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
	export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
	export GIT_CONFIG_COUNT=2
	export GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always
	export GIT_CONFIG_KEY_1=advice.detachedHead GIT_CONFIG_VALUE_1=false
}

# A bare repository that serves a commit by its id and honours a fetch filter, as
# the GitHub mirror does.
catalog_fixture_bare() { # path
	git init --quiet --bare --initial-branch=main "$1"
	git -C "$1" config uploadpack.allowAnySHA1InWant true
	git -C "$1" config uploadpack.allowFilter true
}

# Commits the superproject's tree with cold storage pinned at $2 and pushes it to
# both catalog branches.
catalog_fixture_publish() { # dir pin
	local work="$1/catalog-work"
	git -C "$work" update-index --add --cacheinfo "160000,$2,cold-storage"
	git -C "$work" commit --quiet -m "pin cold storage at $2"
	git -C "$work" push --quiet --force origin HEAD:refs/heads/staging HEAD:refs/heads/master
	CATALOG_TIP="$(git -C "$work" rev-parse HEAD)"
	CATALOG_PIN="$2"
}

catalog_fixture() { # dir
	local dir="$1" pin
	catalog_fixture_env
	catalog_fixture_bare "$dir/cold-storage"
	git init --quiet --initial-branch=main "$dir/cold-work"
	mkdir -p "$dir/cold-work/test-cases/demo/v1.0.0/validation-baseline"
	echo "baseline" >"$dir/cold-work/test-cases/demo/v1.0.0/validation-baseline/frame.json"
	git -C "$dir/cold-work" add .
	git -C "$dir/cold-work" commit --quiet -m "baselines"
	git -C "$dir/cold-work" push --quiet "file://$dir/cold-storage" HEAD:refs/heads/main
	pin="$(git -C "$dir/cold-work" rev-parse HEAD)"

	catalog_fixture_bare "$dir/TheTestCabinet.git"
	git init --quiet --initial-branch=main "$dir/catalog-work"
	git -C "$dir/catalog-work" remote add origin "file://$dir/TheTestCabinet.git"
	printf '[submodule "cold-storage"]\n\tpath = cold-storage\n\turl = ../cold-storage\n' >"$dir/catalog-work/.gitmodules"
	mkdir -p "$dir/catalog-work/test-cases"
	echo "demo" >"$dir/catalog-work/test-cases/demo.toml"
	git -C "$dir/catalog-work" add .gitmodules test-cases
	CATALOG_REPO="file://$dir/TheTestCabinet.git"
	catalog_fixture_publish "$dir" "$pin"
}

catalog_fixture_unpin() { # dir
	catalog_fixture_publish "$1" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
}
