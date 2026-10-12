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
#              The same call reads the claim the volume is, `tcab-backend-state`,
#              and the preflight compares the size the deployment is about to
#              apply for it with the size it has. The size to apply is the claim's
#              storage request in the render: the file TCAB_INGEST_MANIFEST names,
#              which is how scripts/ci/deploy-environment.sh hands over the file it
#              applies, else this script's own `kubectl kustomize` of the
#              environment's overlay. Then:
#
#                the same size  the free space is checked as it was read;
#                a larger one   nine tenths of the growth counts as free space (a
#                               filesystem keeps the rest for itself), so a full
#                               volume does not stop the deployment that enlarges
#                               it. It fails when the claim's storage class does
#                               not allow expansion (allowVolumeExpansion), because
#                               the apply would be refused part-way. A caller that
#                               may not read storage classes asks the cluster with
#                               a server-side dry run of the resize, which changes
#                               nothing, and fails only on the answer that the
#                               class does not support resizing;
#                a smaller one  it fails: Kubernetes refuses to shrink a claim.
#
#              A size the render does not state, a claim that cannot be read, a
#              size in a notation this does not read and a class nothing answered
#              for are each noted and fail nothing.
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
# And six settings:
#
#   TCAB_CATALOG_REPO            The mirror the sidecar clones (the public GitHub mirror)
#   TCAB_INGEST_MANIFEST         The render about to be applied, an absolute path
#                                (default: this script renders the overlay)
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
# The claim the state volume is, in both environments, and the share of a claim's
# growth, in tenths, that reaches the filesystem as free space: ext4 keeps a
# twentieth for root and a little more for its own tables.
readonly CLAIM="tcab-backend-state"
readonly GROWTH_TENTHS=9

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

# A Kubernetes quantity of storage in MiB, rounded down. It reads a whole number
# with a binary or decimal suffix or none, which is every size a claim is given
# here, and fails on any other notation.
quantity_mb() { # quantity
	[[ "$1" =~ ^([0-9]+)(Ki|Mi|Gi|Ti|k|M|G|T)?$ ]] || return 1
	local number="${BASH_REMATCH[1]}"
	((${#number} <= 15)) || return 1
	number=$((10#$number))
	case "${BASH_REMATCH[2]}" in
		Ki) echo $((number / 1024)) ;;
		Mi) echo "$number" ;;
		Gi) echo $((number * 1024)) ;;
		Ti) echo $((number * 1048576)) ;;
		k) echo $((number * 1000 / 1048576)) ;;
		M) echo $((number * 1000000 / 1048576)) ;;
		G) echo $((number * 1000000000 / 1048576)) ;;
		T) echo $((number * 1000000000000 / 1048576)) ;;
		*) echo $((number / 1048576)) ;;
	esac
}

# Prints the storage the deployment is about to ask of the state volume's claim: the
# request the render makes for it, read from kustomize's canonical output, whose
# indentation is the renderer's. Prints nothing when no render states one.
declared_size() {
	local manifest="${TCAB_INGEST_MANIFEST:-}"
	if [[ -z "$manifest" ]]; then
		command -v kubectl >/dev/null 2>&1 || return 0
		manifest="${work}/render.yaml"
		kubectl kustomize "deployments/k8s/overlays/${ENVIRONMENT}" >"$manifest" 2>/dev/null || return 0
	fi
	[[ -r "$manifest" ]] || return 0
	awk -v claim="$CLAIM" '
		function flush() {
			if (kind == "PersistentVolumeClaim" && name == claim && size != "") print size
			kind = name = size = section = ""
		}
		/^---[[:space:]]*$/ { flush(); next }
		/^[^[:space:]#]/ { section = $1 }
		/^kind: / { kind = $2 }
		section == "metadata:" && /^  name: / { name = $2 }
		section == "spec:" && /^      storage: / { size = $2 }
		END { flush() }
	' "$manifest" | tr -d "\"'" | head -n 1
}

# The value of one `name=value` word of a line the cluster script wrote.
line_field() { # line name
	local words word
	read -ra words <<<"$1"
	for word in "${words[@]}"; do
		if [[ "$word" == "$2="* ]]; then
			printf '%s' "${word#*=}"
			return 0
		fi
	done
}

claim_failed() { # what
	echo >&2 "catalog-ingest.sh: $1"
	remediation \
		"Nothing was applied: ${NAMESPACE} runs what it ran. The size is the storage request of" \
		"${CLAIM} in deployments/k8s/components/postgres/deployment-backend.yaml, which a" \
		"deployment may raise and may not lower below what the volume holds. A checkout from" \
		"before the volume was last grown still declares the smaller size, and cannot be" \
		"deployed to ${NAMESPACE} as it is. Run this check again with:" \
		"    scripts/ci/catalog-ingest.sh preflight ${ENVIRONMENT}"
	exit 1
}

# Compares the size the deployment asks of the claim with the claim in the cluster,
# as the CLAIM line of the cluster script reports it. It fails on a resize the
# cluster would refuse, and sets `growth` to the MiB of free space a resize it
# would accept adds.
growth=0
check_claim() { # declared claim-line
	local declared="$1" line="$2"
	local capacity request class expansion dry_run declared_mb capacity_mb request_mb
	if [[ -z "$declared" ]]; then
		echo "Note: the render to be applied states no size for ${CLAIM}, so it was not compared with the claim in ${NAMESPACE}."
		return 0
	fi
	case "$line" in
		"CLAIM absent")
			echo "${NAMESPACE} has no ${CLAIM} claim yet; the deployment creates it at ${declared}."
			return 0
			;;
		"CLAIM capacity="*) ;;
		*)
			echo "Note: the ${CLAIM} claim of ${NAMESPACE} could not be read, so the ${declared} the deployment asks for was not compared with it."
			return 0
			;;
	esac
	capacity="$(line_field "$line" capacity)"
	request="$(line_field "$line" request)"
	class="$(line_field "$line" class)"
	expansion="$(line_field "$line" expansion)"
	dry_run="$(line_field "$line" dry_run)"
	if ! declared_mb="$(quantity_mb "$declared")"; then
		echo "Note: the size the deployment asks for ${CLAIM}, ${declared}, is in a notation this check does not read, so it was not compared with the claim."
		return 0
	fi
	# A claim that is not bound yet has no capacity, and then what it requests is
	# all there is to compare with.
	request_mb="$(quantity_mb "$request")" || request_mb=""
	capacity_mb="$(quantity_mb "$capacity")" || capacity_mb=""
	if [[ -z "$request_mb" && -z "$capacity_mb" ]]; then
		echo "Note: the ${CLAIM} claim of ${NAMESPACE} reports no size this check reads, so the ${declared} the deployment asks for was not compared with it."
		return 0
	fi

	local resize
	resize="$(line_field "$line" resize)"

	# Smaller than the volume is, or than an unbound claim asks for: no cluster
	# lowers either.
	if { [[ -n "$capacity_mb" ]] && ((declared_mb < capacity_mb)); } ||
		{ [[ -z "$capacity_mb" ]] && ((declared_mb < request_mb)); }; then
		echo >&2 "catalog-ingest.sh: the deployment asks for ${declared} of ${CLAIM}, and the claim in ${NAMESPACE} holds ${capacity:-nothing yet} and requests ${request:-nothing}."
		echo >&2 "Kubernetes refuses to shrink a volume, so the apply would fail part-way through."
		claim_failed "the ${ENVIRONMENT} deployment would shrink the backend's state volume."
	fi
	if [[ -z "$capacity_mb" ]] || ((declared_mb == capacity_mb)); then
		return 0
	fi

	# Larger than the volume is.
	if [[ -n "$request_mb" ]] && ((declared_mb < request_mb)); then
		# Less than the claim requests: the deployment lowers a request an earlier
		# one made and the cluster has not fulfilled. Recent Kubernetes accepts
		# that and older refuses it, so the cluster's own answer decides.
		if [[ "$dry_run" != accepted ]]; then
			echo >&2 "catalog-ingest.sh: the deployment asks for ${declared} of ${CLAIM}, whose claim in ${NAMESPACE} holds ${capacity} and requests ${request}, and the cluster did not accept lowering that request in a dry run."
			echo >&2 "The apply would fail part-way through."
			claim_failed "the ${ENVIRONMENT} deployment lowers a resize of the backend's state volume that the cluster would not let it lower."
		fi
		echo "The deployment lowers the size ${CLAIM} requests in ${NAMESPACE} from ${request} to ${declared}, above the ${capacity} the volume holds, which the cluster accepted in a dry run."
	elif [[ -n "$request_mb" ]] && ((declared_mb == request_mb)); then
		# What the claim already requests: an earlier apply resized it. The growth
		# is room only while the cluster is carrying the resize out.
		case "$resize" in
			*Failed* | *Infeasible*)
				echo "Note: the claim ${CLAIM} of ${NAMESPACE} requests ${request} and its volume holds ${capacity}: the cluster reports that the resize failed (${resize%%,*}). No growth is counted, and the volume is judged by the free space it has."
				return 0
				;;
			*ResizeInProgress* | *NodeResizePending* | *Resizing:True* | *FileSystemResizePending:True*)
				echo "The state volume of ${NAMESPACE} holds ${capacity} and its claim already requests ${request}: a resize is under way."
				;;
			*)
				echo "Note: the claim ${CLAIM} of ${NAMESPACE} requests ${request} and its volume holds ${capacity}, and the claim reports no resize under way. No growth is counted, and the volume is judged by the free space it has."
				return 0
				;;
		esac
	elif [[ "$expansion" == false ]]; then
		echo >&2 "catalog-ingest.sh: the deployment grows ${CLAIM} from ${capacity} to ${declared}, and the claim's storage class, ${class:-<none>}, does not allow volume expansion (allowVolumeExpansion)."
		echo >&2 "Kubernetes refuses that resize, so the apply would fail part-way through."
		claim_failed "the ${ENVIRONMENT} deployment grows a state volume whose storage class cannot expand it."
	elif [[ "$dry_run" == refused ]]; then
		echo >&2 "catalog-ingest.sh: the deployment grows ${CLAIM} from ${capacity} to ${declared}, and the cluster refused that resize in a dry run: the claim's storage class, ${class:-<none>}, does not support it."
		claim_failed "the ${ENVIRONMENT} deployment grows a state volume whose storage class cannot expand it."
	elif [[ "$expansion" == true ]]; then
		echo "The deployment grows the state volume of ${NAMESPACE} from ${capacity} to ${declared}, which its storage class, ${class}, allows."
	elif [[ "$dry_run" == accepted ]]; then
		echo "The deployment grows the state volume of ${NAMESPACE} from ${capacity} to ${declared}, which the cluster accepted in a dry run (its storage class, ${class:-<none>}, could not be read)."
	else
		echo "The deployment grows the state volume of ${NAMESPACE} from ${capacity} to ${declared}."
		echo "Note: whether the claim's storage class, ${class:-<none>}, allows expansion could not be read, so the growth is counted without that check."
	fi
	growth=$(((declared_mb - capacity_mb) * GROWTH_TENTHS / 10))
}

# The second half of the preflight: the running backend's state volume has room for
# the fetch the new pod's sidecar makes onto it, the growth the deployment applies
# to the volume counted, and the deployment asks for no resize of it the cluster
# would refuse. <pin> is the cold-storage commit the branch tip pins.
check_state_volume() { # pin
	local pin="$1" tool
	for tool in az jq; do
		if ! command -v "$tool" >/dev/null 2>&1; then
			echo "Note: no ${tool} on PATH, so the state volume of ${NAMESPACE} was not read: neither its free space nor its claim."
			return 0
		fi
	done

	local min_free="${TCAB_INGEST_MIN_FREE_MB:-1024}" cold_storage="${TCAB_INGEST_COLD_STORAGE_MB:-2560}"
	[[ "$min_free" =~ ^[0-9]+$ ]] || min_free=1024
	[[ "$cold_storage" =~ ^[0-9]+$ ]] || cold_storage=2560

	# What the deployment asks of the claim. Only a size that is one word of digits
	# and letters is sent to the cluster, where the dry run quotes it.
	local declared sent=""
	declared="$(declared_size)" || declared=""
	[[ "$declared" =~ ^[0-9]+[A-Za-z]*$ ]] && sent="$declared"

	# The script that runs in the cluster. It reports and decides nothing, so that
	# only a reading it could take can fail the deployment.
	local script="${work}/catalog-ingest-volume.sh"
	{
		printf 'NAMESPACE=%q\nBACKEND=%q\nSTATE_PATH=%q\nSUBMODULE=%q\nCLAIM=%q\nDECLARED=%q\n' \
			"$NAMESPACE" "$BACKEND" "$STATE_PATH" "$SUBMODULE" "$CLAIM" "$sent"
		cat <<'SCRIPT'
set -u
k() { kubectl -n "$NAMESPACE" "$@"; }

# The claim: what it holds, what it requests, what it says of a resize the
# cluster is carrying out (its resize status and its conditions) and its storage
# class, then whether the class allows expansion. A class that cannot be read (it
# is cluster-scoped, and the caller may hold its namespace alone) leaves the
# question to a server-side dry run of the resize, which persists nothing; only the
# admission answer that the class does not support resizing counts as a refusal.
# The dry run is made for every size other than the one the claim requests: it is
# how a deployment that lowers a request the cluster never fulfilled is decided,
# and a refusal of a growth counts whatever the class said.
if claim="$(k get pvc "$CLAIM" --ignore-not-found -o jsonpath='capacity={.status.capacity.storage} request={.spec.resources.requests.storage} resize={.status.allocatedResourceStatuses.storage},{range .status.conditions[*]}{.type}:{.status},{end} class={.spec.storageClassName}' 2>/dev/null)"; then
	if [ -z "$claim" ]; then
		echo "CLAIM absent"
	else
		class="${claim##*class=}"
		expansion=unknown
		if [ -n "$class" ]; then
			answer="$(kubectl get storageclass "$class" -o jsonpath='{.metadata.name}={.allowVolumeExpansion}' 2>/dev/null)" || answer=""
			case "$answer" in
				"${class}=true") expansion=true ;;
				"${class}=" | "${class}=false") expansion=false ;;
			esac
		fi
		dry_run=skipped
		requested="${claim#* request=}"
		requested="${requested%% *}"
		if [ -n "$DECLARED" ] && { [ "$expansion" = unknown ] || [ "$DECLARED" != "$requested" ]; }; then
			if refusal="$(k patch pvc "$CLAIM" --dry-run=server --type merge -p "{\"spec\":{\"resources\":{\"requests\":{\"storage\":\"${DECLARED}\"}}}}" 2>&1)"; then
				dry_run=accepted
			else
				case "$refusal" in
					*"must support resize"*) dry_run=refused ;;
					*) dry_run=unknown ;;
				esac
			fi
		fi
		echo "CLAIM ${claim} expansion=${expansion} dry_run=${dry_run}"
	fi
else
	echo "CLAIM unreadable"
fi

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

	echo "Reading the state volume of ${NAMESPACE} on ${CLUSTER}: its free space and its claim."
	local answer verdict=0 line claim_line free held needed
	answer="$(aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$script" "bash $(basename "$script")" 2>&1)" || verdict=$?
	line="$(grep '^VOLUME ' <<<"$answer" | tail -n 1)" || line=""
	claim_line="$(grep '^CLAIM ' <<<"$answer" | tail -n 1)" || claim_line=""
	# What the call wrote is shown when it did not answer for the volume.
	case "$line" in
		"VOLUME absent" | "VOLUME free_mb="*) ;;
		*) [[ "$verdict" -eq 0 && -z "$answer" ]] || printf '%s\n' "$answer" ;;
	esac

	# The claim first: a resize the cluster would refuse fails the deployment
	# whatever the volume holds, and whether or not a backend is running to read.
	check_claim "$declared" "$claim_line"

	case "$line" in
		"VOLUME absent")
			echo "${NAMESPACE} has no ${BACKEND} yet, so there is no state volume to read."
			return 0
			;;
		"VOLUME free_mb="*) ;;
		*)
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
	if ((free + growth < needed)); then
		if ((growth > 0)); then
			echo >&2 "catalog-ingest.sh: the state volume of ${NAMESPACE} has ${free} MiB free and the deployment adds ${growth} MiB, and the sidecar's fetch needs ${needed} MiB."
		else
			echo >&2 "catalog-ingest.sh: the state volume of ${NAMESPACE} has ${free} MiB free, and the sidecar's fetch needs ${needed} MiB."
		fi
		if [[ "$held" != "$pin" ]]; then
			echo >&2 "Its cold storage is at ${held} and ${BRANCH} pins ${pin}, so cold storage is fetched too."
		fi
		preflight_failed "the ${ENVIRONMENT} backend's ${STATE_PATH} is too full for the sidecar to fetch the catalog onto."
	fi
	if ((growth > 0)); then
		echo "The state volume of ${NAMESPACE} has ${free} MiB free and the deployment adds ${growth} MiB; the sidecar's fetch needs ${needed} MiB."
	else
		echo "The state volume of ${NAMESPACE} has ${free} MiB free; the sidecar's fetch needs ${needed} MiB."
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
