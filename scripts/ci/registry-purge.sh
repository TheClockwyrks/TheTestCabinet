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
# connection). A delete that fails is reported and the rest still run; the
# exit status is 1 if any failed, and the next run tries them again. The
# output is the commits kept, one block per repository, and the approximate
# size of what went.
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

# The repositories this purge owns: every one the registry lists whose name
# starts with `tcab-` or `test-cabinet-`, sorted. Fails when the registry
# cannot be listed.
list_repositories() {
	az acr repository list --name "$REGISTRY" --only-show-errors --output json </dev/null |
		jq -r '.[] | select(test("^(tcab-|test-cabinet-)"))' | sort
}

# The manifests of one repository, as `az acr manifest list-metadata` gives
# them: digest, tags, lastUpdateTime, imageSize and mediaType. A repository
# that does not exist (any more) is an empty list.
list_manifests() {
	local repository="$1" errors
	errors="$(mktemp)"
	if az acr manifest list-metadata \
		--registry "$REGISTRY" --name "$repository" --top 500 \
		--only-show-errors --output json </dev/null 2>"$errors"; then
		rm -f "$errors"
		return 0
	fi
	if grep -qi "not found" "$errors"; then
		rm -f "$errors"
		echo "[]"
		return 0
	fi
	cat "$errors" >&2
	rm -f "$errors"
	return 1
}

# The digests an index names, one per line. Nothing for a plain image
# manifest.
children_of() {
	local repository="$1" digest="$2"
	az acr manifest show \
		--registry "$REGISTRY" --name "${repository}@${digest}" \
		--only-show-errors --output json </dev/null |
		jq -r '.manifests[]?.digest'
}

delete_manifest() {
	local repository="$1" digest="$2"
	az acr repository delete \
		--name "$REGISTRY" --image "${repository}@${digest}" \
		--yes --only-show-errors --output none </dev/null
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
# remaining list names.
purge_repository() {
	local repository="$1" manifests="$2" kept_commits="$3"
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
		if ! children="$(children_of "$repository" "$digest")"; then
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
		elif delete_manifest "$repository" "$digest"; then
			echo "  deleted ${tags} (${digest})"
			DELETED_BYTES=$((DELETED_BYTES + size))
		else
			echo "  FAILED to delete ${tags} (${digest})" >&2
			FAILURES=$((FAILURES + 1))
		fi
	done <<<"$classes"

	# The repository is listed again, so what stays is what is really there:
	# the kept manifests, one whose delete failed, and one pushed meanwhile.
	if ! manifests="$(list_manifests "$repository")"; then
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
			if ! children="$(children_of "$repository" "$digest")"; then
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
		elif delete_manifest "$repository" "$digest"; then
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
	for tool in az jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "registry-purge.sh: no ${tool} on PATH. az lists and deletes from the registry and asks each cluster; jq reads their answers." >&2
			exit 1
		fi
	done

	WORK="$(mktemp -d)"
	trap 'rm -rf "$WORK"' EXIT

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
	# decided across all of them. A repository that cannot be listed is
	# reported and left alone; the rest still run.
	local repository
	local -a listed=() listings=()
	while read -r repository; do
		[[ -n "$repository" ]] || continue
		if list_manifests "$repository" >"${WORK}/${repository}.json"; then
			listed+=("$repository")
			listings+=("${WORK}/${repository}.json")
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
		purge_repository "$repository" "$(cat "${WORK}/${repository}.json")" "$kept_json"
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
