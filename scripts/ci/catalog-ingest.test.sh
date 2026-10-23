#!/usr/bin/env bash
# Table test for catalog-ingest.sh. Run it directly: ./catalog-ingest.test.sh
#
# No case reaches a network, Azure or a cluster. The preflight cases run the
# script's real git commands against the two local repositories catalog-fixture.sh
# builds. Every case puts a stub az first on PATH that keeps the script it was
# handed and runs it, as the cluster would, with a stub kubectl whose every call is
# recorded: its `exec ... cat` prints the result file the case wrote, its
# `exec ... df` answers the free space the case set, and its `exec ... git` the
# cold-storage commit the case says the volume holds. Its `get pvc` answers the
# claim the case describes, its `get storageclass` whether the class expands, and
# its `patch ... --dry-run=server` what the cluster says of a resize. A second stub
# kubectl, on the deploying machine's PATH, answers `kustomize` with a render whose
# claim asks for the size the case set.
#
# The cluster's script runs with the stubs and with nothing else on PATH but the
# tools the image AKS gives a command carries, which has no sed, so a script that
# reaches for a tool the image lacks fails here as it does there.
#
# The subject is what each check refuses and says, that the preflight reads the
# state volume only once the mirror has answered and fails only on a reading that
# is too low, that it counts the growth a deployment applies to the volume and
# refuses a resize the cluster would refuse, and that verify waits on a sidecar
# still working and no longer than its bound.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/catalog-fixture.sh
source "${CI_DIR}/catalog-fixture.sh"
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

for tool in jq git; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "$tool is not installed here; skipping the catalog-ingest test."
		exit 0
	fi
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/scripts/lib" "$repo/bin" "$repo/cluster/bin" "$repo/sent"
	cp "$CI_DIR/lib.sh" "$CI_DIR/catalog-ingest.sh" "$repo/scripts/ci/"
	cp "$CI_DIR/../lib/env.sh" "$repo/scripts/lib/"

	# `exec ... cat <path>` prints the case's result file, or fails when the case
	# wrote none. STUB_RESULT_AFTER makes that many reads fail first, which is a
	# sidecar that has recorded nothing yet, and STUB_READ_REFUSAL makes every read
	# fail saying that. STUB_READ_HANGS makes every read end as `timeout` ends one
	# that outlasted its seconds. `exec ... df` answers STUB_FREE_KB
	# kilobytes free, or fails when the case set none; `exec ... git` answers
	# STUB_COLD_STORAGE. `get deployment` names the backend unless
	# STUB_NO_BACKEND is set. `get pvc` answers a 10Gi claim of the class
	# `managed-csi`, or the STUB_CAPACITY, STUB_REQUEST and STUB_CLASS the case set;
	# STUB_CLAIM is `absent` for no claim and `unreadable` for a read that fails.
	# STUB_RESIZE is what the claim says of a resize, as the read prints it: its
	# resize status, a comma, then each condition as `Type:Status,`.
	# `get storageclass` answers STUB_EXPANSION: `true` (the default), `false`,
	# `unset` for a class that states nothing, `unreadable` for a read that fails.
	# `patch` is the dry run: STUB_DRY_RUN is `accepted` (the default), `refused`
	# for the admission answer, anything else for another failure.
	cat >"$repo/cluster/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_KUBECTL_LOG"
[ "$1" = "-n" ] && shift 2
case "$1" in
	get)
		case "$2" in
			pvc)
				case "${STUB_CLAIM:-}" in
					absent) exit 0 ;;
					unreadable) exit 1 ;;
				esac
				printf 'capacity=%s request=%s resize=%s class=%s' "${STUB_CAPACITY-10Gi}" \
					"${STUB_REQUEST-${STUB_CAPACITY-10Gi}}" "${STUB_RESIZE-,}" "${STUB_CLASS-managed-csi}"
				;;
			storageclass)
				case "${STUB_EXPANSION:-true}" in
					true | false) printf '%s=%s' "$3" "${STUB_EXPANSION:-true}" ;;
					unset) printf '%s=' "$3" ;;
					*) exit 1 ;;
				esac
				;;
			*) [ -n "${STUB_NO_BACKEND:-}" ] || echo "deployment.apps/the-test-cabinet-backend" ;;
		esac
		;;
	patch)
		case "${STUB_DRY_RUN:-accepted}" in
			accepted) echo "persistentvolumeclaim/tcab-backend-state patched (server dry run)" ;;
			refused)
				echo 'Error from server (Forbidden): persistentvolumeclaims "tcab-backend-state" is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize' >&2
				exit 1
				;;
			*)
				echo 'Error from server (Forbidden): persistentvolumeclaims "tcab-backend-state" is forbidden: User "deploy" cannot patch resource' >&2
				exit 1
				;;
		esac
		;;
	exec)
		while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
		case "${2:-}" in
			df)
				[ -n "${STUB_FREE_KB:-}" ] || exit 1
				echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
				echo "/dev/sdc 10255636 1 ${STUB_FREE_KB} 50% /state"
				;;
			git)
				[ -n "${STUB_COLD_STORAGE:-}" ] || exit 1
				echo "$STUB_COLD_STORAGE"
				;;
			*)
				[ -z "${STUB_READ_HANGS:-}" ] || exit 124
				if [ -n "${STUB_READ_REFUSAL:-}" ]; then
					echo "$STUB_READ_REFUSAL" >&2
					exit 1
				fi
				reads="$(grep -c ' exec ' "$STUB_KUBECTL_LOG")"
				[ "$reads" -gt "${STUB_RESULT_AFTER:-0}" ] || exit 1
				cat "$STUB_RESULT" 2>/dev/null || exit 1
				;;
		esac
		;;
	logs) echo "ingest: a line of the sidecar's log" ;;
	*) echo "kubectl stub: $*" ;;
esac
STUB
	# A sleep that returns at once, so a wait runs its polls out without waiting.
	cat >"$repo/cluster/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_SLEEP_LOG"
STUB
	chmod +x "$repo/cluster/bin/kubectl" "$repo/cluster/bin/sleep"
	# What the image AKS runs a command in carries, of what a script here might
	# reach for. It has no sed.
	mkdir -p "$repo/cluster/image"
	local tool
	for tool in bash sh awk grep head tail cut tr sort cat date basename wc jq timeout; do
		ln -s "$(command -v "$tool")" "$repo/cluster/image/$tool"
	done

	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
[ -z "${STUB_AZ_BROKEN:-}" ] || { echo "ERROR: the stub refuses" >&2; exit 1; }
# A command AKS ended at its time limit, as AKS reports one.
if [ -n "${STUB_AZ_CUT_OFF:-}" ]; then
	jq -n '{exitCode: null, finishedAt: null, id: "stub", logs: null, provisioningState: "Failed", reason: "timeout", startedAt: null}'
	exit 0
fi
command=""
while [ $# -gt 0 ]; do
	case "$1" in
		--file) cp "$2" "$STUB_SENT/" ;;
		--command) command="$2" ;;
	esac
	shift
done
logs="$(cd "$STUB_SENT" && PATH="$STUB_CLUSTER_BIN:$STUB_CLUSTER_IMAGE" "$STUB_CLUSTER_IMAGE/bash" -c "$command" 2>&1)"
code=$?
jq -n --arg logs "$logs" --argjson code "$code" \
	'{exitCode: $code, id: "stub", logs: $logs, provisioningState: "Succeeded"}'
STUB
	# The deploying machine's kubectl, which renders: the overlay's claim at
	# STUB_DECLARED (10Gi), in kustomize's layout, among other objects. STUB_DECLARED
	# set to nothing is a render with no such claim, and STUB_NO_RENDER one that fails.
	cat >"$repo/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_RENDER_LOG"
[ "$1" = kustomize ] || exit 1
[ -z "${STUB_NO_RENDER:-}" ] || { echo "error: no kustomization" >&2; exit 1; }
write_manifest "${STUB_DECLARED-10Gi}"
STUB
	chmod +x "$repo/bin/az" "$repo/bin/kubectl"
	printf '%s' "$repo"
}

# A render as kustomize writes one: another claim, the state volume's claim asking
# for <size> (no such claim when <size> is empty), and a Deployment.
write_manifest() { # size
	cat <<'YAML'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: tcab-lgtm-data
  namespace: tcab-staging
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 7Gi
---
YAML
	if [ -n "$1" ]; then
		cat <<YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: tcab-backend-state
  namespace: tcab-staging
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: $1
---
YAML
	fi
	cat <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: the-test-cabinet-backend
  namespace: tcab-staging
spec:
  template:
    spec:
      containers:
      - name: backend
        resources:
          requests:
            storage: 1Gi
YAML
}
export -f write_manifest

run() { # repo [env-assignment...] -- [argument...]
	local repo="$1"
	shift
	local assignments=()
	while [ $# -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	shift
	(
		cd / || exit 1
		env -u THE_TEST_CABINET_RESOURCE_GROUP -u THE_TEST_CABINET_CLUSTER -u THE_TEST_CABINET_NAMESPACE \
			-u TCAB_INGEST_MANIFEST \
			PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			STUB_CLUSTER_BIN="$repo/cluster/bin" STUB_CLUSTER_IMAGE="$repo/cluster/image" \
			STUB_KUBECTL_LOG="$repo/kubectl.log" \
			STUB_SLEEP_LOG="$repo/sleep.log" STUB_RESULT="$repo/result" STUB_RENDER_LOG="$repo/render.log" \
			"${assignments[@]}" "$repo/scripts/ci/catalog-ingest.sh" "$@" 2>&1
	)
}

write_result() { # repo status step [message]
	printf 'status=%s\nstep=%s\nbranch=staging\ncommit=%s\n\n%s\n' "$2" "$3" "$COMMIT" "${4:-}" >"$1/result"
}

echo "--- preflight: a catalog that can be fetched ---"

fixture="$tmp/fixture"
mkdir -p "$fixture"
catalog_fixture "$fixture"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "passes" 0 "$status"
check_contains "names the branch of the environment" "staging on $CATALOG_REPO" "$out"
check_contains "names the tip and what it pins" "The tip of staging is $CATALOG_TIP; it pins cold-storage at $CATALOG_PIN" "$out"
check_contains "resolves the submodule beside the mirror" "which file://$fixture/cold-storage holds" "$out"
check_lacks "notes nothing when the tip is the commit" "Note:" "$out"
check_contains "reports the room on the state volume" \
	"The state volume of tcab-staging has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"
check_equal "reads the volume in one cluster call" 1 "$(wc -l <"$repo/az.log")"
check_contains "in the staging cluster" "--resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks" "$(cat "$repo/az.log")"
check_contains "through the ingest container of the running backend" \
	"-n tcab-staging exec deployment/the-test-cabinet-backend -c ingest -- df -Pk /state" "$(cat "$repo/kubectl.log")"
check_contains "and reads the cold-storage commit the volume holds" \
	"-- git -C /state/checkout/cold-storage rev-parse --verify --quiet HEAD" "$(cat "$repo/kubectl.log")"
check_equal "renders the environment's overlay for the size it asks of the claim" \
	"kustomize deployments/k8s/overlays/staging" "$(cat "$repo/render.log")"
check_contains "reads the claim in the same call" "-n tcab-staging get pvc tcab-backend-state" "$(cat "$repo/kubectl.log")"
check_contains "and its storage class" "get storageclass managed-csi" "$(cat "$repo/kubectl.log")"
check_lacks "says nothing of a claim that keeps its size" "grows" "$out"
check_lacks "and tries no resize" " patch " "$(cat "$repo/kubectl.log")"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight prod "$COMMIT")"
status=$?
check_equal "prod passes on its own branch" 0 "$status"
check_contains "which is master" "The tip of master is $CATALOG_TIP" "$out"
check_contains "notes a tip that is not the commit being deployed" \
	"the sidecar ingests the catalog of the branch tip, $CATALOG_TIP, not of $COMMIT" "$out"

echo "--- preflight: a state volume too full to fetch onto ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=524288 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the room and the need" \
	"the state volume of tcab-staging has 512 MiB free, and the sidecar's fetch needs 1024 MiB." "$out"
check_contains "says what that stops" "the staging backend's /state is too full for the sidecar to fetch the catalog onto." "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-staging runs what it ran." "$out"
check_lacks "and blames no cold-storage fetch" "so cold storage is fetched too" "$out"

# Room for the checkout alone is not room for a cold storage that has moved.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 \
	STUB_COLD_STORAGE=ffffffffffffffffffffffffffffffffffffffff -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a moved cold-storage pin needs room for its fetch" 1 "$status"
check_contains "which is added to the need" "has 2048 MiB free, and the sidecar's fetch needs 3584 MiB." "$out"
check_contains "and explained" \
	"Its cold storage is at ffffffffffffffffffffffffffffffffffffffff and staging pins $CATALOG_PIN, so cold storage is fetched too." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 -- preflight staging "$CATALOG_TIP")"
check_equal "as does a volume that holds no cold storage" 1 "$?"
check_contains "which is named" "Its cold storage is at none" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 TCAB_INGEST_MIN_FREE_MB=256 \
	TCAB_INGEST_COLD_STORAGE_MB=512 -- preflight staging "$CATALOG_TIP")"
check_equal "both needs are settings" 0 "$?"
check_contains "that the report names" "has 2048 MiB free; the sidecar's fetch needs 768 MiB." "$out"

echo "--- preflight: a deployment that grows the state volume ---"

# A volume with nothing free, whose claim the deployment takes from 10Gi to 50Gi.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi \
	STUB_COLD_STORAGE=ffffffffffffffffffffffffffffffffffffffff -- preflight prod "$CATALOG_TIP")"
status=$?
check_equal "a full volume passes when the deployment enlarges it" 0 "$status"
check_contains "names the growth and the class that allows it" \
	"The deployment grows the state volume of tcab-prod from 10Gi to 50Gi, which its storage class, managed-csi, allows." "$out"
check_contains "counts nine tenths of it as free space" \
	"The state volume of tcab-prod has 0 MiB free and the deployment adds 36864 MiB; the sidecar's fetch needs 3584 MiB." "$out"
check_lacks "notes nothing" "Note:" "$out"
check_equal "in one cluster call" 1 "$(wc -l <"$repo/az.log")"
check_contains "that asks the cluster about the resize in a dry run, which persists nothing" \
	" patch pvc tcab-backend-state --dry-run=server " "$(cat "$repo/kubectl.log")"

# The cluster's refusal counts even where the class reads as allowing expansion.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_DRY_RUN=refused \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
check_equal "a growth the cluster refuses in a dry run fails though the class allows expansion" 1 "$?"
check_contains "saying the cluster refused it" "and the cluster refused that resize in a dry run" "$out"

# A size equal to the one the claim has is asked of nobody.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=10Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
check_equal "an unchanged size passes" 0 "$?"
check_lacks "with no dry run" " patch " "$(cat "$repo/kubectl.log")"

# The file a deployment is about to apply is read in place of a render.
repo="$(fresh_repo)"
write_manifest 12Gi >"$repo/applied.yaml"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_COLD_STORAGE="$CATALOG_PIN" \
	TCAB_INGEST_MANIFEST="$repo/applied.yaml" -- preflight staging "$CATALOG_TIP")"
check_equal "the manifest a deployment names is the size it asks" 0 "$?"
check_contains "which is the one compared" "from 10Gi to 12Gi" "$out"
check_contains "and counted" "has 0 MiB free and the deployment adds 1843 MiB; the sidecar's fetch needs 1024 MiB." "$out"
check_equal "with no render of its own" "" "$(cat "$repo/render.log" 2>/dev/null)"

# Growth that is not room enough still fails, and says what it counted.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=11Gi \
	-- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "growth short of the need fails" 1 "$status"
check_contains "naming the room, the growth and the need" \
	"the state volume of tcab-staging has 0 MiB free and the deployment adds 921 MiB, and the sidecar's fetch needs 3584 MiB." "$out"
check_contains "and that nothing was applied" "Nothing was applied: tcab-staging runs what it ran." "$out"

# An earlier apply resized the claim and the cluster is still carrying it out.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
	STUB_RESIZE=,Resizing:True, \
	STUB_EXPANSION=false STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a resize under way is counted" 0 "$?"
check_contains "and named" "holds 10Gi and its claim already requests 50Gi: a resize is under way." "$out"
check_contains "with its growth" "the deployment adds 36864 MiB" "$out"
check_lacks "and no dry run, the size being the one requested" " patch " "$(cat "$repo/kubectl.log")"

for resize in ",FileSystemResizePending:True," "ControllerResizeInProgress," "NodeResizePending," \
	"NodeResizeInProgress,Resizing:True,FileSystemResizePending:True,"; do
	repo="$(fresh_repo)"
	out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
		STUB_RESIZE="$resize" STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
	check_equal "so is one the claim reports as ${resize}" 0 "$?"
done

echo "--- preflight: a resize that was asked for and is not happening ---"

# The claim requests the size and the cluster says nothing of carrying it out: the
# volume is as full as it reads, and the deployment fails before it applies.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
status=$?
check_equal "a resize the claim reports nothing of counts no growth, and a full volume fails" 1 "$status"
check_contains "with a note of what the claim says" \
	"Note: the claim tcab-backend-state of tcab-prod requests 50Gi and its volume holds 10Gi, and the claim reports no resize under way. No growth is counted, and the volume is judged by the free space it has." "$out"
check_contains "and the volume as it reads" "the state volume of tcab-prod has 0 MiB free, and the sidecar's fetch needs 1024 MiB." "$out"
check_contains "with nothing applied" "Nothing was applied: tcab-prod runs what it ran." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
check_equal "the same claim on a volume with room passes" 0 "$?"
check_contains "on the room it has" "has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"

# A condition the claim carries as false is not a resize under way.
for resize in ",FileSystemResizePending:False," ",Resizing:False,"; do
	repo="$(fresh_repo)"
	out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
		STUB_RESIZE="$resize" STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
	check_equal "a claim that reports ${resize} counts no growth" 1 "$?"
	check_contains "and says no resize is under way" "the claim reports no resize under way" "$out"
done

for resize in "ControllerResizeFailed," "NodeResizeFailed,Resizing:True," "ControllerResizeInfeasible," "NodeResizeInfeasible,"; do
	repo="$(fresh_repo)"
	out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_REQUEST=50Gi \
		STUB_RESIZE="$resize" STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
	check_equal "a resize reported as ${resize} counts no growth" 1 "$?"
	check_contains "and is named as failed" "the cluster reports that the resize failed (${resize%%,*})" "$out"
done

echo "--- preflight: a resize the cluster would refuse ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_EXPANSION=false \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
status=$?
check_equal "growth on a class that cannot expand fails" 1 "$status"
check_contains "naming the sizes, the class and the field" \
	"the deployment grows tcab-backend-state from 10Gi to 50Gi, and the claim's storage class, managed-csi, does not allow volume expansion (allowVolumeExpansion)." "$out"
check_contains "says what it stops" "the prod deployment grows a state volume whose storage class cannot expand it." "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-prod runs what it ran." "$out"
check_contains "and where the size is set" "deployments/k8s/components/postgres/deployment-backend.yaml" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_EXPANSION=unset \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "as does a class that states no allowVolumeExpansion" 1 "$?"
check_contains "for the same reason" "does not allow volume expansion" "$out"

# A caller that may not read the class asks the cluster with a dry run.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_EXPANSION=unreadable \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a class that cannot be read passes when the cluster accepts the resize" 0 "$?"
check_contains "saying how it knows" \
	"from 10Gi to 50Gi, which the cluster accepted in a dry run (its storage class, managed-csi, could not be read)." "$out"
check_contains "asked with a server-side dry run of the size" \
	'-n tcab-staging patch pvc tcab-backend-state --dry-run=server --type merge -p {"spec":{"resources":{"requests":{"storage":"50Gi"}}}}' \
	"$(cat "$repo/kubectl.log")"
check_contains "and counts the growth" "the deployment adds 36864 MiB" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_EXPANSION=unreadable \
	STUB_DRY_RUN=refused STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a dry run the cluster refuses for the class fails" 1 "$status"
check_contains "saying the cluster refused it" \
	"and the cluster refused that resize in a dry run: the claim's storage class, managed-csi, does not support it." "$out"
check_contains "with nothing applied" "Nothing was applied: tcab-staging runs what it ran." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=50Gi STUB_EXPANSION=unreadable \
	STUB_DRY_RUN=denied STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a class nothing answers for is noted and passes" 0 "$?"
check_contains "with the note" \
	"Note: whether the claim's storage class, managed-csi, allows expansion could not be read, so the growth is counted without that check." "$out"
check_contains "and the growth counted" "the deployment adds 36864 MiB" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=5Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
status=$?
check_equal "a smaller size fails" 1 "$status"
check_contains "naming both sizes" \
	"the deployment asks for 5Gi of tcab-backend-state, and the claim in tcab-prod holds 10Gi and requests 10Gi." "$out"
check_contains "and why" "Kubernetes refuses to shrink a volume" "$out"
check_contains "says what it stops" "the prod deployment would shrink the backend's state volume." "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-prod runs what it ran." "$out"

# A claim an earlier apply asked more of, which the volume has not reached: the
# deployment lowers that request, and the cluster's dry run decides.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=0 STUB_DECLARED=20Gi STUB_REQUEST=50Gi \
	STUB_RESIZE=ControllerResizeFailed, STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a size between the volume's and the claim's request passes when the cluster accepts it" 0 "$?"
check_contains "saying what it lowers" \
	"The deployment lowers the size tcab-backend-state requests in tcab-staging from 50Gi to 20Gi, above the 10Gi the volume holds, which the cluster accepted in a dry run." "$out"
check_contains "asked with a dry run of that size, though the class answered" \
	'patch pvc tcab-backend-state --dry-run=server --type merge -p {"spec":{"resources":{"requests":{"storage":"20Gi"}}}}' \
	"$(cat "$repo/kubectl.log")"
check_contains "and counts the growth to it" "the deployment adds 9216 MiB" "$out"

for dry_run in refused denied; do
	repo="$(fresh_repo)"
	out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=20Gi STUB_REQUEST=50Gi \
		STUB_DRY_RUN="$dry_run" STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
	check_equal "and fails when the dry run is ${dry_run}" 1 "$?"
	check_contains "naming what it holds and requests" "holds 10Gi and requests 50Gi, and the cluster did not accept lowering that request in a dry run." "$out"
	check_contains "with nothing applied" "Nothing was applied: tcab-staging runs what it ran." "$out"
done

# Under what the volume holds, no dry run is needed to know.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=5Gi STUB_REQUEST=50Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a size under the volume's fails whatever the claim requests" 1 "$?"
check_contains "as a shrink" "would shrink the backend's state volume" "$out"

# A checkout from before the volume was grown declares the old size.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=10Gi STUB_CAPACITY=50Gi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight prod "$CATALOG_TIP")"
check_equal "an older checkout's smaller size is refused" 1 "$?"
check_contains "and the reader told why an older checkout cannot be deployed" \
	"A checkout from" "$out"

# The claim is judged whether or not a backend is running to read the volume of.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_DECLARED=5Gi -- preflight staging "$CATALOG_TIP")"
check_equal "a shrink fails with a backend that cannot be read" 1 "$?"
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_NO_BACKEND=1 STUB_DECLARED=50Gi STUB_EXPANSION=false \
	-- preflight staging "$CATALOG_TIP")"
check_equal "and growth a class cannot give fails with no backend at all" 1 "$?"
check_lacks "having read no volume" " exec " "$(cat "$repo/kubectl.log")"

echo "--- preflight: a size or a claim that cannot be compared ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_NO_RENDER=1 \
	STUB_COLD_STORAGE="$CATALOG_PIN" STUB_CAPACITY=50Gi -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "an overlay that does not render passes" 0 "$status"
check_contains "with a note" \
	"Note: the render to be applied states no size for tcab-backend-state, so it was not compared with the claim in tcab-staging." "$out"
check_contains "and the free space checked as it was read" "has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED= \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a render with no such claim passes" 0 "$?"
check_contains "with the same note" "states no size for tcab-backend-state" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=524288 STUB_DECLARED=50Gi STUB_CLAIM=unreadable \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
status=$?
check_contains "a claim that cannot be read is noted" \
	"Note: the tcab-backend-state claim of tcab-staging could not be read, so the 50Gi the deployment asks for was not compared with it." "$out"
check_equal "and no growth is counted for it" 1 "$status"
check_contains "so the volume is judged as it was read" "has 512 MiB free, and the sidecar's fetch needs 1024 MiB." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_CLAIM=absent \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a namespace with no claim yet passes" 0 "$?"
check_contains "saying the deployment creates it" "tcab-staging has no tcab-backend-state claim yet; the deployment creates it at 50Gi." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=1.5Ti \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a size in a notation it does not read passes" 0 "$?"
check_contains "with a note naming it" "1.5Ti, is in a notation this check does not read" "$out"
check_lacks "and is sent to no dry run" " patch " "$(cat "$repo/kubectl.log")"

# A claim that is not bound holds nothing, so there is no growth to count.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=50Gi STUB_CAPACITY= \
	STUB_REQUEST=10Gi STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "a claim with no capacity yet passes" 0 "$?"
check_contains "with no growth counted" "has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"

# Sizes are compared as quantities, whatever unit each side is written in.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_DECLARED=10240Mi \
	STUB_COLD_STORAGE="$CATALOG_PIN" -- preflight staging "$CATALOG_TIP")"
check_equal "the same size in another unit is the same size" 0 "$?"
check_lacks "which grows nothing" "grows" "$out"
check_contains "and adds nothing" "has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"

echo "--- preflight: a state volume that cannot be read ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_NO_BACKEND=1 -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "an environment with no backend yet passes" 0 "$status"
check_contains "saying there is no volume" "tcab-staging has no the-test-cabinet-backend yet, so there is no state volume to read." "$out"
check_lacks "and execs into nothing" " exec " "$(cat "$repo/kubectl.log")"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a backend that cannot be read passes" 0 "$status"
check_contains "with a note" "Note: the state volume of tcab-staging could not be read, so its free space was not checked." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_AZ_BROKEN=1 -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a cluster that cannot be reached passes" 0 "$status"
check_contains "with the same note" "could not be read, so its free space was not checked." "$out"
check_contains "and what az said" "ERROR: the stub refuses" "$out"

echo "--- preflight: a mirror that cannot be reached ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="file://$tmp/no-such-mirror.git" -- preflight staging "$COMMIT")"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the branch could not be read" "has no branch staging, or could not be reached" "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-staging runs what it ran." "$out"
check_contains "names the command that checks again" "scripts/ci/catalog-ingest.sh preflight staging" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- preflight: a pinned cold-storage commit nothing holds ---"

catalog_fixture_unpin "$fixture"
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the pin and where it was looked for" \
	"pins cold-storage at $CATALOG_PIN, which could not be fetched from file://$fixture/cold-storage" "$out"
check_contains "says nothing was applied" "Nothing was applied" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- verify: a sidecar that ingested ---"

repo="$(fresh_repo)"
write_result "$repo" ok ingest "The backend ingested staging at $COMMIT."
out="$(run "$repo" -- verify staging)"
status=$?
check_equal "passes" 0 "$status"
check_contains "reports the ingest" "The staging backend ingested the tip of staging." "$out"
check_contains "prints the sidecar's result" "The backend ingested staging at $COMMIT." "$out"
invocation="$(sed -n 1p "$repo/az.log")"
check_contains "in the staging cluster" "--resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks" "$invocation"
check_equal "reads the ingest container's result file, once" \
	"-n tcab-staging exec deployment/the-test-cabinet-backend -c ingest -- cat /tmp/ingest-result" "$(cat "$repo/kubectl.log")"
check_equal "without waiting" "" "$(cat "$repo/sleep.log" 2>/dev/null)"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" THE_TEST_CABINET_RESOURCE_GROUP=case-rg THE_TEST_CABINET_CLUSTER=case-aks \
	THE_TEST_CABINET_NAMESPACE=case-ns -- verify prod)"
check_contains "the deployment's own cluster wins over the environment's" "--resource-group case-rg --name case-aks" "$(sed -n 1p "$repo/az.log")"
check_contains "and its namespace" "-n case-ns exec" "$(cat "$repo/kubectl.log")"

echo "--- verify: a sidecar that failed ---"

repo="$(fresh_repo)"
write_result "$repo" failed cold-storage "The cold-storage submodule could not be fetched at the commit staging pins.
Free space on /state: 0 free of 9.8G (100% used).
fatal: write error: No space left on device"
out="$(run "$repo" -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the failing step" "INGEST failed at step 'cold-storage'" "$out"
check_contains "prints the sidecar's message" "The cold-storage submodule could not be fetched" "$out"
check_contains "with the free space it reported" "Free space on /state: 0 free of 9.8G (100% used)." "$out"
check_contains "and the command's own error" "No space left on device" "$out"
check_contains "says nothing was rolled back" "Nothing was ingested and nothing was rolled back" "$out"
check_contains "names the command that ingests once it is fixed" "tcab ingest --env staging" "$out"
check_equal "reaches the cluster once" 1 "$(wc -l <"$repo/az.log")"
check_lacks "undoes nothing" "rollout undo" "$(cat "$repo/kubectl.log")"

echo "--- verify: a sidecar still working ---"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" STUB_RESULT_AFTER=3 -- verify staging)"
status=$?
check_equal "passes once the result lands" 0 "$status"
check_equal "after reading it four times" 4 "$(grep -c ' exec ' "$repo/kubectl.log")"
check_equal "five seconds apart" "5
5
5" "$(cat "$repo/sleep.log")"

repo="$(fresh_repo)"
write_result "$repo" running cold-storage
out="$(run "$repo" TCAB_INGEST_WAIT_SECONDS=20 TCAB_INGEST_POLL_SECONDS=10 -- verify staging)"
status=$?
check_equal "fails when the wait runs out" 1 "$status"
check_contains "names the step it was still at" "INGEST unfinished: still at step 'cold-storage' after 20s" "$out"
check_equal "having waited no longer than the bound" "10
10" "$(cat "$repo/sleep.log")"
check_contains "prints the sidecar's log" "ingest: a line of the sidecar's log" "$out"
check_contains "names the command that reads it again" "scripts/ci/catalog-ingest.sh verify staging" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_INGEST_WAIT_SECONDS=0 -- verify staging)"
status=$?
check_equal "a container that recorded nothing fails" 1 "$status"
check_contains "saying so" "INGEST unknown: the ingest container of the-test-cabinet-backend recorded no result in 0s" "$out"

check_contains "says no outcome was recorded" "recorded no outcome in 0s" "$out"
check_lacks "and does not say the backend did not ingest" "did not ingest" "$out"

echo "--- verify: a wait longer than one call into the cluster ---"

repo="$(fresh_repo)"
write_result "$repo" running cold-storage
out="$(run "$repo" TCAB_INGEST_WAIT_SECONDS=20 TCAB_INGEST_POLL_SECONDS=10 TCAB_INGEST_CALL_SECONDS=10 -- verify staging)"
status=$?
check_equal "fails when the wait runs out" 1 "$status"
check_equal "having spent it in two calls" 2 "$(wc -l <"$repo/az.log")"
check_contains "the second told what the first waited" "catalog-ingest-verify.sh 10 10" "$(sed -n 2p "$repo/az.log")"
check_equal "each waiting its share" "10
10" "$(cat "$repo/sleep.log")"
check_contains "says the first call ended with the sidecar working" \
	"INGEST unfinished: still at step 'cold-storage' after 10s; reading again." "$out"
check_contains "and names the whole wait at the end" "INGEST unfinished: still at step 'cold-storage' after 20s" "$out"
check_equal "printing the sidecar's log once" 1 "$(grep -c "a line of the sidecar's log" <<<"$out")"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" STUB_RESULT_AFTER=3 TCAB_INGEST_WAIT_SECONDS=30 TCAB_INGEST_POLL_SECONDS=10 TCAB_INGEST_CALL_SECONDS=10 \
	-- verify staging)"
check_equal "a result that lands in a later call passes" 0 "$?"
check_equal "in the call that read it" 2 "$(wc -l <"$repo/az.log")"

echo "--- verify: a result that cannot be read ---"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" STUB_READ_REFUSAL='Error from server (Forbidden): cannot create resource "pods/exec"' \
	TCAB_INGEST_WAIT_SECONDS=10 -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "says no result was read" "INGEST unknown: the ingest container of the-test-cabinet-backend recorded no result in 10s" "$out"
check_contains "and what the read answered" \
	'The last read of /tmp/ingest-result answered:
Error from server (Forbidden): cannot create resource "pods/exec"' "$out"
check_lacks "and does not say the backend did not ingest" "did not ingest" "$out"

# A read that hangs is ended, and the seconds it was given count as waited.
repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" STUB_READ_HANGS=1 TCAB_INGEST_WAIT_SECONDS=60 TCAB_INGEST_READ_SECONDS=25 -- verify staging)"
check_equal "a read that never answers fails" 1 "$?"
check_contains "saying how long each was given" "the read did not answer in 25s" "$out"
check_equal "after as many reads as the wait holds" 3 "$(grep -c ' exec ' "$repo/kubectl.log")"

echo "--- verify: the image AKS runs a command in ---"

repo="$(fresh_repo)"
check_equal "the cluster's script finds no sed" "" \
	"$(PATH="$repo/cluster/bin:$repo/cluster/image" "$repo/cluster/image/bash" -c 'command -v sed')"

echo "--- verify: a command AKS ended at its time limit ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_CUT_OFF=1 -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "says AKS ended the command" "AKS ended the command at its time limit, ten minutes, and kept none of what it wrote." "$out"
check_contains "and that the result is not known" "so the result is not known" "$out"
check_lacks "does not say the command never ran" "never ran" "$out"
check_lacks "and does not say the sidecar failed" "did not ingest" "$out"
check_equal "without calling again" 1 "$(wc -l <"$repo/az.log")"

echo "--- verify: a cluster that cannot be reached ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_BROKEN=1 -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the result could not be read" "the ingest sidecar's result could not be read" "$out"
check_lacks "and does not say the sidecar failed" "did not ingest" "$out"
check_contains "says the command never ran" "reported no exit code, so the command never ran" "$out"

echo "--- refusals ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- verify local)"
status=$?
check_equal "another environment fails" 1 "$status"
check_contains "naming it" "unknown environment 'local' (expected staging or prod)" "$out"
out="$(run "$repo" -- ingest staging)"
status=$?
check_equal "another mode fails" 1 "$status"
check_contains "with the usage" "usage: scripts/ci/catalog-ingest.sh preflight <staging|prod> [<commit>]" "$out"
out="$(run "$repo" -- verify)"
check_equal "no environment fails" 1 "$?"
check_equal "and no refusal reaches a cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "catalog-ingest.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
