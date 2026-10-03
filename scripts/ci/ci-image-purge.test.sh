#!/usr/bin/env bash
# Table test for ci-image-purge.sh. Run it directly:
# scripts/ci/ci-image-purge.test.sh
#
# No case reaches the registry or a remote. A copy of the script runs in a
# throwaway repository with `curl` and `git` stubbed first on PATH and a docker
# configuration of the case's own. The curl stub answers the token endpoint,
# serves each repository's catalogue from a fixture, and records every DELETE
# with the status a variable names; the git stub fetches a branch when a
# fixture holds its ci/images/tags.yml and shows that file. The subject is
# which tags are kept (the three live branches' pins plus the checkout's),
# what goes, the cache repository, the credential forms, and the refusals.
set -uo pipefail

# Azure sets BUILD_SOURCEVERSION for every step, and the script keeps the image
# of the commit it names, so a run of this test on the pipeline would keep one
# tag more than every case expects. The cases that are about that commit name
# it themselves, so it is forgotten here.
unset BUILD_SOURCEVERSION

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the ci-image-purge test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
stub="$tmp/stub"
docker="$tmp/docker"
mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/ci/images" "$stub" "$docker"
cp "$CI_DIR/ci-image-purge.sh" "$repo/scripts/ci/"

readonly REGISTRY="testcabinet.azurecr.io"
readonly REPOSITORY="ubuntu-the-test-cabinet-rust-cicd"
# The commit each revision of ci/images/tags.yml pins, shaped as the image
# pipeline tags an image, and one no revision pins.
readonly CHECKOUT="c0ffee0000000000000000000000000000000001"
readonly MASTER="c0ffee0000000000000000000000000000000002"
readonly STAGING="c0ffee0000000000000000000000000000000003"
readonly NIGHTLY="c0ffee0000000000000000000000000000000004"
readonly STALE="c0ffee0000000000000000000000000000000005"
readonly OWN="c0ffee0000000000000000000000000000000006"

# curl: the URL is the one argument that names the registry. A DELETE is
# answered with the status STUB_DELETE_STATUS names and logged; the catalogue
# of a repository is <repository>.manifests.json; the token endpoint mints a
# token naming the scope it was asked for.
cat >"$repo/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
url=""
method=GET
authorization=""
scope=""
while [ $# -gt 0 ]; do
	case "$1" in
		--request) method="$2"; shift ;;
		--header) [[ "$2" == Authorization:* ]] && authorization="${2#Authorization: }"; shift ;;
		--data-urlencode)
			method=POST
			[[ "$2" == scope=* ]] && scope="${2#scope=}"
			shift
			;;
		--output | --write-out) shift ;;
		http*) url="$1" ;;
	esac
	shift
done
printf '%s %s %s\n' "$method" "$url" "$authorization" >>"$STUB_DIR/curl.log"
case "$url" in
	*/oauth2/token)
		printf '{"access_token":"token-for-%s"}\n' "$scope"
		;;
	*/acr/v1/*/_manifests*)
		repository="${url#*/acr/v1/}"
		repository="${repository%%/*}"
		if [ -f "$STUB_DIR/$repository.manifests.json" ]; then
			cat "$STUB_DIR/$repository.manifests.json"
		else
			exit 22
		fi
		;;
	*/v2/*/manifests/*)
		[ "$method" = DELETE ] || exit 22
		path="${url#*/v2/}"
		echo "${path%%/manifests/*}@${path##*/manifests/}" >>"$STUB_DIR/deleted.log"
		printf '%s' "${STUB_DELETE_STATUS:-202}"
		;;
	*)
		echo "curl stub: unexpected $url" >&2
		exit 1
		;;
esac
STUB

# git: a branch fetches when branch-<name>.yml exists, and FETCH_HEAD's
# ci/images/tags.yml is that file until the next fetch.
cat >"$repo/bin/git" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
while [[ "${1:-}" == -c ]]; do
	printf 'config %s\n' "$2" >>"$STUB_DIR/git.log"
	shift 2
done
printf '%s\n' "$*" >>"$STUB_DIR/git.log"
case "$1" in
	rev-parse)
		case "$2" in
			--is-shallow-repository) echo "${STUB_SHALLOW:-false}" ;;
			--verify) [ -z "${STUB_HEAD:-}" ] && exit 1 || echo "$STUB_HEAD" ;;
			*) echo "git stub: unexpected $*" >&2; exit 1 ;;
		esac
		;;
	fetch)
		branch="${*: -1}"
		if [ -f "$STUB_DIR/branch-$branch.yml" ]; then
			echo "$branch" >"$STUB_DIR/fetched"
		else
			echo "fatal: couldn't find remote ref $branch" >&2
			exit 128
		fi
		;;
	ls-tree)
		branch="$(cat "$STUB_DIR/fetched")"
		[ "$2" = "FETCH_HEAD" ] && [ "$3" = "ci/images/" ] || exit 128
		[ -z "${STUB_NO_IMAGES_ON:-}" ] || [ "$branch" != "$STUB_NO_IMAGES_ON" ] || exit 0
		echo "040000 tree 0000000000000000000000000000000000000000	ci/images"
		;;
	show)
		branch="$(cat "$STUB_DIR/fetched")"
		[ "$2" = "FETCH_HEAD:ci/images/tags.yml" ] || exit 128
		[ -z "${STUB_NO_PINS_ON:-}" ] || [ "$branch" != "$STUB_NO_PINS_ON" ] || exit 128
		cat "$STUB_DIR/branch-$branch.yml"
		;;
	*) echo "git stub: unexpected $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$repo/bin/curl" "$repo/bin/git"

at() { date --utc --date="$1" +%Y-%m-%dT%H:%M:%S.0000000Z; }

pins() { # commit
	printf 'variables:\n  ciImageTag: %s\n' "$1"
}

manifest() { # digest when [tag...]
	local digest="$1" when="$2"
	shift 2
	jq -n --arg digest "$digest" --arg when "$when" --args \
		'{digest: $digest, lastUpdateTime: $when,
		  tags: ($ARGS.positional | if length == 0 then null else . end)}' "$@"
}

basic_config() { # user password
	printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$REGISTRY" "$(printf '%s:%s' "$1" "$2" | base64 -w0)" \
		>"$docker/config.json"
}

write_fixtures() {
	rm -rf "$stub"
	mkdir -p "$stub"
	pins "$CHECKOUT" >"$repo/ci/images/tags.yml"
	pins "$MASTER" >"$stub/branch-master.yml"
	pins "$STAGING" >"$stub/branch-staging.yml"
	pins "$NIGHTLY" >"$stub/branch-nightly.yml"
	{
		echo '{"manifests":['
		manifest sha256:checkout "$(at '1 hour ago')" "$CHECKOUT"
		echo ,
		manifest sha256:master "$(at '3 days ago')" "$MASTER"
		echo ,
		manifest sha256:staging "$(at '2 days ago')" "$STAGING"
		echo ,
		manifest sha256:nightly "$(at '1 day ago')" "$NIGHTLY"
		echo ,
		manifest sha256:stale "$(at '10 days ago')" "$STALE"
		echo ,
		manifest sha256:own "$(at '1 minute ago')" "$OWN"
		echo ,
		manifest sha256:untagged-old "$(at '2 hours ago')"
		echo ,
		manifest sha256:untagged-young "$(at '10 minutes ago')"
		echo ']}'
	} >"$stub/$REPOSITORY.manifests.json"
	{
		echo '{"manifests":['
		manifest sha256:cache-tag "$(at '10 days ago')" buildcache
		echo ,
		manifest sha256:cache-old "$(at '2 days ago')"
		echo ,
		manifest sha256:cache-young "$(at '5 minutes ago')"
		echo ']}'
	} >"$stub/$REPOSITORY-cache.manifests.json"
	basic_config "principal-id" "principal-secret"
}

run() {
	(cd / && env PATH="$repo/bin:$PATH" STUB_DIR="$stub" DOCKER_CONFIG="$docker" HOME="$tmp" \
		"$repo/scripts/ci/ci-image-purge.sh" "$@" 2>&1)
}
deleted() { cat "$stub/deleted.log" 2>/dev/null; }

echo "--- the default policy ---"
write_fixtures
out="$(run rust)"
check_equal "exits 0" "0" "$?"
check_equal "keeps the checkout's pin and the three live branches'" \
	"${REPOSITORY}: keeping $CHECKOUT $MASTER $STAGING $NIGHTLY " "$(head -1 <<<"$out")"
check_contains "deletes an unkept tag" "deleted ${REPOSITORY}@sha256:stale" "$out"
check_contains "deletes an untagged manifest older than an hour" "deleted ${REPOSITORY}@sha256:untagged-old" "$out"
check_lacks "keeps a young untagged one" "sha256:untagged-young" "$out"
check_lacks "keeps the cache repository's tag" "sha256:cache-tag" "$out"
check_contains "deletes the cache repository's old untagged manifests" "deleted ${REPOSITORY}-cache@sha256:cache-old" "$out"
check_lacks "not its young one" "sha256:cache-young" "$out"
check_equal "the deletes, in order" \
	"${REPOSITORY}@sha256:stale
${REPOSITORY}@sha256:own
${REPOSITORY}@sha256:untagged-old
${REPOSITORY}-cache@sha256:cache-old" "$(deleted)"
check_contains "fetches master" "fetch --quiet origin master" "$(cat "$stub/git.log")"
check_contains "staging" "fetch --quiet origin staging" "$(cat "$stub/git.log")"
check_contains "and nightly" "fetch --quiet origin nightly" "$(cat "$stub/git.log")"
check_contains "lists through the catalogue" \
	"GET https://${REGISTRY}/acr/v1/${REPOSITORY}/_manifests?n=500 Basic" "$(cat "$stub/curl.log")"
check_contains "with the service principal's credential as Basic" \
	"DELETE https://${REGISTRY}/v2/${REPOSITORY}/manifests/sha256:stale Basic $(printf 'principal-id:principal-secret' | base64 -w0)" \
	"$(cat "$stub/curl.log")"
check_lacks "and exchanges no token" "oauth2/token" "$(cat "$stub/curl.log")"

echo "--- the commit this run is on ---"
write_fixtures
out="$(BUILD_SOURCEVERSION=$OWN run rust)"
check_equal "exits 0" "0" "$?"
check_contains "keeps the image the run pushed, named by Azure" \
	"${REPOSITORY}: keeping $CHECKOUT $MASTER $STAGING $NIGHTLY $OWN" "$out"
check_lacks "and does not delete it" "@sha256:own" "$(deleted)"
check_contains "while still deleting the stale one" "${REPOSITORY}@sha256:stale" "$(deleted)"
write_fixtures
out="$(STUB_HEAD=$OWN run rust)"
check_equal "asked of git in a terminal, exits 0" "0" "$?"
check_contains "and keeps it too" "keeping $CHECKOUT $MASTER $STAGING $NIGHTLY $OWN" "$out"
write_fixtures
out="$(BUILD_SOURCEVERSION=not-a-commit run rust)"
check_equal "a value that is no object id exits 0" "0" "$?"
check_lacks "and is not kept" "not-a-commit" "$out"
check_contains "so the run's image, unnamed, is deleted with the rest" "${REPOSITORY}@sha256:own" "$(deleted)"

echo "--- the web track ---"
write_fixtures
cp "$stub/$REPOSITORY.manifests.json" "$stub/ubuntu-the-test-cabinet-web-cicd.manifests.json"
cp "$stub/$REPOSITORY-cache.manifests.json" "$stub/ubuntu-the-test-cabinet-web-cicd-cache.manifests.json"
out="$(run web)"
check_equal "exits 0" "0" "$?"
check_contains "keeps the same pins, which name both tracks' images" \
	"ubuntu-the-test-cabinet-web-cicd: keeping $CHECKOUT $MASTER $STAGING $NIGHTLY" "$out"
check_contains "and deletes the web repository's unkept tag" "ubuntu-the-test-cabinet-web-cicd@sha256:stale" "$(deleted)"
check_lacks "keeping master's" "ubuntu-the-test-cabinet-web-cicd@sha256:master" "$(deleted)"

echo "--- --dry-run ---"
write_fixtures
out="$(run --dry-run rust)"
check_equal "exits 0" "0" "$?"
check_contains "prints what it would delete" "would delete ${REPOSITORY}@sha256:stale" "$out"
check_contains "in the cache repository too" "would delete ${REPOSITORY}-cache@sha256:cache-old" "$out"
check_equal "and deletes nothing" "" "$(deleted)"
check_lacks "sending no DELETE" "DELETE" "$(cat "$stub/curl.log")"

echo "--- the job token and a shallow checkout ---"
write_fixtures
out="$(SYSTEM_ACCESSTOKEN=job-token STUB_SHALLOW=true run rust)"
check_equal "exits 0" "0" "$?"
check_contains "fetches with the job's token" "config http.extraheader=AUTHORIZATION: bearer job-token" "$(cat "$stub/git.log")"
check_contains "and one commit deep" "fetch --quiet --depth 1 origin master" "$(cat "$stub/git.log")"

echo "--- a branch that cannot be fetched ---"
write_fixtures
rm "$stub/branch-staging.yml"
out="$(run rust)"
check_equal "exits 1" "1" "$?"
check_contains "refuses" "cannot fetch origin/staging; refusing to purge" "$out"
check_equal "and deletes nothing" "" "$(deleted)"
check_lacks "having listed nothing" "_manifests" "$(cat "$stub/curl.log" 2>/dev/null)"

write_fixtures
out="$(STUB_NO_PINS_ON=nightly run rust)"
check_equal "a branch without the pins file refuses too" "1" "$?"
check_contains "naming it" "origin/nightly carries no ci/images/tags.yml; refusing to purge" "$out"
check_equal "and deletes nothing" "" "$(deleted)"

write_fixtures
out="$(STUB_NO_PINS_ON=master STUB_NO_IMAGES_ON=master run rust)"
check_equal "a branch with no ci/images/ at all pins nothing, and exits 0" "0" "$?"
check_contains "saying so" "origin/master predates ci/images/ and pins nothing" "$out"
check_contains "keeping the others" "${REPOSITORY}: keeping $CHECKOUT $STAGING $NIGHTLY" "$out"
check_contains "and deleting what only it named" "${REPOSITORY}@sha256:master" "$(deleted)"

write_fixtures
printf 'variables:\n  otherTag: %s\n' "$MASTER" >"$stub/branch-staging.yml"
out="$(run rust)"
check_equal "a branch whose file pins nothing this reads refuses too" "1" "$?"
check_contains "naming it" "origin/staging pins no ciImageTag or rustImageTag in ci/images/tags.yml; refusing to purge" "$out"
check_equal "and deletes nothing" "" "$(deleted)"

echo "--- a branch still on the per-track pins ---"
write_fixtures
printf 'variables:\n  rustImageTag: v1-e9e53ee1c4db\n  webImageTag: v1-ffe3b49d464e\n' >"$stub/branch-staging.yml"
out="$(run rust)"
check_equal "exits 0" "0" "$?"
check_contains "keeps this track's old tag in place of its ciImageTag" \
	"${REPOSITORY}: keeping $CHECKOUT $MASTER $NIGHTLY v1-e9e53ee1c4db" "$out"
check_lacks "and not the other track's" "v1-ffe3b49d464e" "$out"

echo "--- a checkout whose file pins nothing ---"
write_fixtures
printf 'variables:\n  otherTag: %s\n' "$MASTER" >"$repo/ci/images/tags.yml"
out="$(run rust)"
check_equal "exits 0" "0" "$?"
check_contains "keeps the live branches' pins" "${REPOSITORY}: keeping $MASTER $STAGING $NIGHTLY" "$out"
check_contains "and deletes the checkout's former image" "${REPOSITORY}@sha256:checkout" "$(deleted)"

echo "--- a delete that fails ---"
write_fixtures
out="$(STUB_DELETE_STATUS=403 run rust)"
check_equal "exits 1" "1" "$?"
check_contains "reports the status" "FAILED to delete ${REPOSITORY}@sha256:stale (HTTP 403)" "$out"
check_contains "and continues" "FAILED to delete ${REPOSITORY}-cache@sha256:cache-old (HTTP 403)" "$out"
write_fixtures
out="$(STUB_DELETE_STATUS=404 run rust)"
check_equal "a manifest already gone is not a failure" "0" "$?"
check_contains "and says so" "already gone ${REPOSITORY}@sha256:untagged-old" "$out"

echo "--- a developer's az acr login ---"
write_fixtures
basic_config "00000000-0000-0000-0000-000000000000" "refresh-token"
out="$(run rust)"
check_equal "exits 0" "0" "$?"
check_contains "exchanges the refresh token for one scoped to the repository" \
	"POST https://${REGISTRY}/oauth2/token" "$(cat "$stub/curl.log")"
check_contains "and deletes as Bearer" \
	"DELETE https://${REGISTRY}/v2/${REPOSITORY}/manifests/sha256:stale Bearer token-for-repository:${REPOSITORY}:pull,delete,metadata_read" \
	"$(cat "$stub/curl.log")"
check_contains "with a token of the cache repository's own" \
	"DELETE https://${REGISTRY}/v2/${REPOSITORY}-cache/manifests/sha256:cache-old Bearer token-for-repository:${REPOSITORY}-cache:pull,delete,metadata_read" \
	"$(cat "$stub/curl.log")"

write_fixtures
printf '{"auths":{"%s":{"identitytoken":"identity-token"}}}\n' "$REGISTRY" >"$docker/config.json"
out="$(run rust)"
check_equal "an identitytoken is exchanged the same way" "0" "$?"
check_contains "and deletes as Bearer" "manifests/sha256:stale Bearer token-for-repository:${REPOSITORY}:pull" "$(cat "$stub/curl.log")"

write_fixtures
printf '{"auths":{}}\n' >"$docker/config.json"
out="$(run rust)"
check_equal "no credential at all fails" "1" "$?"
check_contains "naming the registry" "the docker configuration holds no credential for ${REGISTRY}" "$out"
rm "$docker/config.json"
out="$(run rust)"
check_equal "as does no docker configuration" "1" "$?"
check_contains "asking whether the login ran" "is this running after the registry login?" "$out"

echo "--- usage ---"
write_fixtures
out="$(run gates)"
check_equal "an unknown track is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/ci-image-purge.sh [--dry-run] <rust|web>" "$out"
out="$(run)"
check_equal "as is no track" "1" "$?"
check_equal "and neither touched the registry" "" "$(cat "$stub/curl.log" 2>/dev/null)"

echo
echo "ci-image-purge.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
