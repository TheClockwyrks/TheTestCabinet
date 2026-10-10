# shellcheck shell=bash
# The project's shared helpers for its own CI scripts under scripts/ci/.
#
# This directory holds two kinds of script. The workspace template renders some
# of them (the gates' pipeline plumbing, deploy.sh, build-image.sh, ci-image.sh
# and the rest), and those source the template's lib.sh beside this file. The
# project's own scripts, which run its own pipeline jobs and stages
# (.azure/project/, .azure/tcab/, azure-pipelines-release.yml), source this
# file; scripts/ci/README.md lists both. It is named for the project so a
# template update never renders over it, and a script that needs the
# template's helpers too (`build_arg`, `aks_invoke`) sources both.
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

# ci_resolve_url <base> <url>: the address git clones a submodule from when
# `.gitmodules` names it <url> in a superproject cloned from <base>. An absolute
# URL is returned as it is. Each leading `../` drops one path component of
# <base>, which may be a URL, an scp-style address, or a local path.
ci_resolve_url() {
	local base="$1" url="$2"
	if [[ "$url" != ./* && "$url" != ../* ]]; then
		printf '%s\n' "$url"
		return
	fi
	base="${base%/}"
	while :; do
		case "$url" in
			./*) url="${url#./}" ;;
			../*)
				url="${url#../}"
				if [[ "$base" == */* ]]; then
					base="${base%/*}"
				elif [[ "$base" == *:* ]]; then
					base="${base%:*}:"
				else
					echo "cannot resolve a relative URL against '$1'" >&2
					return 1
				fi
				;;
			*) break ;;
		esac
	done
	if [[ "$base" == *: ]]; then
		printf '%s%s\n' "$base" "$url"
	else
		printf '%s/%s\n' "$base" "$url"
	fi
}
