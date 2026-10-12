#!/usr/bin/env bash
# The two checks a deployment makes around the backend's catalog ingest.
#
#   scripts/ci/catalog-ingest.sh preflight <staging|prod> [<commit>]
#   scripts/ci/catalog-ingest.sh verify <staging|prod>
#
# Every deployment starts a new backend pod, whose ingest sidecar
# (deployments/k8s/components/catalog-ingest/ingest.sh) brings the backend's checkout
# to the tip of the environment's catalog branch on the GitHub mirror, brings the
# cold-storage submodule to the commit that tip pins, and asks the backend for one
# forced ingest. A deployment whose sidecar cannot do that has not deployed the
# catalog, so the deployment fails, on one of two sides of the rollout:
#
#   preflight  Before anything is applied, from the machine that deploys. The branch
#              has a tip on the mirror, the tip pins a cold-storage commit, and that
#              commit can be fetched from the repository `.gitmodules` names. It
#              fetches the tip without its files and the pinned commit without its
#              tree, so it downloads none of cold storage's media. A failure here
#              leaves the cluster exactly as it was. Given the commit being deployed,
#              it notes when the tip is another commit, which is what the sidecar
#              will ingest (a roll by hand onto an earlier commit, for one).
#
#              It then reads, in the cluster, the free space on the state volume of
#              the backend that is running, which the new pod's sidecar fetches
#              onto, and fails when that is less than a fetch needs:
#              TCAB_INGEST_MIN_FREE_MB (1024), plus TCAB_INGEST_COLD_STORAGE_MB
#              (2560) when the volume's cold storage is not at the commit the tip
#              pins and so has to be fetched. A sidecar that cannot write its fetch
#              ingests nothing, and on a backend that needs the ingest to become
#              ready that takes the backend out of service until the rollout times
#              out. Only a reading that is too low fails the check. An environment
#              with no backend yet has no volume to read, and a volume that cannot
#              be read (no az here, a backend that is down) is noted and left to
#              verify: a deployment may be what repairs it.
#
#   verify     Once the backend's rollout is ready, in the cluster. It reads the
#              result the sidecar recorded (/tmp/ingest-result in the `ingest`
#              container), waiting while the sidecar is still working, for at most
#              TCAB_INGEST_WAIT_SECONDS (600). It fails, printing the step that failed
#              and the sidecar's message, unless the result is `ok`. It changes
#              nothing: a sidecar that failed ingested nothing, so the backend is
#              serving the catalog and the baselines it had, and stays rolled out.
#              The wait is spent only on a warm volume, where the backend is ready
#              before its sidecar is done; a backend that had to wait on the ingest
#              to become ready has its result already.
#
# scripts/ci/pre-deploy.sh and scripts/ci/deploy-preflight.sh run the preflight for
# the staging deployment and scripts/ci/post-deploy.sh its verify;
# scripts/ci/deploy-environment.sh runs both for the environment it rolls.
#
# The cluster is reached as every deploy script reaches it, through
# `az aks command invoke` (lib.sh's aks_invoke) under the caller's identity, with the
# permissions a deployment already holds. Where it is comes from the
# THE_TEST_CABINET_* variables a deployment exports, else from scripts/lib/env.sh:
#
#   THE_TEST_CABINET_RESOURCE_GROUP  The resource group the cluster sits in
#   THE_TEST_CABINET_CLUSTER         The cluster's name
#   THE_TEST_CABINET_NAMESPACE       The namespace the backend runs in
#
# And five settings:
#
#   TCAB_CATALOG_REPO            The mirror the sidecar clones (the public GitHub mirror)
#   TCAB_INGEST_MIN_FREE_MB      Free space on the state volume a fetch needs (1024)
#   TCAB_INGEST_COLD_STORAGE_MB  What a fetch of cold storage needs on top of it (2560)
#   TCAB_INGEST_WAIT_SECONDS     How long verify waits on a sidecar still working (600)
#   TCAB_INGEST_POLL_SECONDS     How often it reads the result while it waits (5)
set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/lib.sh
source "${CI_DIR}/lib.sh"
# shellcheck source=scripts/lib/env.sh
source "${CI_DIR}/../lib/env.sh"

readonly USAGE="usage: scripts/ci/catalog-ingest.sh preflight <staging|prod> [<commit>]
       scripts/ci/catalog-ingest.sh verify <staging|prod>"
readonly BACKEND="the-test-cabinet-backend"
# Where ingest.sh records its result, in the `ingest` container.
readonly RESULT_PATH="/tmp/ingest-result"
readonly SUBMODULE="cold-storage"
# Where the backend's state volume is mounted, in both of its containers.
readonly STATE_PATH="/state"

mode="${1:-}"
environment="${2:-}"
commit="${3:-}"
case "$mode" in
	preflight) [[ $# -eq 2 || $# -eq 3 ]] || mode="" ;;
	verify) [[ $# -eq 2 ]] || mode="" ;;
	*) mode="" ;;
esac
if [[ -z "$mode" ]]; then
	echo "$USAGE" >&2
	exit 1
fi
if ! tcab_env_resolve "$environment" 2>/dev/null; then
	echo "$USAGE" >&2
	echo "catalog-ingest.sh: unknown environment '${environment}' (expected staging or prod)" >&2
	exit 1
fi
readonly ENVIRONMENT="$environment"
readonly BRANCH="$TCAB_INGEST_BRANCH"
readonly REPO="${TCAB_CATALOG_REPO:-https://github.com/TheClockwyrks/TheTestCabinet.git}"
readonly RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-$TCAB_RG}"
readonly CLUSTER="${THE_TEST_CABINET_CLUSTER:-$TCAB_CLUSTER}"
readonly NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-$TCAB_NAMESPACE}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A submodule URL as git resolves it: one that starts with `./` or `../` is relative
# to the superproject's own URL.
resolve_url() { # superproject-url submodule-url
	local base="${1%/}" url="$2"
	case "$url" in
		./* | ../*) ;;
		*)
			printf '%s\n' "$url"
			return
			;;
	esac
	while :; do
		case "$url" in
			./*) url="${url#./}" ;;
			../*)
				url="${url#../}"
				base="${base%/*}"
				;;
			*) break ;;
		esac
	done
	printf '%s/%s\n' "$base" "$url"
}

# git that never waits on a prompt and gives up on a connection that stalls.
quiet_git() {
	GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30 git "$@"
}

preflight_failed() { # what
	echo >&2 "catalog-ingest.sh: $1"
	remediation \
		"Nothing was applied: ${NAMESPACE} runs what it ran. The ${ENVIRONMENT} backend's ingest" \
		"sidecar fetches the tip of ${BRANCH} and the cold-storage commit it pins, and ingests" \
		"nothing when it cannot, so the deployment would not have deployed its catalog." \
		"Run this check again with:" \
		"    scripts/ci/catalog-ingest.sh preflight ${ENVIRONMENT}"
	exit 1
}

preflight() {
	if ! command -v git >/dev/null 2>&1; then
		echo "catalog-ingest.sh: no git on PATH, which reads the catalog mirror." >&2
		exit 1
	fi

	local tip pin entry url cold_url
	echo "Checking that the ${ENVIRONMENT} catalog can be fetched: ${BRANCH} on ${REPO}."
	tip="$(quiet_git ls-remote "$REPO" "refs/heads/${BRANCH}" | awk 'NR == 1 { print $1 }')" || tip=""
	if ! [[ "$tip" =~ ^[0-9a-f]{40}$ ]]; then
		preflight_failed "${REPO} has no branch ${BRANCH}, or could not be reached."
	fi

	# The tip's commit and trees and no file, which is enough to read what it pins;
	# `.gitmodules` is then the one file fetched, on demand.
	git init --quiet "${work}/catalog"
	git -C "${work}/catalog" remote add origin "$REPO"
	if ! quiet_git -C "${work}/catalog" fetch --quiet --depth 1 --filter=blob:none origin "$tip"; then
		preflight_failed "the tip of ${BRANCH}, ${tip}, could not be fetched from ${REPO}."
	fi
	entry="$(git -C "${work}/catalog" ls-tree "$tip" "$SUBMODULE")"
	pin="$(awk '$1 == "160000" && $2 == "commit" { print $3 }' <<<"$entry")"
	if ! [[ "$pin" =~ ^[0-9a-f]{40}$ ]]; then
		preflight_failed "${BRANCH} at ${tip} pins no ${SUBMODULE} submodule."
	fi
	if ! quiet_git -C "${work}/catalog" cat-file blob "${tip}:.gitmodules" >"${work}/gitmodules" ||
		! url="$(git config --file "${work}/gitmodules" --get "submodule.${SUBMODULE}.url")"; then
		preflight_failed "the .gitmodules of ${BRANCH} at ${tip} names no URL for ${SUBMODULE}."
	fi
	cold_url="$(resolve_url "$REPO" "$url")"

	# The pinned commit alone: no tree and so no media.
	git init --quiet "${work}/cold"
	if ! quiet_git -C "${work}/cold" fetch --quiet --depth 1 --filter=tree:0 "$cold_url" "$pin"; then
		preflight_failed "${BRANCH} at ${tip} pins ${SUBMODULE} at ${pin}, which could not be fetched from ${cold_url}."
	fi

	echo "The tip of ${BRANCH} is ${tip}; it pins ${SUBMODULE} at ${pin}, which ${cold_url} holds."
	if [[ -n "$commit" && "$commit" != "$tip" ]]; then
		echo "Note: the sidecar ingests the catalog of the branch tip, ${tip}, not of ${commit}."
	fi

	check_state_volume "$pin"
}

# The second half of the preflight: the running backend's state volume has room for
# the fetch the new pod's sidecar makes onto it. <pin> is the cold-storage commit
# the branch tip pins.
check_state_volume() { # pin
	local pin="$1" tool
	for tool in az jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "Note: no ${tool} on PATH, so the free space on ${NAMESPACE}'s state volume was not read."
			return 0
		fi
	done

	local min_free="${TCAB_INGEST_MIN_FREE_MB:-1024}" cold_storage="${TCAB_INGEST_COLD_STORAGE_MB:-2560}"
	[[ "$min_free" =~ ^[0-9]+$ ]] || min_free=1024
	[[ "$cold_storage" =~ ^[0-9]+$ ]] || cold_storage=2560

	# The script that runs in the cluster. It reports and decides nothing, so that
	# only a reading it could take can fail the deployment.
	local script="${work}/catalog-ingest-volume.sh"
	{
		printf 'NAMESPACE=%q\nBACKEND=%q\nSTATE_PATH=%q\nSUBMODULE=%q\n' \
			"$NAMESPACE" "$BACKEND" "$STATE_PATH" "$SUBMODULE"
		cat <<'SCRIPT'
set -u
k() { kubectl -n "$NAMESPACE" "$@"; }

if [ -z "$(k get deployment "$BACKEND" --ignore-not-found -o name 2>/dev/null)" ]; then
	echo "VOLUME absent"
	exit 0
fi
free_kb="$(k exec "deployment/${BACKEND}" -c ingest -- df -Pk "$STATE_PATH" 2>/dev/null | awk 'NR == 2 { print $4 }')"
case "$free_kb" in
	'' | *[!0-9]*)
		echo "VOLUME unreadable"
		exit 0
		;;
esac
cold="$(k exec "deployment/${BACKEND}" -c ingest -- git -C "${STATE_PATH}/checkout/${SUBMODULE}" rev-parse --verify --quiet HEAD 2>/dev/null)" || cold=""
echo "VOLUME free_mb=$((free_kb / 1024)) cold_storage=${cold:-none}"
SCRIPT
	} >"$script"

	echo "Reading the free space on the state volume of ${NAMESPACE} on ${CLUSTER}."
	local answer verdict=0 line free held needed
	answer="$(aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$script" "bash $(basename "$script")" 2>&1)" || verdict=$?
	line="$(grep '^VOLUME ' <<<"$answer" | tail -n 1)" || line=""
	case "$line" in
		"VOLUME absent")
			echo "${NAMESPACE} has no ${BACKEND} yet, so there is no state volume to read."
			return 0
			;;
		"VOLUME free_mb="*) ;;
		*)
			[[ "$verdict" -eq 0 && -z "$answer" ]] || printf '%s\n' "$answer"
			echo "Note: the state volume of ${NAMESPACE} could not be read, so its free space was not checked."
			return 0
			;;
	esac
	free="$(sed -n 's/^VOLUME free_mb=\([0-9]*\) .*/\1/p' <<<"$line")"
	held="${line##*cold_storage=}"
	needed="$min_free"
	if [[ "$held" != "$pin" ]]; then
		needed=$((min_free + cold_storage))
	fi
	if ((free < needed)); then
		echo >&2 "catalog-ingest.sh: the state volume of ${NAMESPACE} has ${free} MiB free, and the sidecar's fetch needs ${needed} MiB."
		if [[ "$held" != "$pin" ]]; then
			echo >&2 "Its cold storage is at ${held} and ${BRANCH} pins ${pin}, so cold storage is fetched too."
		fi
		preflight_failed "the ${ENVIRONMENT} backend's ${STATE_PATH} is too full for the sidecar to fetch the catalog onto."
	fi
	echo "The state volume of ${NAMESPACE} has ${free} MiB free; the sidecar's fetch needs ${needed} MiB."
}

verify() {
	for tool in az jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "catalog-ingest.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
			exit 1
		fi
	done

	local wait_seconds="${TCAB_INGEST_WAIT_SECONDS:-600}" poll_seconds="${TCAB_INGEST_POLL_SECONDS:-5}"
	[[ "$wait_seconds" =~ ^[0-9]+$ ]] || wait_seconds=600
	[[ "$poll_seconds" =~ ^[0-9]+$ ]] || poll_seconds=5

	# The script that runs in the cluster. Its settings are written at its head; the
	# rest is quoted, so it reaches the cluster as written here.
	local script="${work}/catalog-ingest-verify.sh"
	{
		printf 'NAMESPACE=%q\nBACKEND=%q\nRESULT_PATH=%q\nWAIT=%q\nPOLL=%q\n' \
			"$NAMESPACE" "$BACKEND" "$RESULT_PATH" "$wait_seconds" "$poll_seconds"
		cat <<'SCRIPT'
set -u
k() { kubectl -n "$NAMESPACE" "$@"; }

waited=0
result=""
status=""
while :; do
	result="$(k exec "deployment/${BACKEND}" -c ingest -- cat "$RESULT_PATH" 2>/dev/null)" || result=""
	status="$(sed -n 's/^status=//p' <<<"$result" | head -n 1)"
	case "$status" in
		ok | failed) break ;;
	esac
	[ "$waited" -lt "$WAIT" ] || break
	sleep "$POLL"
	waited=$((waited + POLL))
done

step="$(sed -n 's/^step=//p' <<<"$result" | head -n 1)"
case "$status" in
	ok)
		echo "INGEST ok"
		printf '%s\n' "$result"
		exit 0
		;;
	failed)
		echo "INGEST failed at step '${step}'"
		printf '%s\n' "$result"
		exit 1
		;;
esac
if [ -n "$result" ]; then
	echo "INGEST unfinished: still at step '${step}' after ${waited}s"
	printf '%s\n' "$result"
else
	echo "INGEST unknown: the ingest container of ${BACKEND} recorded no result in ${waited}s"
fi
echo "=== the ingest container's log ==="
k logs "deployment/${BACKEND}" -c ingest --tail=40 || true
exit 1
SCRIPT
	} >"$script"

	echo "Reading the catalog ingest of ${NAMESPACE} on ${CLUSTER}."
	local verdict=0
	aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$script" "bash $(basename "$script")" || verdict=$?
	case "$verdict" in
		0)
			echo "The ${ENVIRONMENT} backend ingested the tip of ${BRANCH}."
			;;
		1)
			echo >&2 "catalog-ingest.sh: the ${ENVIRONMENT} backend did not ingest the tip of ${BRANCH}; the sidecar's step and message are above."
			remediation \
				"Nothing was ingested and nothing was rolled back: the backend is rolled out and" \
				"serves the catalog and the baselines it had. Fix what the message names, then" \
				"ingest without a deployment, which fails the same way when the fetch does:" \
				"    scripts/reingest-cluster.sh --env ${ENVIRONMENT}" \
				"A sidecar still working when the wait ran out is read again with:" \
				"    scripts/ci/catalog-ingest.sh verify ${ENVIRONMENT}"
			exit 1
			;;
		*)
			echo >&2 "catalog-ingest.sh: the ingest sidecar's result could not be read from ${CLUSTER}, above."
			remediation "Nothing was rolled back. Read it again with:" \
				"    scripts/ci/catalog-ingest.sh verify ${ENVIRONMENT}"
			exit 1
			;;
	esac
}

"$mode"
