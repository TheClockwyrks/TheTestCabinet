#!/usr/bin/env bash
# Deletes every manifest in a CI image's repository that no live branch pins.
#
#   scripts/ci/ci-image-purge.sh [--dry-run] <rust|web>
#
# The registry's tier has no retention policy, so without this every CI image
# ever built stays for ever, and each build leaves untagged manifests behind
# it: a tag names an index, and the index names the image and its
# attestation. azure-pipelines-ci-images.yml runs this after it has pushed,
# through .azure/project/ci-image-steps.yml, which is the only moment an older
# image becomes stale.
#
# The image and the attestation an index names carry no tag of their own, and
# the registry deletes either of them out from under the index without a
# word: the tag then still resolves, and a pull of it fails with the image's
# digest "not found". So before anything untagged goes, every kept tag's
# manifest is read back and whatever it names is kept with it. An unkept index
# is deleted on its own; the registry does not delete what it names, which is
# why its children are selected separately, and why a child two indexes share
# survives the deletion of one of them.
#
# What is kept is what `master`, `staging` and `nightly` pin in
# ci/images/tags.yml as `ciImageTag`, the commit whose image pipeline run built
# both tracks' images, plus what this checkout's copy of the file pins, plus
# the commit this run is on: the image the job pushed a step ago is tagged with
# it, and nothing pins it until the next commit writes it into the file.
# Usually that is one or two tags; it is more while a change sits on `nightly`
# or `staging` and has not reached `master`. Nothing older is kept. This project
# runs no CI on an old commit, so an image that no live branch names is an
# image nothing will ever pull, and a count or an age would only decide how
# long to pay for it.
#
# Keeping every live branch is what stops this breaking the branches it is not
# run from: each pins the tag it was merged with until a change reaches it, and
# deleting that tag would fail its gates at job initialization rather than in
# a check.
#
# The credential is the one `Docker@2` wrote for the `the-test-cabinet-acr`
# service connection, read back out of the docker configuration. That
# connection's service principal holds AcrPush and AcrDelete on the registry;
# AcrPush alone cannot delete, and the token request for a delete scope comes
# back without one. The registry is shared with the service and run images,
# which scripts/ci/registry-purge.sh owns, so this only ever names the two
# repositories below.
#
# --dry-run prints what it would delete and deletes nothing.
set -euo pipefail

readonly REGISTRY="testcabinet.azurecr.io"
readonly PINS_FILE="ci/images/tags.yml"

# An untagged manifest is left until it is this old. A build in flight has
# pushed the image and not yet the index that names it, and deleting the image
# underneath it would leave a tag that resolves to nothing.
readonly UNTAGGED_MIN_AGE_SECONDS=3600

# The branches whose pins are kept. A branch this cannot resolve stops the
# purge, because a fetch that failed must not read as "no branch names this
# tag": every tag that branch pins would look unkept and be deleted. So does a
# branch whose file pins nothing this can read: a file in yet another shape is
# not a branch that pins nothing. The one branch that does pin nothing is one with
# no ci/images/ at all, which predates the CI images (`master` still does)
# and whose pipeline pulls none.
readonly LIVE_BRANCHES=("master" "staging" "nightly")

usage() {
	cat >&2 <<'USAGE'
usage: scripts/ci/ci-image-purge.sh [--dry-run] <rust|web>
USAGE
	exit 1
}

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
	dry_run=true
	shift
fi

track="${1:-}"
case "$track" in
rust | web) ;;
*) usage ;;
esac

readonly REPOSITORY="ubuntu-the-test-cabinet-${track}-cicd"
# buildx writes its layer cache to a repository of its own, under one tag it
# overwrites every build. What accumulates there is the manifests each
# overwrite orphans.
readonly CACHE_REPOSITORY="${REPOSITORY}-cache"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$here"

# An Authorization header for one repository, built from whatever the docker
# configuration holds. The two logins that write it write different things, and
# both have to work: the pipeline's `Docker@2` against a service principal
# connection stores base64 of <id>:<secret>, which the registry accepts as
# Basic, while a developer's `az acr login` stores a refresh token that has to
# be exchanged for an access token scoped to the repository and the actions
# wanted. A registry token carries its scope, so this is called once per
# repository rather than once per run.
authorization_for() {
	local repository="$1"
	local config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
	if [ ! -f "$config" ]; then
		echo "ci-image-purge.sh: no docker configuration at $config; is this running after the registry login?" >&2
		return 1
	fi

	local identity basic token
	identity="$(jq -r --arg registry "$REGISTRY" '.auths[$registry].identitytoken // empty' "$config")"
	basic="$(jq -r --arg registry "$REGISTRY" '.auths[$registry].auth // empty' "$config")"

	# `az acr login` does not fill `identitytoken`. It writes the refresh token
	# as the password of a null-GUID user, which the registry accepts for a
	# docker pull and refuses on the catalogue and the delete this needs, so the
	# exchange below is what that form has to go through as well.
	if [ -z "$identity" ] && [ -n "$basic" ]; then
		local decoded
		decoded="$(printf '%s' "$basic" | base64 -d 2>/dev/null || true)"
		if [ "${decoded%%:*}" = "00000000-0000-0000-0000-000000000000" ]; then
			identity="${decoded#*:}"
		fi
	fi

	if [ -n "$identity" ]; then
		if ! token="$(curl --silent --show-error --fail \
			--data-urlencode "grant_type=refresh_token" \
			--data-urlencode "service=${REGISTRY}" \
			--data-urlencode "scope=repository:${repository}:pull,delete,metadata_read" \
			--data-urlencode "refresh_token=${identity}" \
			"https://${REGISTRY}/oauth2/token" | jq -r '.access_token // empty')"; then
			echo "ci-image-purge.sh: the registry refused a token for ${repository}" >&2
			return 1
		fi
		if [ -z "$token" ]; then
			echo "ci-image-purge.sh: the registry returned no access token for ${repository}" >&2
			return 1
		fi
		printf 'Bearer %s' "$token"
		return 0
	fi

	if [ -z "$basic" ]; then
		echo "ci-image-purge.sh: the docker configuration holds no credential for $REGISTRY" >&2
		return 1
	fi
	printf 'Basic %s' "$basic"
}

# The tag ci/images/tags.yml pins in one revision of the file: the value of
# its `ciImageTag:` line, which names the image of every track, or, on a
# branch the template's v0.24.0 scheme has not reached (`staging` and `nightly`
# until this shape is promoted through them), the value of this track's
# `<track>ImageTag:` line, a `v1-<digest>` tag. Read with grep rather than a
# YAML parser because this runs on the agent, which carries neither PyYAML nor
# a reason to.
pins_in() {
	grep -oE "^[[:space:]]*(ciImageTag|${track}ImageTag):[[:space:]]*[A-Za-z0-9_.-]+" <<<"$1" |
		sed -E 's/^.*:[[:space:]]*//' || true
}

# Every tag a live branch pins, plus the one this checkout pins.
#
# Only the one file on each branch is wanted, so the fetch asks for as little
# history as it can get away with. `--depth 1` is how the pipeline's own
# checkout already stands, but asking for it in a full clone is what *makes*
# that clone shallow, and a developer running this by hand would find their
# history grafted away. So the depth is passed only where it costs nothing.
kept_tags() {
	local branch text
	local -a depth=()
	if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
		depth=(--depth 1)
	fi
	# The pipeline's checkout does not leave its credential behind — the
	# checkout task strips the header it authenticated with unless it is asked
	# to persist it — so a fetch here carries the job's token itself, the way
	# scripts/ci/submodule-pins.sh does. Set nowhere else, which is a
	# developer's machine, the remote is reached however git already reaches it.
	local -a auth=()
	if [ -n "${SYSTEM_ACCESSTOKEN:-}" ]; then
		auth=(-c "http.extraheader=AUTHORIZATION: bearer ${SYSTEM_ACCESSTOKEN}")
	fi

	pins_in "$(cat "$PINS_FILE")"
	# The commit this run is on, whose image the job pushed a step ago and
	# which no file pins until the next commit. Azure names it; a terminal
	# asks git. Anything but a full object id is dropped rather than kept,
	# since it can name no image the run pushed.
	local own
	own="${BUILD_SOURCEVERSION:-$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)}"
	if [[ "$own" =~ ^[0-9a-f]{40}$ ]]; then
		printf '%s\n' "$own"
	fi
	local pins
	for branch in "${LIVE_BRANCHES[@]}"; do
		if ! git "${auth[@]}" fetch --quiet "${depth[@]}" origin "$branch"; then
			echo "ci-image-purge.sh: cannot fetch origin/$branch; refusing to purge" >&2
			return 1
		fi
		if ! text="$(git show "FETCH_HEAD:${PINS_FILE}" 2>/dev/null)"; then
			if [ -z "$(git ls-tree FETCH_HEAD "$(dirname "$PINS_FILE")/" 2>/dev/null)" ]; then
				echo "ci-image-purge.sh: origin/$branch predates ci/images/ and pins nothing" >&2
				continue
			fi
			echo "ci-image-purge.sh: origin/$branch carries no ${PINS_FILE}; refusing to purge" >&2
			return 1
		fi
		pins="$(pins_in "$text")"
		if [ -z "$pins" ]; then
			echo "ci-image-purge.sh: origin/$branch pins no ciImageTag or ${track}ImageTag in ${PINS_FILE}; refusing to purge" >&2
			return 1
		fi
		printf '%s\n' "$pins"
	done
	return 0
}

# The manifests of one repository, as ACR's own catalogue gives them: the
# digest, the tags on it, and when it was last written.
manifests_in() {
	local repository="$1" authorization="$2"
	curl --silent --show-error --fail \
		--header "Authorization: ${authorization}" \
		"https://${REGISTRY}/acr/v1/${repository}/_manifests?n=500"
}

delete_manifest() {
	local repository="$1" digest="$2" authorization="$3"
	if $dry_run; then
		echo "  would delete ${repository}@${digest}"
		return 0
	fi
	# The status rather than curl's own success, because one of these is not a
	# failure. A manifest another run, or a hand, deleted since the catalogue
	# was read answers 404, and it is gone either way.
	local status
	status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
		--request DELETE \
		--header "Authorization: ${authorization}" \
		"https://${REGISTRY}/v2/${repository}/manifests/${digest}")" || status="000"
	case "$status" in
	2*)
		echo "  deleted ${repository}@${digest}"
		return 0
		;;
	404)
		echo "  already gone ${repository}@${digest}"
		return 0
		;;
	*)
		echo "  FAILED to delete ${repository}@${digest} (HTTP ${status})" >&2
		return 1
		;;
	esac
}

# Reads the catalogue on stdin and prints the digest of every manifest a kept
# tag names, one per line. `all` as the kept tags names every tagged manifest,
# which is the cache repository's rule.
kept_manifests() {
	local kept="$1"
	local kept_json="$kept"
	[ "$kept" != all ] || kept_json='null'
	jq -r --argjson kept "$kept_json" '
		.manifests[]
		| select(
			((.tags // []) | length > 0)
			and ($kept == null
				or ([.tags[] | select(. as $t | $kept | index($t))] | length) > 0)
		)
		| .digest
	'
}

# The digests one manifest names, one per line: an index's image and
# attestation manifests, and nothing for a plain image. The registry is asked
# for either shape an index comes in and either shape an image comes in, so
# that it answers with the manifest rather than a conversion of it, which a
# digest could not name. A manifest that cannot be read is a failure, not an
# empty answer: the caller treats "could not ask" as a reason to stop.
children_of() {
	local repository="$1" digest="$2" authorization="$3"
	curl --silent --show-error --fail \
		--header "Authorization: ${authorization}" \
		--header "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
		"https://${REGISTRY}/v2/${repository}/manifests/${digest}" |
		jq -r '.manifests[]?.digest // empty'
}

# Every digest a purge of one repository must leave alone, as a JSON array:
# the manifest each kept tag names, read off the catalogue on stdin, and
# whatever each of those names in turn. Fails, printing nothing, when one of
# them cannot be read back from the registry, because a kept index whose
# children are unknown is a kept index whose children would be deleted.
protected_manifests() {
	local repository="$1" authorization="$2" kept="$3" catalogue="$4"
	local digest children
	local digests=()
	while read -r digest; do
		[ -n "$digest" ] || continue
		digests+=("$digest")
		if ! children="$(children_of "$repository" "$digest" "$authorization")"; then
			echo "ci-image-purge.sh: cannot read ${repository}@${digest}, which a kept tag names; refusing to purge" >&2
			return 1
		fi
		while read -r digest; do
			[ -n "$digest" ] || continue
			digests+=("$digest")
		done <<<"$children"
	done < <(kept_manifests "$kept" <<<"$catalogue")
	printf '%s\n' "${digests[@]}" | jq -R -s 'split("\n") | map(select(. != ""))'
}

# Reads the catalogue on stdin and prints the digest of every manifest to
# delete: one whose tags are all unkept, and one with no tag at all that is
# older than the grace period above and that no kept manifest names. `all` as
# the kept tags keeps every tagged manifest, which is the cache repository's
# rule. The age is for a build in flight, whose image is pushed before the
# index that will name it; the protected list is for the children of what is
# already kept, which no age would save.
select_manifests() {
	local kept="$1" cutoff="$2" protected="$3"
	local kept_json="$kept"
	[ "$kept" != all ] || kept_json='null'
	jq -r --argjson kept "$kept_json" --arg cutoff "$cutoff" --argjson protected "$protected" '
		.manifests[]
		| select(.digest as $digest | ($protected | index($digest)) == null)
		| select(
			if (.tags // []) | length > 0
			then $kept != null
				and ([.tags[] | select(. as $t | $kept | index($t))] | length) == 0
			else (.lastUpdateTime < $cutoff)
			end
		)
		| .digest
	'
}

main() {
	local authorization cache_authorization kept kept_json cutoff catalogue protected digest failed=0

	if ! authorization="$(authorization_for "$REPOSITORY")"; then
		exit 1
	fi

	local resolved
	if ! resolved="$(kept_tags)"; then
		exit 1
	fi
	kept="$(sort -u <<<"$resolved" | grep -v '^$' || true)"
	if [ -z "$kept" ]; then
		echo "ci-image-purge.sh: no tag resolved as kept; refusing to purge" >&2
		exit 1
	fi
	kept_json="$(jq -R -s 'split("\n") | map(select(. != ""))' <<<"$kept")"

	echo "${REPOSITORY}: keeping $(tr '\n' ' ' <<<"$kept")"

	cutoff="$(date -u -d "-${UNTAGGED_MIN_AGE_SECONDS} seconds" +%Y-%m-%dT%H:%M:%S.0000000Z)"

	if ! catalogue="$(manifests_in "$REPOSITORY" "$authorization")"; then
		echo "ci-image-purge.sh: cannot list ${REPOSITORY}" >&2
		exit 1
	fi
	if ! protected="$(protected_manifests "$REPOSITORY" "$authorization" "$kept_json" "$catalogue")"; then
		exit 1
	fi
	while read -r digest; do
		[ -n "$digest" ] || continue
		delete_manifest "$REPOSITORY" "$digest" "$authorization" || failed=1
	done < <(select_manifests "$kept_json" "$cutoff" "$protected" <<<"$catalogue")

	# The cache repository holds one tag, which buildx overwrites. Everything
	# untagged in it is an overwrite's leavings; at most 200 go per run, which
	# is far more than one build orphans and keeps a first run bounded.
	if cache_authorization="$(authorization_for "$CACHE_REPOSITORY" 2>/dev/null)" &&
		catalogue="$(manifests_in "$CACHE_REPOSITORY" "$cache_authorization" 2>/dev/null)" &&
		protected="$(protected_manifests "$CACHE_REPOSITORY" "$cache_authorization" all "$catalogue")"; then
		while read -r digest; do
			[ -n "$digest" ] || continue
			delete_manifest "$CACHE_REPOSITORY" "$digest" "$cache_authorization" || failed=1
		done < <(select_manifests all "$cutoff" "$protected" <<<"$catalogue" | head -n 200)
	fi

	exit "$failed"
}

main
