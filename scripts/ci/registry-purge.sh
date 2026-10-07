#!/usr/bin/env bash
# Deletes the service and run images no environment runs any more.
#
#   scripts/ci/registry-purge.sh [--dry-run] [--keep <sha>]... [--keep-count <n>] [--no-cluster]
#
# Every commit that reaches `master` or `staging` pushes, per architecture,
# `<image>:<sha>-amd64` and `<image>:<sha>-arm64`, and then the fused
# multi-arch `<image>:<sha>`, a manifest list naming those two, into the eight
# service repositories (`tcab-*`) and the run-image repositories
# (`test-cabinet-*`, `test-cabinet-gg-toolchains` and
# `test-cabinet-audio-store` included). The registry is on the Basic tier,
# which has no retention policy, so without this every image ever pushed stays
# for ever. The pipeline runs it at the end of the staging and prod
# deployments, once the clusters have moved on to the commit; run by hand,
# `--dry-run` prints what it would delete and deletes nothing.
#
# ## What is kept
#
# A commit is kept when any of these names it:
#
#   - `--keep <sha>`, which is how the pipeline names the commit it just
#     deployed, whatever became of the deployment;
#   - a cluster: what the `tcab-staging` and `tcab-prod` namespaces run, read
#     through `az aks command invoke` because both API servers are private.
#     Every Deployment, StatefulSet and DaemonSet contributes the tag of each
#     container image it names in this registry, and the dispatcher's
#     `TCAB_*` environment (`TCAB_CONTAINER_TAG`, `TCAB_DRIVER_IMAGE`,
#     `TCAB_PUBLISHER_IMAGE`) contributes the commit the run images it starts
#     are pinned to. An image from another registry contributes nothing. A
#     cluster that cannot be read stops the purge with nothing deleted, because
#     "could not ask" must never read as "runs nothing"; `--no-cluster` skips
#     both clusters, for one that is gone;
#   - the newest <n> commits (one unless `--keep-count` says otherwise), each
#     commit dated by the newest push of any manifest carrying its tags, in any
#     repository. That is the commit whose images are arriving or have just
#     arrived, which no cluster runs yet.
#
# Then, in every repository whose name starts with `tcab-` or `test-cabinet-`
# and in no other (the CI images are ci-image-purge.sh's), each tagged manifest
# is kept or deleted by its tags:
#
#   - a commit tag, `<sha>` or `<sha>-<arch>`, keeps the manifest when its
#     commit is kept;
#   - an inputs tag, `inputs-<hex>-<arch>`, is the content address of a run
#     image's build inputs, which a later commit whose inputs are unchanged
#     reuses instead of rebuilding: it retags the reused manifest by pushing a
#     one-entry manifest list under its own `<sha>-<arch>`, naming the inputs
#     manifest as a child. The newest inputs-tagged manifest of each
#     architecture in a repository is kept, whatever else it is tagged, so the
#     last build of unchanged inputs stays reusable; an older one is not;
#   - every other tag (`buildcache-<arch>`, `latest`, anything unrecognised)
#     keeps the manifest, always;
#   - a manifest a kept manifest list names as a child is kept, whatever its
#     own tags say. This is what keeps the reused inputs manifest under a kept
#     commit's one-entry list when the commit that first built it is deleted.
#
# Every other tagged manifest is deleted.
#
# ## Untagged manifests
#
# buildx overwrites `buildcache-<arch>` on every build, orphaning the previous
# cache manifest as untagged, and deleting a manifest list can leave its
# children untagged. Once the tagged pass is done, the repository is listed
# again, so what stays is what is really there: the kept manifests, one whose
# delete failed, and one pushed meanwhile. The children of every remaining
# tagged manifest list are protected, and every other untagged manifest older
# than an hour is deleted. The hour is for a push in flight: a push writes an
# index's children before the index, so a young untagged manifest may belong
# to an image that is still arriving. If the second listing or a child read
# fails, no untagged manifest in that repository is deleted.
#
# ## Running it
#
# The caller is signed in to Azure as an identity holding AcrDelete on the
# registry and the command-invoke role on both clusters (the `tcab-deploy`
# connection). The clusters are asked through `az aks command invoke`. The
# registry is spoken to directly, over its REST API with curl: one
# `az acr login --expose-token` turns the Azure sign-in into a registry
# refresh token (no docker involved; it works for the pipeline's service
# principal and for a developer's `az login` alike), and the registry's own
# token endpoint exchanges that for an access token per repository, scoped to
# that repository's pull, delete and metadata_read, and one for the
# catalogue. That is the run's only `az acr` call, because each one costs
# about 5.5 s of Python start-up and authentication: the purge makes four or
# five calls per repository across 65-odd repositories, which came to about
# 30 minutes a run, where the same REST calls take 0.6 s each. A token per
# repository is also what makes a delete aimed at the wrong repository
# impossible: the registry refuses it. The registry never refuses a token
# request for an action the identity has no right to, though: it issues the
# token without that action, and every delete made with it answers 401. So
# each repository token's granted actions are read out of the token before
# anything is listed, and one without `delete` stops the run with nothing
# deleted, naming the role the identity lacks (AcrDelete, on the service
# principal's object id and not its application id), in a dry run too, since
# a dry run is a preview of the real one. A delete that fails is reported and
# the rest still run; the exit status is 1 if any failed, and the next run
# tries them again. The output is the commits kept, one block per repository,
# and the approximate size of what went.
set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/lib.sh
source "${CI_DIR}/lib.sh"

readonly REGISTRY="testcabinet"
readonly REGISTRY_HOST="testcabinet.azurecr.io"
readonly UNTAGGED_MIN_AGE="1 hour"
# The two tag classes with a policy. A tag matching neither is always kept.
readonly COMMIT_TAG='^[0-9a-f]{40}(-(amd64|arm64))?$'
readonly INPUTS_TAG='^inputs-[0-9a-f]+-(amd64|arm64)$'
# What a manifest read accepts: an index or a manifest list, whose children
# are wanted, and a plain image, which has none.
readonly MANIFEST_MEDIA_TYPES="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
# The environments whose running commits are kept: name, resource group,
# cluster, namespace.
readonly ENVIRONMENTS=(
	"staging testcabinet-staging-westus2-rg testcabinet-staging-westus2-aks tcab-staging"
	"prod testcabinet-prod-westus2-rg testcabinet-prod-westus2-aks tcab-prod"
)

usage() {
	echo "usage: scripts/ci/registry-purge.sh [--dry-run] [--keep <sha>]... [--keep-count <n>] [--no-cluster]" >&2
	exit 1
}

# The registry refresh token of the signed-in Azure identity, as `az acr
# login` would hand docker. The run's one `az acr` call.
registry_refresh_token() {
	az acr login --name "$REGISTRY" --expose-token \
		--only-show-errors --output tsv --query accessToken </dev/null
}

# Exchanges the refresh token for an access token carrying one scope, at the
# registry's token endpoint. A refresh token lasts about three hours and an
# access token over one, both far longer than a run, so a token is asked for
# once per scope. Fails when the registry refuses or answers with no token.
access_token() {
	local scope="$1" token
	if ! token="$(curl --silent --show-error --fail \
		--data-urlencode "grant_type=refresh_token" \
		--data-urlencode "service=${REGISTRY_HOST}" \
		--data-urlencode "scope=${scope}" \
		--data-urlencode "refresh_token=${REFRESH_TOKEN}" \
		"https://${REGISTRY_HOST}/oauth2/token" </dev/null | jq -r '.access_token // empty')"; then
		echo "registry-purge.sh: the registry refused a token for ${scope}." >&2
		return 1
	fi
	if [[ -z "$token" ]]; then
		echo "registry-purge.sh: the registry returned no access token for ${scope}." >&2
		return 1
	fi
	printf '%s' "$token"
}

# The access token for one repository and nothing else: pull to read its
# manifests, delete, and metadata_read to list them.
repository_token() {
	access_token "repository:${1}:pull,delete,metadata_read"
}

# The actions an access token was granted, one per line, read from the
# `access` claim of its payload. The scope a token was asked for says nothing
# about what it carries: the registry drops the actions the identity has no
# right to and issues the token anyway. Prints nothing for a token that does
# not decode.
granted_actions() {
	local payload
	payload="$(cut -d. -f2 <<<"$1" | tr -- '-_' '+/')"
	# base64url drops the padding; base64 -d wants it back.
	payload+="$(printf '%*s' $(((4 - ${#payload} % 4) % 4)) '' | tr ' ' '=')"
	base64 -d <<<"$payload" 2>/dev/null | jq -r '.access[]?.actions[]?' 2>/dev/null || true
}

# Fails, saying why, when the token for one repository carries no `delete`.
# One repository without it means them all, because the role is on the
# registry, so the caller stops the run on the first.
check_can_delete() {
	local repository="$1" token="$2"
	if grep -qx delete <<<"$(granted_actions "$token")"; then
		return 0
	fi
	echo "registry-purge.sh: the registry granted no delete on ${repository}: the signed-in identity does not hold AcrDelete on ${REGISTRY}. The role goes on the service principal's object id, not its application id; assigned to the application id it names no principal and grants nothing." >&2
	return 1
}

# The repositories this purge owns: every one the registry's catalogue lists
# whose name starts with `tcab-` or `test-cabinet-`, sorted. Fails when the
# catalogue cannot be read.
list_repositories() {
	local token
	token="$(access_token "registry:catalog:*")" || return 1
	curl --silent --show-error --fail \
		--header "Authorization: Bearer ${token}" \
		"https://${REGISTRY_HOST}/acr/v1/_catalog?n=500" </dev/null |
		jq -r '.repositories[] | select(test("^(tcab-|test-cabinet-)"))' | sort
}

# The manifests of one repository, as the registry's own listing gives them:
# digest, tags, lastUpdateTime, imageSize and mediaType, unwrapped from the
# listing into the array the rest of this reads. A repository that does not
# exist (any more) is an empty list; any other answer than the listing is a
# failure, with its status on stderr.
list_manifests() {
	local repository="$1" token="$2" body status result=0
	body="$(mktemp)"
	status="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' \
		--header "Authorization: Bearer ${token}" \
		"https://${REGISTRY_HOST}/acr/v1/${repository}/_manifests?n=500" </dev/null)" || status="000"
	case "$status" in
		200) jq '.manifests // []' "$body" || result=1 ;;
		404) echo "[]" ;;
		*)
			echo "registry-purge.sh: listing ${repository} answered HTTP ${status}." >&2
			result=1
			;;
	esac
	rm -f "$body"
	return "$result"
}

# The digests an index names, one per line. Nothing for a plain image
# manifest. Fails when the manifest cannot be read.
children_of() {
	local repository="$1" digest="$2" token="$3"
	curl --silent --show-error --fail \
		--header "Authorization: Bearer ${token}" \
		--header "Accept: ${MANIFEST_MEDIA_TYPES}" \
		"https://${REGISTRY_HOST}/v2/${repository}/manifests/${digest}" </dev/null |
		jq -r '.manifests[]?.digest'
}

# Deletes one manifest. Judged by the status rather than curl's own success,
# because one failure is none: deleting a manifest list deletes the manifests
# it names, so a child deleted in the same pass as its list is already gone
# when its turn comes, and the registry answers 404.
delete_manifest() {
	local repository="$1" digest="$2" token="$3" status
	status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
		--request DELETE \
		--header "Authorization: Bearer ${token}" \
		"https://${REGISTRY_HOST}/v2/${repository}/manifests/${digest}" </dev/null)" || status="000"
	case "$status" in
		2* | 404) return 0 ;;
		*)
			echo "registry-purge.sh: deleting ${repository}@${digest} answered HTTP ${status}." >&2
			return 1
			;;
	esac
}

# Prints the commits one environment's namespace runs, one per line: the tag
# of every container image in this registry, and the commit every `TCAB_`
# environment variable ends in. Fails, with the cluster's own answer on stderr,
# when the namespace could not be read; reads a namespace with no workload at
# all as a wrong cluster or namespace, and fails likewise.
live_commits() { # environment resource-group cluster namespace
	local environment="$1" group="$2" cluster="$3" namespace="$4"
	local script answer line reference tag found=false
	script="${WORK}/read-images.sh"
	{
		echo "set -eu"
		printf "kubectl -n %s get deployments,statefulsets,daemonsets -o jsonpath='%s'\n" \
			"$namespace" \
			'{range .items[*]}{range .spec.template.spec.containers[*]}{.image}{"\n"}{range .env[*]}{.name}={.value}{"\n"}{end}{end}{end}'
	} >"$script"
	if ! answer="$(aks_invoke "$group" "$cluster" "$script" "sh read-images.sh")"; then
		echo "$answer" >&2
		echo "registry-purge.sh: could not read what ${namespace} runs on ${cluster} (${environment})." >&2
		return 1
	fi
	while IFS= read -r line; do
		[[ -n "$line" ]] || continue
		found=true
		case "$line" in
			"${REGISTRY_HOST}/"*)
				reference="${line%%@*}"
				tag="${reference##*:}"
				;;
			TCAB_*=*)
				tag="${line#*=}"
				tag="${tag##*:}"
				;;
			*) continue ;;
		esac
		if [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then
			echo "$tag"
		fi
	done <<<"$answer"
	if [[ "$found" == false ]]; then
		echo "registry-purge.sh: ${namespace} on ${cluster} (${environment}) reports no workload at all, which is the wrong cluster or namespace." >&2
		return 1
	fi
	return 0
}

# Reads every repository's manifests, concatenated, on stdin and prints the
# newest <count> distinct commits, one per line: each commit dated by the
# newest push of any manifest carrying one of its tags.
newest_commits() {
	local count="$1"
	jq -r --arg re "$COMMIT_TAG" --argjson count "$count" '
		[.[] | . as $m | (.tags // [])[] | select(test($re))
			| {commit: .[:40], time: ($m.lastUpdateTime // "")}]
		| group_by(.commit)
		| map({commit: .[0].commit, time: (map(.time) | max)})
		| sort_by(.time) | reverse | .[:$count] | .[].commit'
}

# Reads one repository's manifests on stdin and prints one line per tagged
# manifest: `keep` or `delete`, its digest, its tags joined by commas, and its
# size in bytes, tab-separated. What keeps a manifest is its tags alone; the
# children of kept lists are protected by the caller, which has to ask the
# registry for them.
classify_tagged() {
	local kept_commits="$1"
	jq -r --arg commit "$COMMIT_TAG" --arg inputs "$INPUTS_TAG" --argjson kept "$kept_commits" '
		[.[] | select((.tags // []) | length > 0)] as $tagged
		# The newest inputs-tagged manifest of each architecture, by digest.
		| ([$tagged[] | . as $m | .tags[] | select(test($inputs))
			| {arch: (capture("-(?<arch>amd64|arm64)$").arch),
			   time: ($m.lastUpdateTime // ""), digest: $m.digest}]
			| group_by(.arch) | map(max_by(.time).digest)) as $newest_inputs
		| $tagged[]
		| (.tags | any((test($commit) | not) and (test($inputs) | not))) as $other
		| (.tags | any(test($commit) and (.[:40] | IN($kept[])))) as $kept_commit
		| (.digest | IN($newest_inputs[])) as $reusable
		| [(if $other or $kept_commit or $reusable then "keep" else "delete" end),
		   .digest, (.tags | join(",")), (.imageSize // 0)]
		| @tsv'
}

# Deletes from one repository every tagged manifest its tags do not keep and
# no kept list names, then every untagged manifest older than an hour that no
# remaining list names. Everything it asks the registry, it asks with the
# repository's own token.
purge_repository() {
	local repository="$1" manifests="$2" kept_commits="$3" token="$4"
	local verdict digest tags size classes
	local protected="" gone="" children=""
	# Children read once per digest: a list's content is what its digest
	# names, so the second pass asks only for lists the first did not see.
	local -A children_of_digest=()

	echo "${repository}:"

	classes="$(classify_tagged "$kept_commits" <<<"$manifests")"

	# Before anything goes, what the kept lists name. A read that fails leaves
	# the repository alone entirely: a manifest that may be a kept child cannot
	# be deleted, and neither can the untagged pass know what is safe.
	while IFS=$'\t' read -r verdict digest tags size; do
		[[ "$verdict" == keep ]] || continue
		if ! is_index "$digest" <<<"$manifests"; then
			continue
		fi
		if ! children="$(children_of "$repository" "$digest" "$token")"; then
			echo "  FAILED to read ${tags} (${digest}), so nothing in ${repository} is deleted" >&2
			FAILURES=$((FAILURES + 1))
			return 0
		fi
		children_of_digest["$digest"]="$children"
		protected+="$children"$'\n'
	done <<<"$classes"

	while IFS=$'\t' read -r verdict digest tags size; do
		[[ -n "$digest" ]] || continue
		if [[ "$verdict" == keep ]]; then
			echo "  kept ${tags}"
			continue
		fi
		if grep -qxF "$digest" <<<"$protected"; then
			echo "  kept ${tags} (a kept image names it)"
			continue
		fi
		if [[ "$DRY_RUN" == true ]]; then
			echo "  would delete ${tags} (${digest})"
			gone+="$digest"$'\n'
			DELETED_BYTES=$((DELETED_BYTES + size))
		elif delete_manifest "$repository" "$digest" "$token"; then
			echo "  deleted ${tags} (${digest})"
			DELETED_BYTES=$((DELETED_BYTES + size))
		else
			echo "  FAILED to delete ${tags} (${digest})" >&2
			FAILURES=$((FAILURES + 1))
		fi
	done <<<"$classes"

	# The repository is listed again, so what stays is what is really there:
	# the kept manifests, one whose delete failed, and one pushed meanwhile.
	if ! manifests="$(list_manifests "$repository" "$token")"; then
		echo "  FAILED to list ${repository} again, so no untagged manifest is deleted" >&2
		FAILURES=$((FAILURES + 1))
		return 0
	fi

	protected=""
	while read -r digest; do
		[[ -n "$digest" ]] || continue
		if grep -qxF "$digest" <<<"$gone"; then
			continue
		fi
		if [[ -z "${children_of_digest[$digest]+set}" ]]; then
			if ! children="$(children_of "$repository" "$digest" "$token")"; then
				echo "  FAILED to read ${digest}, so no untagged manifest is deleted" >&2
				FAILURES=$((FAILURES + 1))
				return 0
			fi
			children_of_digest["$digest"]="$children"
		fi
		protected+="${children_of_digest[$digest]}"$'\n'
	done < <(jq -r '.[] | select((.tags // []) | length > 0)
		| select((.mediaType // "") | test("index|manifest\\.list")) | .digest' <<<"$manifests")

	local young
	young="$(date --utc --date="${UNTAGGED_MIN_AGE} ago" +%Y-%m-%dT%H:%M:%S)"

	while IFS=$'\t' read -r digest size; do
		[[ -n "$digest" ]] || continue
		if grep -qxF "$digest" <<<"$protected"; then
			continue
		fi
		if [[ "$DRY_RUN" == true ]]; then
			echo "  would delete untagged ${digest}"
			DELETED_BYTES=$((DELETED_BYTES + size))
		elif delete_manifest "$repository" "$digest" "$token"; then
			echo "  deleted untagged ${digest}"
			DELETED_BYTES=$((DELETED_BYTES + size))
		else
			echo "  FAILED to delete untagged ${digest}" >&2
			FAILURES=$((FAILURES + 1))
		fi
	done < <(jq -r --arg young "$young" '.[]
		| select((.tags // []) | length == 0)
		| select((.lastUpdateTime | type) == "string" and .lastUpdateTime[:19] < $young)
		| [.digest, (.imageSize // 0)] | @tsv' <<<"$manifests")
}

# True when the manifest list on stdin records <digest> as an index or a
# manifest list.
is_index() {
	local digest="$1"
	jq -e --arg digest "$digest" '
		any(.[]; .digest == $digest
			and ((.mediaType // "") | test("index|manifest\\.list")))' >/dev/null
}

main() {
	local keep_count=1 use_cluster=true tag
	local -a kept=()
	DRY_RUN=false
	FAILURES=0
	DELETED_BYTES=0

	while [[ $# -gt 0 ]]; do
		case "$1" in
			--dry-run) DRY_RUN=true ;;
			--no-cluster) use_cluster=false ;;
			--keep-count)
				[[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || usage
				keep_count="$2"
				shift
				;;
			--keep)
				[[ $# -ge 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || usage
				kept+=("$2")
				shift
				;;
			*) usage ;;
		esac
		shift
	done

	local tool
	for tool in az curl jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "registry-purge.sh: no ${tool} on PATH. az signs in to the registry and asks each cluster, curl lists and deletes from the registry, and jq reads their answers." >&2
			exit 1
		fi
	done

	WORK="$(mktemp -d)"
	trap 'rm -rf "$WORK"' EXIT

	# The one sign-in to the registry, which every token below comes from.
	# First, because it is the cheap thing that fails when the caller is not
	# signed in at all.
	if ! REFRESH_TOKEN="$(registry_refresh_token)"; then
		echo "registry-purge.sh: could not sign in to the registry. Nothing was deleted." >&2
		exit 1
	fi

	# Nothing is deleted unless both clusters said what they run.
	if [[ "$use_cluster" == true ]]; then
		local entry live
		for entry in "${ENVIRONMENTS[@]}"; do
			# shellcheck disable=SC2086 # the entry is four words by construction
			if ! live="$(live_commits $entry)"; then
				echo "registry-purge.sh: nothing was deleted. Pass --no-cluster if the cluster is gone." >&2
				exit 1
			fi
			while read -r tag; do
				[[ -n "$tag" ]] && kept+=("$tag")
			done <<<"$live"
		done
	fi

	local repositories
	if ! repositories="$(list_repositories)"; then
		echo "registry-purge.sh: could not list the registry's repositories. Nothing was deleted." >&2
		exit 1
	fi

	# Every repository's manifests first, because the newest commits are
	# decided across all of them. A repository that cannot be listed, or that
	# no token could be had for, is reported and left alone; the rest still
	# run. The token a repository was listed with is the one everything else
	# done to it uses, so it is the one checked for the right to delete: a
	# token without it stops the run here, before a listing, let alone a
	# delete.
	local repository token
	local -a listed=() listings=()
	local -A tokens=()
	while read -r repository; do
		[[ -n "$repository" ]] || continue
		if token="$(repository_token "$repository")" && ! check_can_delete "$repository" "$token"; then
			echo "registry-purge.sh: nothing was deleted." >&2
			exit 1
		fi
		if [[ -n "$token" ]] &&
			list_manifests "$repository" "$token" >"${WORK}/${repository}.json"; then
			listed+=("$repository")
			listings+=("${WORK}/${repository}.json")
			tokens["$repository"]="$token"
		else
			echo "${repository}:"
			echo "  FAILED to list ${repository}, so nothing in it is deleted" >&2
			FAILURES=$((FAILURES + 1))
		fi
	done <<<"$repositories"

	if [[ ${#listed[@]} -gt 0 ]]; then
		while read -r tag; do
			[[ -n "$tag" ]] && kept+=("$tag")
		done < <(jq -s 'add // []' "${listings[@]}" | newest_commits "$keep_count")
	fi

	local kept_json
	kept_json="$(printf '%s\n' "${kept[@]}" | jq -R . | jq -sc 'map(select(. != "")) | unique')"
	echo "Keeping commits: $(jq -r 'join(" ")' <<<"$kept_json")"
	[[ "$DRY_RUN" == true ]] && echo "Dry run: nothing is deleted."

	for repository in "${listed[@]}"; do
		purge_repository "$repository" "$(cat "${WORK}/${repository}.json")" "$kept_json" "${tokens[$repository]}"
	done

	local gigabytes
	gigabytes="$(awk -v bytes="$DELETED_BYTES" 'BEGIN { printf "%.1f", bytes / 1e9 }')"
	if [[ "$DRY_RUN" == true ]]; then
		echo "Purge finished. Would delete about ${gigabytes} GB."
	else
		echo "Purge finished. Deleted about ${gigabytes} GB."
	fi
	if [[ "$FAILURES" -gt 0 ]]; then
		echo "registry-purge.sh: ${FAILURES} step(s) failed. The next run tries them again." >&2
		exit 1
	fi
}

# Sourcing the file defines the functions and runs nothing.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
