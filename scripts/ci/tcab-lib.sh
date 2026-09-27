# shellcheck shell=bash
# Shared helpers for the CI scripts under scripts/ci/.
#
# Sourced (not executed) by each script. It resolves the repository root from
# this file's own location and changes into it, so every CI script behaves
# identically regardless of the directory it is invoked from. The Azure pipeline
# calls these scripts, and a developer reproduces any of its jobs by running the
# same script locally.

# Resolve the repo root two levels up from scripts/ci/ and work from there.
CI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CI_LIB_DIR/../.." && pwd)"
readonly CI_LIB_DIR REPO_ROOT
cd "$REPO_ROOT" || exit 1

# Print a labelled step header so the CI logs are easy to scan.
log() {
	printf '\n\033[1;34m==> %s\033[0m\n' "$*"
}

# The Test Cabinet's Azure Container Registry. The pipeline pushes every service and
# run-container image here, and the deploy points both clusters at it.
readonly CI_REGISTRY="testcabinet.azurecr.io"
export CI_REGISTRY

# The architecture name an image is published under for this machine: amd64 or arm64.
ci_arch() {
	case "$(uname -m)" in
		x86_64 | amd64) echo amd64 ;;
		aarch64 | arm64) echo arm64 ;;
		*)
			echo "unsupported architecture '$(uname -m)'" >&2
			return 1
			;;
	esac
}

# Reads a rendered manifest stream (`kubectl kustomize` output) on stdin and prints one
# line per object: `<kind> <namespace> <name>`, with `-` for an absent namespace.
# kustomize writes every document in the same canonical shape, which is what lets this
# read it without a YAML parser.
ci_manifest_index() {
	awk '
		function unquote(v) { gsub(/^["\047]|["\047]$/, "", v); return v }
		function flush() {
			if (kind != "") print kind, (ns == "" ? "-" : ns), name
			kind = ""; ns = ""; name = ""; top = ""
		}
		/^---/ { flush(); next }
		/^[A-Za-z]/ { top = $1; sub(/:$/, "", top) }
		top == "kind" && /^kind: / { kind = unquote($2) }
		top == "metadata" && /^  name: / { name = unquote($2) }
		top == "metadata" && /^  namespace: / { ns = unquote($2) }
		END { flush() }
	'
}

# The kinds that exist outside any namespace. A manifest the pipeline applies may hold
# none of them, because the deploy identity's role is scoped to one namespace.
readonly CI_CLUSTER_SCOPED_KINDS=(
	APIService CSIDriver CSINode CertificateSigningRequest ClusterIssuer ClusterRole
	ClusterRoleBinding CustomResourceDefinition FlowSchema IngressClass
	MutatingAdmissionPolicy MutatingWebhookConfiguration Namespace Node PersistentVolume
	PriorityClass PriorityLevelConfiguration RuntimeClass StorageClass
	ValidatingAdmissionPolicy ValidatingAdmissionPolicyBinding
	ValidatingWebhookConfiguration VolumeAttachment
)

# Reads a rendered manifest stream on stdin and fails, naming each offender, unless
# every object is of a namespaced kind and sits in namespace $1.
ci_assert_namespaced() {
	local namespace="$1" kind ns name bad=0 scoped
	while read -r kind ns name; do
		for scoped in "${CI_CLUSTER_SCOPED_KINDS[@]}"; do
			if [[ "$kind" == "$scoped" ]]; then
				echo "cluster-scoped: ${kind}/${name}" >&2
				bad=1
				continue 2
			fi
		done
		if [[ "$ns" != "$namespace" ]]; then
			echo "outside ${namespace}: ${kind}/${name} (namespace ${ns})" >&2
			bad=1
		fi
	done < <(ci_manifest_index)
	return "$bad"
}
