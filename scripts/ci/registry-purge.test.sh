#!/usr/bin/env bash
# Table test for registry-purge.sh. Run it directly:
# scripts/ci/registry-purge.test.sh
#
# No case reaches the registry or a cluster. A copy of the script and lib.sh
# runs in a throwaway repository with `az` and `curl` stubbed first on PATH.
# The az stub answers `acr login --expose-token` with a refresh token and
# `aks command invoke` with the result shape lib.sh's aks_invoke reads, its
# logs taken from cluster-<resource-group>.txt. The curl stub is the registry:
# its token endpoint mints a token naming the scope asked for, and every
# other request must carry the token of the one repository (or the catalogue)
# it is about. It answers the catalogue from repositories.json, a
# repository's manifests from <repository>.json (404 without one), a manifest
# read from <repository>@<digest>.json, and records every DELETE in a log,
# answering the status a variable names.
#
# The subject is the policy: which commits are kept (the clusters', --keep,
# the newest), which tagged manifests each keeps, the inputs-tag rule, the
# untagged pass with its grace period and child protection, that a cluster
# that cannot be read deletes nothing, and the credential path: one sign-in,
# one token per repository, each used for that repository alone.
set -uo pipefail

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
	echo "jq is not installed here; skipping the registry-purge test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
stub="$tmp/stub"
mkdir -p "$repo/scripts/ci" "$repo/bin" "$stub"
cp "$CI_DIR/registry-purge.sh" "$CI_DIR/lib.sh" "$repo/scripts/ci/"

readonly HOST="testcabinet.azurecr.io"

# az: the registry sign-in, which STUB_ACR_LOGIN_FAIL refuses and whose token
# STUB_REFRESH_TOKEN can misname, and the clusters.
cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_DIR/az.log"
verb="$1 $2"
shift 2
[ "$verb" != "aks command" ] || { verb="$verb $1"; shift; }
group=""
expose=false
while [ $# -gt 0 ]; do
	case "$1" in
		--resource-group) group="$2" ;;
		--expose-token) expose=true ;;
	esac
	shift
done
case "$verb" in
	"acr login")
		if [ -n "${STUB_ACR_LOGIN_FAIL:-}" ]; then
			echo "ERROR: Please run 'az login' to setup account." >&2
			exit 1
		fi
		if [ "$expose" != true ]; then
			echo "az stub: acr login without --expose-token would need docker" >&2
			exit 1
		fi
		echo "${STUB_REFRESH_TOKEN:-refresh-token}"
		;;
	"aks command invoke")
		if [ -f "$STUB_DIR/cluster-$group.txt" ]; then
			jq -n --rawfile logs "$STUB_DIR/cluster-$group.txt" \
				'{exitCode: 0, id: "stub", logs: $logs, provisioningState: "Succeeded"}'
		else
			jq -n '{exitCode: 1, id: "stub", logs: "Unable to connect to the server", provisioningState: "Succeeded"}'
		fi
		;;
	*)
		echo "az stub: unexpected '$verb'" >&2
		exit 1
		;;
esac
STUB

# curl: the URL is the one argument that names the registry. Every request
# is logged as `<method> <url> <authorization>`. The body goes to --output or
# stdout and the status to stdout under --write-out, as curl does; a status of
# 400 or more under --fail is exit 22 with no body, as curl does. A DELETE is
# logged and answered with STUB_DELETE_STATUS, or 403 when its digest names
# STUB_DELETE_FAIL; a listing of the repository STUB_LIST_FAIL names is a 500.
cat >"$repo/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
url=""
method=GET
authorization=""
scope=""
refresh=""
output=""
write_out=false
fail=false
while [ $# -gt 0 ]; do
	case "$1" in
		--request) method="$2"; shift ;;
		--header) [[ "$2" == Authorization:* ]] && authorization="${2#Authorization: }"; shift ;;
		--data-urlencode)
			method=POST
			[[ "$2" == scope=* ]] && scope="${2#scope=}"
			[[ "$2" == refresh_token=* ]] && refresh="${2#refresh_token=}"
			shift
			;;
		--output) output="$2"; shift ;;
		--write-out) write_out=true; shift ;;
		--fail) fail=true ;;
		http*) url="$1" ;;
	esac
	shift
done
printf '%s %s %s\n' "$method" "$url" "$authorization" >>"$STUB_DIR/curl.log"

answer() { # status body
	if [ "$1" -ge 400 ] && $fail; then
		echo "curl: (22) The requested URL returned error: $1" >&2
		exit 22
	fi
	if [ -n "$output" ]; then
		printf '%s\n' "$2" >"$output"
	else
		printf '%s\n' "$2"
	fi
	if $write_out; then
		printf '%s' "$1"
	fi
	exit 0
}
authorized() { # scope
	[ "$authorization" = "Bearer token-for-$1" ] ||
		answer 401 '{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}'
}
case "$url" in
	*/oauth2/token)
		[ "$refresh" = "refresh-token" ] ||
			answer 401 '{"errors":[{"code":"UNAUTHORIZED","message":"the refresh token is invalid"}]}'
		answer 200 "{\"access_token\":\"token-for-$scope\"}"
		;;
	*/acr/v1/_catalog*)
		authorized 'registry:catalog:*'
		answer 200 "$(jq -c '{repositories: .}' "$STUB_DIR/repositories.json")"
		;;
	*/acr/v1/*/_manifests*)
		repository="${url#*/acr/v1/}"
		repository="${repository%%/*}"
		authorized "repository:$repository:pull,delete,metadata_read"
		if [ "$repository" = "${STUB_LIST_FAIL:-}" ]; then
			answer 500 '{"errors":[{"code":"INTERNAL","message":"the stub was told to"}]}'
		fi
		if [ -f "$STUB_DIR/$repository.json" ]; then
			answer 200 "$(jq -c --arg name "$repository" \
				'{registry: "testcabinet.azurecr.io", imageName: $name, manifests: .}' "$STUB_DIR/$repository.json")"
		fi
		answer 404 "{\"errors\":[{\"code\":\"NAME_UNKNOWN\",\"message\":\"repository \\\"$repository\\\" is not found\"}]}"
		;;
	*/v2/*/manifests/*)
		path="${url#*/v2/}"
		repository="${path%%/manifests/*}"
		digest="${path##*/manifests/}"
		authorized "repository:$repository:pull,delete,metadata_read"
		case "$method" in
			GET)
				if [ -f "$STUB_DIR/$repository@$digest.json" ]; then
					answer 200 "$(cat "$STUB_DIR/$repository@$digest.json")"
				fi
				answer 404 '{"errors":[{"code":"MANIFEST_UNKNOWN","message":"manifest unknown"}]}'
				;;
			DELETE)
				echo "$repository@$digest" >>"$STUB_DIR/deleted.log"
				if [ -n "${STUB_DELETE_FAIL:-}" ] && [[ "$digest" == *"$STUB_DELETE_FAIL"* ]]; then
					answer 403 '{"errors":[{"code":"DENIED","message":"the stub was told to"}]}'
				fi
				answer "${STUB_DELETE_STATUS:-202}" ""
				;;
			*)
				echo "curl stub: unexpected $method $url" >&2
				exit 1
				;;
		esac
		;;
	*)
		echo "curl stub: unexpected $url" >&2
		exit 1
		;;
esac
STUB
chmod +x "$repo/bin/az" "$repo/bin/curl"

readonly LIVE="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
readonly NEWEST="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
readonly OLD="cccccccccccccccccccccccccccccccccccccccc"
readonly OLDER="dddddddddddddddddddddddddddddddddddddddd"
readonly ENVSHA="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
readonly STAGING_RG="testcabinet-staging-westus2-rg"
readonly PROD_RG="testcabinet-prod-westus2-rg"
readonly INDEX="application/vnd.oci.image.index.v1+json"
readonly IMAGE="application/vnd.oci.image.manifest.v1+json"

at() { date --utc --date="$1" +%Y-%m-%dT%H:%M:%S.0000000Z; }

# The token the stub mints for one repository, as the curl log shows it.
token_for() { echo "Bearer token-for-repository:$1:pull,delete,metadata_read"; }

# One manifest, as the registry's listing prints it.
manifest() { # digest when size media-type [tag...]
	local digest="$1" when="$2" size="$3" media="$4"
	shift 4
	jq -n --arg digest "$digest" --arg when "$when" --argjson size "$size" --arg media "$media" \
		--args '{digest: $digest, lastUpdateTime: $when, imageSize: $size, mediaType: $media,
			tags: ($ARGS.positional | if length == 0 then null else . end)}' "$@"
}

# The registry every case starts from. Push times, newest first: NEWEST an
# hour ago, OLD a day ago, LIVE two days ago, OLDER three days ago.
write_fixtures() {
	rm -rf "$stub"
	mkdir -p "$stub"
	printf '["tcab-backend","test-cabinet-gg-toolchains","tcab-unlisted","ubuntu-the-test-cabinet-rust-cicd","other"]\n' \
		>"$stub/repositories.json"
	jq -s . >"$stub/tcab-backend.json" <<EOF
$(manifest sha256:live "$(at '2 days ago')" 1000 "$INDEX" "$LIVE")
$(manifest sha256:live-amd64 "$(at '2 days ago')" 1000 "$IMAGE" "$LIVE-amd64")
$(manifest sha256:live-arm64 "$(at '2 days ago')" 1000 "$IMAGE" "$LIVE-arm64")
$(manifest sha256:newest "$(at '1 hour ago')" 1000 "$INDEX" "$NEWEST")
$(manifest sha256:newest-amd64 "$(at '1 hour ago')" 1000 "$IMAGE" "$NEWEST-amd64")
$(manifest sha256:newest-arm64 "$(at '1 hour ago')" 1000 "$IMAGE" "$NEWEST-arm64")
$(manifest sha256:old "$(at '1 day ago')" 1000 "$INDEX" "$OLD")
$(manifest sha256:old-amd64 "$(at '1 day ago')" 500000000 "$IMAGE" "$OLD-amd64")
$(manifest sha256:old-arm64 "$(at '1 day ago')" 500000000 "$IMAGE" "$OLD-arm64")
$(manifest sha256:older-amd64 "$(at '3 days ago')" 1000 "$IMAGE" "$OLDER-amd64")
$(manifest sha256:cache-amd64 "$(at '1 hour ago')" 1000 "$IMAGE" buildcache-amd64)
$(manifest sha256:cache-arm64 "$(at '1 hour ago')" 1000 "$IMAGE" buildcache-arm64)
$(manifest sha256:latest "$(at '1 year ago')" 1000 "$IMAGE" latest)
$(manifest sha256:orphan-old "$(at '2 hours ago')" 200000000 "$IMAGE")
$(manifest sha256:orphan-young "$(at '10 minutes ago')" 1000 "$IMAGE")
$(manifest sha256:live-child "$(at '2 days ago')" 1000 "$IMAGE")
EOF
	printf '{"manifests":[{"digest":"sha256:live-amd64"},{"digest":"sha256:live-arm64"},{"digest":"sha256:live-child"}]}\n' \
		>"$stub/tcab-backend@sha256:live.json"
	printf '{"manifests":[{"digest":"sha256:newest-amd64"},{"digest":"sha256:newest-arm64"}]}\n' \
		>"$stub/tcab-backend@sha256:newest.json"
	printf '{"manifests":[{"digest":"sha256:old-amd64"},{"digest":"sha256:old-arm64"}]}\n' \
		>"$stub/tcab-backend@sha256:old.json"

	# A run image: inputs-tagged manifests, one of them reused under LIVE's
	# one-entry list, and one carrying an old commit's tag beside its inputs
	# tag that NEWEST reuses.
	jq -s . >"$stub/test-cabinet-gg-toolchains.json" <<EOF
$(manifest sha256:in-newest-amd64 "$(at '1 hour ago')" 1000 "$IMAGE" inputs-0a0a-amd64)
$(manifest sha256:in-old-amd64 "$(at '2 days ago')" 300000000 "$IMAGE" inputs-0b0b-amd64)
$(manifest sha256:in-only-arm64 "$(at '4 days ago')" 1000 "$IMAGE" inputs-0c0c-arm64)
$(manifest sha256:reuse-live-amd64 "$(at '2 days ago')" 1000 "$INDEX" "$LIVE-amd64")
$(manifest sha256:reuse-newest-arm64 "$(at '1 hour ago')" 1000 "$INDEX" "$NEWEST-arm64")
$(manifest sha256:old-both-arm64 "$(at '1 day ago')" 1000 "$IMAGE" "$OLD-arm64" inputs-0d0d-arm64)
EOF
	printf '{"manifests":[{"digest":"sha256:in-newest-amd64"}]}\n' \
		>"$stub/test-cabinet-gg-toolchains@sha256:reuse-live-amd64.json"
	printf '{"manifests":[{"digest":"sha256:old-both-arm64"}]}\n' \
		>"$stub/test-cabinet-gg-toolchains@sha256:reuse-newest-arm64.json"

	cat >"$stub/cluster-$STAGING_RG.txt" <<EOF
testcabinet.azurecr.io/tcab-backend:$LIVE
testcabinet.azurecr.io/tcab-dispatcher:$LIVE
TCAB_CONTAINER_TAG=$LIVE
TCAB_DRIVER_IMAGE=testcabinet.azurecr.io/tcab-driver:$LIVE
TCAB_PUBLISHER_IMAGE=testcabinet.azurecr.io/tcab-publisher:$ENVSHA
TCAB_DATABASE_URL=postgres://db:5432/tcab
OTHER_IMAGE=testcabinet.azurecr.io/tcab-web:$OLD
testcabinet.azurecr.io/tcab-web
EOF
	cat >"$stub/cluster-$PROD_RG.txt" <<EOF
ghcr.io/example/tcab-backend:$OLDER
ghcr.io/example/tcab-dispatcher:$OLDER
EOF
}

run() {
	(cd / && env PATH="$repo/bin:$PATH" STUB_DIR="$stub" "$repo/scripts/ci/registry-purge.sh" "$@" 2>&1)
}
deleted() { cat "$stub/deleted.log" 2>/dev/null; }
az_log() { cat "$stub/az.log" 2>/dev/null; }
curl_log() { cat "$stub/curl.log" 2>/dev/null; }

echo "--- the default policy ---"
write_fixtures
out="$(run)"
check_equal "exits 0" "0" "$?"
check_equal "the first line names the kept commits: the clusters', the dispatcher's, the newest" \
	"Keeping commits: $LIVE $NEWEST $ENVSHA" "$(head -1 <<<"$out")"
check_lacks "OLDER, which prod runs from another registry, is not kept" "$OLDER" "$(head -1 <<<"$out")"
check_contains "deletes an old commit's fused tag" "deleted $OLD (sha256:old)" "$out"
check_contains "and its amd64 tag" "deleted $OLD-amd64 (sha256:old-amd64)" "$out"
check_contains "and its arm64 tag" "deleted $OLD-arm64 (sha256:old-arm64)" "$out"
check_contains "and a partial push of an older commit" "deleted $OLDER-amd64 (sha256:older-amd64)" "$out"
check_contains "keeps the live commit" "kept $LIVE" "$out"
check_contains "keeps the newest commit" "kept $NEWEST-arm64" "$out"
check_contains "keeps buildcache-amd64" "kept buildcache-amd64" "$out"
check_contains "keeps buildcache-arm64" "kept buildcache-arm64" "$out"
check_contains "keeps latest" "kept latest" "$out"
check_contains "deletes an untagged manifest older than an hour" "deleted untagged sha256:orphan-old" "$out"
check_lacks "not a young one" "sha256:orphan-young" "$out"
check_lacks "not a child of a kept index" "sha256:live-child" "$out"
check_contains "keeps the newest inputs-only manifest of amd64" "kept inputs-0a0a-amd64" "$out"
check_contains "deletes an older inputs-only manifest of amd64" "deleted inputs-0b0b-amd64 (sha256:in-old-amd64)" "$out"
check_contains "keeps the newest inputs manifest of arm64, an old commit's tag beside it" \
	"kept $OLD-arm64,inputs-0d0d-arm64" "$out"
check_lacks "the older arm64 inputs manifest is not the newest, so it goes" "kept inputs-0c0c-arm64" "$out"
check_contains "which is to say deleted" "deleted inputs-0c0c-arm64 (sha256:in-only-arm64)" "$out"
check_contains "keeps the one-entry list a live commit reuses" "kept $LIVE-amd64" "$out"
check_contains "a repository with no listing is empty" "tcab-unlisted:" "$out"
check_lacks "and no failure" "FAILED" "$out"
check_lacks "the CI images are not this purge's" "ubuntu-the-test-cabinet-rust-cicd" "$out"
check_lacks "nor is any other repository" "other:" "$out"
check_contains "reports the size that went" "Purge finished. Deleted about 1.5 GB." "$out"
check_equal "the deletes, in order" \
	"tcab-backend@sha256:old
tcab-backend@sha256:old-amd64
tcab-backend@sha256:old-arm64
tcab-backend@sha256:older-amd64
tcab-backend@sha256:orphan-old
test-cabinet-gg-toolchains@sha256:in-old-amd64
test-cabinet-gg-toolchains@sha256:in-only-arm64" "$(deleted)"
check_contains "reads staging through az aks command invoke" \
	"aks command invoke --resource-group $STAGING_RG --name testcabinet-staging-westus2-aks" "$(az_log)"
check_contains "and prod" \
	"aks command invoke --resource-group $PROD_RG --name testcabinet-prod-westus2-aks" "$(az_log)"
check_contains "signs in to the registry through az, exposing the token" \
	"acr login --name testcabinet --expose-token" "$(az_log)"
check_equal "once, and makes no other az acr call" "1" "$(az_log | grep -c '^acr ')"
check_contains "lists the catalogue with a token of its own" \
	"GET https://$HOST/acr/v1/_catalog?n=500 Bearer token-for-registry:catalog:*" "$(curl_log)"
check_contains "lists at most 500 manifests, with the repository's token" \
	"GET https://$HOST/acr/v1/tcab-backend/_manifests?n=500 $(token_for tcab-backend)" "$(curl_log)"
check_contains "reads a kept index's children as a manifest" \
	"GET https://$HOST/v2/tcab-backend/manifests/sha256:live $(token_for tcab-backend)" "$(curl_log)"
check_contains "deletes by digest, with the repository's token" \
	"DELETE https://$HOST/v2/tcab-backend/manifests/sha256:old $(token_for tcab-backend)" "$(curl_log)"
check_contains "and in the next repository with that one's" \
	"DELETE https://$HOST/v2/test-cabinet-gg-toolchains/manifests/sha256:in-old-amd64 $(token_for test-cabinet-gg-toolchains)" \
	"$(curl_log)"
check_equal "one token for the catalogue and one per repository, got once each" \
	"4" "$(curl_log | grep -c "^POST https://$HOST/oauth2/token")"
check_equal "so a repository is listed twice on the one token" \
	"2" "$(curl_log | grep -c "^GET https://$HOST/acr/v1/tcab-backend/_manifests?n=500 $(token_for tcab-backend)$")"

echo "--- a kept list's child is kept whatever its tags ---"
write_fixtures
# NEWEST no longer reuses the old manifest: OLD's arm64 build is then just an
# old commit's, and its inputs tag is not the newest arm64 one either.
printf '{"manifests":[{"digest":"sha256:in-only-arm64"}]}\n' \
	>"$stub/test-cabinet-gg-toolchains@sha256:reuse-newest-arm64.json"
jq 'map(if .digest == "sha256:in-only-arm64" then .lastUpdateTime = "'"$(at '1 hour ago')"'" else . end)' \
	"$stub/test-cabinet-gg-toolchains.json" >"$stub/t.json" && mv "$stub/t.json" "$stub/test-cabinet-gg-toolchains.json"
out="$(run)"
check_equal "exits 0" "0" "$?"
check_contains "the old commit's manifest goes" "deleted $OLD-arm64,inputs-0d0d-arm64 (sha256:old-both-arm64)" "$out"
check_contains "the reused one stays" "kept inputs-0c0c-arm64" "$out"
write_fixtures
# An old commit's manifest that a kept list names, and nothing else keeps.
jq 'map(if .digest == "sha256:old-both-arm64" then .tags = ["'"$OLD"'-arm64"] else . end)' \
	"$stub/test-cabinet-gg-toolchains.json" >"$stub/t.json" && mv "$stub/t.json" "$stub/test-cabinet-gg-toolchains.json"
out="$(run)"
check_equal "exits 0" "0" "$?"
check_contains "is kept because the list names it" "kept $OLD-arm64 (a kept image names it)" "$out"
check_lacks "and not deleted" "test-cabinet-gg-toolchains@sha256:old-both-arm64" "$(deleted)"

echo "--- --dry-run ---"
write_fixtures
out="$(run --dry-run)"
check_equal "exits 0" "0" "$?"
check_contains "says so" "Dry run: nothing is deleted." "$out"
check_contains "prints what it would delete" "would delete $OLD (sha256:old)" "$out"
check_contains "untagged too" "would delete untagged sha256:orphan-old" "$out"
check_contains "and the size" "Purge finished. Would delete about 1.5 GB." "$out"
check_equal "and deletes nothing" "" "$(deleted)"
check_lacks "sending no DELETE" "DELETE" "$(curl_log)"

echo "--- --keep ---"
write_fixtures
out="$(run --keep "$OLDER")"
check_equal "exits 0" "0" "$?"
check_contains "adds the commit" "Keeping commits: $LIVE $NEWEST $OLDER $ENVSHA" "$out"
check_contains "which is then kept" "kept $OLDER-amd64" "$out"
check_lacks "and not deleted" "sha256:older-amd64" "$(deleted)"

echo "--- --keep-count ---"
write_fixtures
out="$(run --keep-count 2)"
check_equal "exits 0" "0" "$?"
check_contains "keeps the second-newest commit too" "Keeping commits: $LIVE $NEWEST $OLD $ENVSHA" "$out"
check_contains "so its tags stay" "kept $OLD-amd64" "$out"
check_equal "and nothing of it is deleted" \
	"tcab-backend@sha256:older-amd64
tcab-backend@sha256:orphan-old
test-cabinet-gg-toolchains@sha256:in-old-amd64
test-cabinet-gg-toolchains@sha256:in-only-arm64" "$(deleted)"
check_contains "while the older commit still goes" "deleted $OLDER-amd64 (sha256:older-amd64)" "$out"

echo "--- a cluster that cannot be read ---"
write_fixtures
rm "$stub/cluster-$PROD_RG.txt"
out="$(run)"
check_equal "exits 1" "1" "$?"
check_contains "says which" "could not read what tcab-prod runs on testcabinet-prod-westus2-aks (prod)" "$out"
check_contains "with the cluster's answer" "Unable to connect to the server" "$out"
check_contains "and that nothing was deleted" "nothing was deleted. Pass --no-cluster if the cluster is gone." "$out"
check_equal "which is so" "" "$(deleted)"
check_equal "the registry was not even listed" "" "$(curl_log)"

write_fixtures
: >"$stub/cluster-$STAGING_RG.txt"
out="$(run)"
check_equal "a namespace with no workload at all is refused" "1" "$?"
check_contains "as the wrong cluster or namespace" "tcab-staging on testcabinet-staging-westus2-aks (staging) reports no workload at all" "$out"
check_equal "and deletes nothing" "" "$(deleted)"

echo "--- --no-cluster ---"
write_fixtures
rm "$stub/cluster-$PROD_RG.txt" "$stub/cluster-$STAGING_RG.txt"
out="$(run --no-cluster --keep "$LIVE")"
check_equal "exits 0" "0" "$?"
check_lacks "asks no cluster" "aks command invoke" "$(az_log)"
check_contains "keeps what it was told and the newest" "Keeping commits: $LIVE $NEWEST" "$out"
check_contains "and proceeds" "deleted $OLD (sha256:old)" "$out"

echo "--- a delete that fails ---"
write_fixtures
out="$(STUB_DELETE_FAIL=sha256:old-amd64 run)"
check_equal "exits 1" "1" "$?"
check_contains "reports it" "FAILED to delete $OLD-amd64 (sha256:old-amd64)" "$out"
check_contains "with the registry's status" "deleting tcab-backend@sha256:old-amd64 answered HTTP 403." "$out"
check_contains "and continues" "deleted $OLD-arm64 (sha256:old-arm64)" "$out"
check_contains "to the untagged pass" "deleted untagged sha256:orphan-old" "$out"
check_contains "and the next repository" "deleted inputs-0b0b-amd64 (sha256:in-old-amd64)" "$out"
check_contains "counting it" "registry-purge.sh: 1 step(s) failed. The next run tries them again." "$out"
write_fixtures
out="$(STUB_DELETE_STATUS=404 run)"
check_equal "a manifest already gone is not a failure" "0" "$?"
check_lacks "and is not reported as one" "FAILED" "$out"
check_contains "the deletes went on" "deleted $OLD-arm64 (sha256:old-arm64)" "$out"

echo "--- a child that cannot be read ---"
write_fixtures
rm "$stub/tcab-backend@sha256:live.json"
out="$(run)"
check_equal "exits 1" "1" "$?"
check_contains "leaves the repository alone" "FAILED to read $LIVE (sha256:live), so nothing in tcab-backend is deleted" "$out"
check_lacks "so the old commit stays there" "tcab-backend@sha256:old" "$(deleted)"
check_contains "while the next repository still runs" "deleted inputs-0b0b-amd64 (sha256:in-old-amd64)" "$out"

echo "--- a repository that cannot be listed ---"
write_fixtures
out="$(STUB_LIST_FAIL=tcab-backend run)"
check_equal "exits 1" "1" "$?"
check_contains "reports the status" "listing tcab-backend answered HTTP 500." "$out"
check_contains "and leaves the repository alone" "FAILED to list tcab-backend, so nothing in it is deleted" "$out"
check_lacks "so nothing of it goes" "tcab-backend@" "$(deleted)"
check_contains "while the newest commit is still found in the rest" "Keeping commits: $LIVE $NEWEST $ENVSHA" "$out"
check_contains "and the next repository still runs" "deleted inputs-0b0b-amd64 (sha256:in-old-amd64)" "$out"

echo "--- the registry sign-in ---"
write_fixtures
out="$(STUB_ACR_LOGIN_FAIL=1 run)"
check_equal "a sign-in that fails exits 1" "1" "$?"
check_contains "with az's own reason" "Please run 'az login' to setup account." "$out"
check_contains "and says nothing was deleted" "could not sign in to the registry. Nothing was deleted." "$out"
check_equal "which is so" "" "$(deleted)"
check_equal "before any cluster was asked" "" "$(az_log | grep 'aks command' || true)"
check_equal "or the registry touched" "" "$(curl_log)"
write_fixtures
out="$(STUB_REFRESH_TOKEN=stale-token run)"
check_equal "a refresh token the registry refuses exits 1" "1" "$?"
check_contains "naming the scope refused" "the registry refused a token for registry:catalog:*." "$out"
check_contains "and that nothing was deleted" "could not list the registry's repositories. Nothing was deleted." "$out"
check_equal "which is so" "" "$(deleted)"
check_lacks "nothing having been listed" "_manifests" "$(curl_log)"

echo "--- usage ---"
write_fixtures
out="$(run --keep-count 0)"
check_equal "a zero keep count is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/registry-purge.sh [--dry-run] [--keep <sha>]... [--keep-count <n>] [--no-cluster]" "$out"
out="$(run --keep notasha)"
check_equal "a --keep that is not a commit is a usage error" "1" "$?"
out="$(run --prune)"
check_equal "an unknown option is a usage error" "1" "$?"
check_equal "and none of them touched az" "" "$(az_log)"
check_equal "or the registry" "" "$(curl_log)"

echo
echo "registry-purge.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
