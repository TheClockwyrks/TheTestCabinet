#!/usr/bin/env bash
# The two checks a deployment makes around the backend's catalog ingest.
#
#   scripts/ci/catalog-ingest.sh preflight <staging|prod> [<commit>]
#   scripts/ci/catalog-ingest.sh verify <staging|prod>
#
# Every deployment starts a new backend pod, whose ingest sidecar (the `ingest`
# container of deployments/k8s/overlays/<env>/patch-backend-ingest.yaml) brings the
# backend's checkout to the tip of the environment's catalog branch on the GitHub
# mirror, brings the cold-storage submodule to the commit that tip pins, and asks the
# backend for one forced ingest. A deployment whose sidecar cannot do that has not deployed the
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
#              It reads nothing in the cluster. Every backend pod the deployment
#              starts fetches onto an ephemeral volume of its own, created empty at
#              the size components/postgres/deployment-backend.yaml gives it, so no
#              state the running backend holds decides whether the fetch has room.
#
#   verify     Once the backend's rollout is ready, in the cluster. It reads the
#              result the sidecar recorded (/tmp/ingest-result in the `ingest`
#              container), waiting while the sidecar is still working, for at most
#              TCAB_INGEST_WAIT_SECONDS (600). AKS ends a command after ten minutes
#              and keeps none of its output, so the wait is spent in calls of at
#              most TCAB_INGEST_CALL_SECONDS (240), one after another, and a wait
#              that ends with no outcome prints what the last read answered and
#              the sidecar's log. It fails, printing the step that failed
#              and the sidecar's message, unless the result is `ok`. It changes
#              nothing: a sidecar that failed ingested nothing, so the backend is
#              serving the catalog and the baselines it had, and stays rolled out.
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
#   TCAB_INGEST_WAIT_SECONDS     How long verify waits on a sidecar still working (600)
#   TCAB_INGEST_POLL_SECONDS     How often it reads the result while it waits (5)
#   TCAB_INGEST_CALL_SECONDS     The longest one call into the cluster waits (240)
#   TCAB_INGEST_READ_SECONDS     How long one read of the result is given (30)
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
# Where the ingest sidecar records its result, in the `ingest` container.
readonly RESULT_PATH="/tmp/ingest-result"
readonly SUBMODULE="cold-storage"

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
}

verify() {
	for tool in az jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "catalog-ingest.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
			exit 1
		fi
	done

	local wait_seconds="${TCAB_INGEST_WAIT_SECONDS:-600}" poll_seconds="${TCAB_INGEST_POLL_SECONDS:-5}"
	local call_seconds="${TCAB_INGEST_CALL_SECONDS:-240}" read_seconds="${TCAB_INGEST_READ_SECONDS:-30}"
	[[ "$wait_seconds" =~ ^[0-9]+$ ]] || wait_seconds=600
	[[ "$poll_seconds" =~ ^[0-9]+$ ]] || poll_seconds=5
	[[ "$call_seconds" =~ ^[1-9][0-9]*$ ]] || call_seconds=240
	[[ "$read_seconds" =~ ^[1-9][0-9]*$ ]] || read_seconds=30

	# The script that runs in the cluster, once for each call: `bash <script> <wait>
	# <waited>`, the seconds this call may wait and the seconds the calls before it
	# did. Its settings are written at its head; the rest is quoted, so it reaches
	# the cluster as written here. It runs in the image AKS gives a command, which
	# carries no sed, so it reads the result with the shell alone.
	local script="${work}/catalog-ingest-verify.sh"
	{
		printf 'NAMESPACE=%q\nBACKEND=%q\nRESULT_PATH=%q\nPOLL=%q\nREAD=%q\n' \
			"$NAMESPACE" "$BACKEND" "$RESULT_PATH" "$poll_seconds" "$read_seconds"
		cat <<'SCRIPT'
set -u
WAIT="$1"
BEFORE="$2"
k() { kubectl -n "$NAMESPACE" "$@"; }

# The value of the result's first `<name>=` line.
field() { # name
	local line
	while IFS= read -r line; do
		case "$line" in
			"$1="*)
				printf '%s\n' "${line#*=}"
				return 0
				;;
		esac
	done <<<"$result"
}

# One read of the result file, given READ seconds: a read that hangs is a read
# that failed, and its READ seconds count against the wait. What a failed read
# answered is kept, to be printed when the wait ends with no outcome.
waited=0
result=""
status=""
refusal=""
while :; do
	if answer="$(timeout "$READ" kubectl -n "$NAMESPACE" exec "deployment/${BACKEND}" -c ingest -- cat "$RESULT_PATH" 2>&1)"; then
		result="$answer"
		refusal=""
	else
		code=$?
		result=""
		refusal="$answer"
		if [ "$code" -eq 124 ]; then
			refusal="the read did not answer in ${READ}s"
			waited=$((waited + READ))
		fi
	fi
	status="$(field status)"
	case "$status" in
		ok | failed) break ;;
	esac
	[ "$waited" -lt "$WAIT" ] || break
	sleep "$POLL"
	waited=$((waited + POLL))
done

step="$(field step)"
total=$((BEFORE + waited))
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
	echo "INGEST unfinished: still at step '${step}' after ${total}s"
	printf '%s\n' "$result"
else
	echo "INGEST unknown: the ingest container of ${BACKEND} recorded no result in ${total}s"
	[ -z "$refusal" ] || printf 'The last read of %s answered:\n%s\n' "$RESULT_PATH" "$refusal"
fi
echo "=== the ingest container's log ==="
k logs "deployment/${BACKEND}" -c ingest --tail=40 || true
exit 1
SCRIPT
	} >"$script"

	# The wait is spent a call at a time, each well inside the ten minutes AKS gives
	# a command, so a sidecar still working is reported by the script and not by AKS
	# ending it. Only the last call's answer is printed in full.
	echo "Reading the catalog ingest of ${NAMESPACE} on ${CLUSTER}."
	local waited=0 share answer outcome verdict
	while :; do
		share=$((wait_seconds - waited))
		((share <= call_seconds)) || share="$call_seconds"
		verdict=0
		answer="$(aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$script" "bash $(basename "$script") ${share} ${waited}")" || verdict=$?
		waited=$((waited + share))
		outcome="$(grep -m 1 '^INGEST ' <<<"$answer")" || outcome=""
		case "$outcome" in
			"INGEST unfinished"* | "INGEST unknown"*)
				((waited < wait_seconds)) || break
				echo "${outcome}; reading again."
				;;
			*) break ;;
		esac
	done
	[[ -z "$answer" ]] || printf '%s\n' "$answer"

	case "${verdict}:${outcome}" in
		0:*)
			echo "The ${ENVIRONMENT} backend ingested the tip of ${BRANCH}."
			;;
		1:"INGEST unfinished"* | 1:"INGEST unknown"*)
			echo >&2 "catalog-ingest.sh: the ingest sidecar of the ${ENVIRONMENT} backend recorded no outcome in ${waited}s; what it recorded and its log are above."
			remediation \
				"Nothing was rolled back, and whether the backend ingested the tip of ${BRANCH} is" \
				"not known. A sidecar still working is read again with:" \
				"    scripts/ci/catalog-ingest.sh verify ${ENVIRONMENT}" \
				"One that stopped is replaced by an ingest without a deployment:" \
				"    tcab ingest --env ${ENVIRONMENT}"
			exit 1
			;;
		1:*)
			echo >&2 "catalog-ingest.sh: the ${ENVIRONMENT} backend did not ingest the tip of ${BRANCH}; the sidecar's step and message are above."
			remediation \
				"Nothing was ingested and nothing was rolled back: the backend is rolled out and" \
				"serves the catalog and the baselines it had. Fix what the message names, then" \
				"ingest without a deployment, which fails the same way when the fetch does:" \
				"    tcab ingest --env ${ENVIRONMENT}"
			exit 1
			;;
		4:*)
			echo >&2 "catalog-ingest.sh: AKS ended the read of the ingest sidecar's result on ${CLUSTER}, above, so the result is not known."
			remediation "Nothing was rolled back. Read it again with:" \
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
