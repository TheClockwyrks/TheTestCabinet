#!/usr/bin/env bash
# Installs the NVIDIA CUDA toolkit from NVIDIA's own apt repository.
#
# Off by default, because nothing in this project compiles CUDA. The GPU itself is
# reached through the container runtime rather than through anything installed
# here (see docker-compose.nvidia.yml), and the CUDA wheels PyTorch and the
# other Python model runtimes publish carry the runtime libraries they need, so
# a workload that only drives an existing model wants no `nvcc` at all.
#
# What wants one is a workload that compiles CUDA sources itself, an inference
# engine built from source being the usual case. Turn the toolkit on for that
# with the INSTALL_CUDA build arg, on a host whose GPU it can actually use; it
# is several GB and several minutes of build time otherwise.
#
# Ubuntu's own `nvidia-cuda-toolkit` package is CUDA 12.4, which predates the
# Blackwell architecture (`sm_120`), so the toolkit comes from NVIDIA's
# repository instead. CUDA_MAJOR_MINOR below pins the release it installs. Any
# CUDA 13.x toolkit runs against any driver supporting CUDA 13.0 or later, so
# the toolkit and the host driver do not have to match exactly.
set -euo pipefail

readonly CUDA_MAJOR_MINOR="${CUDA_MAJOR_MINOR:-13-3}"
readonly CUDA_KEYRING_VERSION="${CUDA_KEYRING_VERSION:-1.1-1}"

# Unset means skip, so the several GB is spent only where someone asked for it.
# The value is lowercased because a compose implementation may hand a YAML
# boolean over as `True`/`False` (podman-compose renders Python's spelling of
# it), and an unrecognized value is an error rather than a silent default: both
# mistakes it could hide — installing several GB unasked, or quietly shipping an
# image with no `nvcc` — surface a long way from here.
install_cuda="$(printf '%s' "${INSTALL_CUDA:-false}" | tr '[:upper:]' '[:lower:]')"
readonly install_cuda
case "$install_cuda" in
	true | 1 | yes) ;;
	false | 0 | no)
		echo "cuda.sh: INSTALL_CUDA=${INSTALL_CUDA:-} — skipping the CUDA toolkit."
		exit 0
		;;
	*)
		echo "cuda.sh: INSTALL_CUDA must be true or false, got '${INSTALL_CUDA:-}'" >&2
		exit 1
		;;
esac

# NVIDIA names its repositories after the Ubuntu release with the dot removed,
# so 26.04 is `ubuntu2604`.
distro="ubuntu$(. /etc/os-release && echo "${VERSION_ID//./}")"
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64) repo_arch="x86_64" ;;
	arm64) repo_arch="sbsa" ;;
	*)
		echo "cuda.sh: no CUDA repository for architecture '$arch'" >&2
		exit 1
		;;
esac
readonly repo="https://developer.download.nvidia.com/compute/cuda/repos/${distro}/${repo_arch}"

# The keyring package installs both NVIDIA's signing key and the apt source
# entry that uses it, so there is no manually written sources.list.d file to
# keep in step with it.
keyring="$(mktemp --suffix=.deb)"
curl -fsSL -o "$keyring" "${repo}/cuda-keyring_${CUDA_KEYRING_VERSION}_all.deb"
DEBIAN_FRONTEND=noninteractive dpkg -i "$keyring"
rm -f "$keyring"

apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y "cuda-toolkit-${CUDA_MAJOR_MINOR}"

# The toolkit installs under /usr/local/cuda-<version> with a /usr/local/cuda
# symlink, neither of which is on anyone's PATH. Point the standard variables at
# the symlink so a toolkit upgrade needs no edit here.
cat >/etc/profile.d/cuda.sh <<'EOF'
# Added by .devcontainer/system/cuda.sh.
export CUDA_HOME=/usr/local/cuda
export PATH="$CUDA_HOME/bin:$PATH"
EOF
chmod 0644 /etc/profile.d/cuda.sh

# `ld` finds the CUDA libraries through the linker cache rather than through
# LD_LIBRARY_PATH, so a binary built here runs without any environment set.
echo "/usr/local/cuda/lib64" >/etc/ld.so.conf.d/cuda.conf
ldconfig

echo "Installed CUDA toolkit ${CUDA_MAJOR_MINOR} from ${repo}"
