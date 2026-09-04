# shellcheck shell=bash
# The one `curl` the toolchain installers under scripts/ci/ fetch a large file with.
#
# Sourced (not executed), and deliberately NOT part of scripts/ci/lib.sh: that file `cd`s to
# the repository root when it is sourced, and these installers are also run from inside
# containers/gg-toolchains/Dockerfile, which COPYs each of them into a `/tmp/gg-<arm>` tree
# that is not a checkout. A helper with a side effect could not be shared by both callers, so
# this one has none.
#
# WHY IT EXISTS. Between them the eight installers pull down roughly 3 GB — the Swift
# toolchain alone is 1.05 GB, wasi-sdk ~650 MB, the .NET SDK ~770 MB — and every one of them
# fetched it with a bare `curl -sSfL … -o file`: one attempt, no resume, into a `mktemp -d`
# that is deleted on the way out. On a link that can move about 1.5 MB/s that makes the Swift
# fetch a twelve-minute transfer that has to survive end to end, and when it does not the
# failure is
#
#   curl: (18) transfer closed with 275579118 bytes remaining to read
#
# — the server or something between it and here closed the connection early — after which the
# 780 MB already on disk is thrown away, the `docker build` step fails, and the next attempt
# starts again from zero. That is not a hypothetical: it took `make local-rebuild` down twice
# in a row on the same machine, and the second attempt paid for the first attempt's bytes
# again before it did.
#
# So a fetch here does three things a bare `curl` does not:
#
#   1. RESUMES. The bytes are written to their final destination and `-C -` continues from
#      whatever is already there, so a dropped connection costs the remainder of the transfer
#      rather than the whole of it.
#   2. RETRIES, in-process, with a short wait between attempts. A truncated transfer is the
#      single most likely thing to go wrong on a multi-hundred-megabyte download, and it is
#      also the thing most likely to work on the next try — which is precisely the shape of
#      failure a build should absorb rather than surface.
#   3. KEEPS THE PARTIAL FILE when it does give up, under a version-stamped name in a
#      directory the image builds mount a cache over (`gg_fetch_dir`, below). So the run
#      *after* a failed one resumes too, instead of restarting a twelve-minute download —
#      which is the difference between an interrupted install being an inconvenience and it
#      being unaffordable on a slow link.
#
# It also verifies what it got. `curl -f` reports a truncated body as exit 18, but a proxy
# that closes cleanly at a chunk boundary can produce a short file with a zero exit, and a
# tarball that unpacks 90% of the way through fails hundreds of lines later inside a prune
# step, naming a file rather than the download. The length the server advertised is asked for
# up front and the finished file is measured against it, so a short download fails as a short
# download.

# How many times one fetch is attempted before it is called a failure, and the seconds between
# attempts. Overridable so a machine on a genuinely broken link can stop sooner rather than
# spending six attempts finding out.
GG_FETCH_ATTEMPTS="${GG_FETCH_ATTEMPTS:-6}"
GG_FETCH_DELAY="${GG_FETCH_DELAY:-5}"

# The directory large downloads are staged in, which is NOT `mktemp -d`.
#
# `$HOME/.cache` is where the image builds already mount a BuildKit cache over (see the
# `gg-toolchain-downloads` mount in deployments/images/services.Dockerfile), so a partial file
# left here by a failed build is still here for the next one, and a developer's machine gets
# the same behaviour for free out of the same path. Every installer deletes its own staged
# archives once the install they feed has verified itself, so a build that succeeds leaves
# nothing behind and an image layer never carries one.
gg_fetch_dir() {
	echo "${TCAB_DOWNLOAD_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/tcab/downloads}"
}

# The size of a local file, in bytes. `wc -c` rather than `stat`, whose flags differ between
# GNU and BSD and whose GNU form these scripts cannot assume on a developer's macOS machine.
gg_fetch_size() {
	if [ -f "$1" ]; then
		wc -c <"$1" | tr -d ' '
	else
		echo 0
	fi
}

# What the server says the resource is, in bytes, or nothing at all.
#
# Nothing at all is a perfectly good answer — a server may refuse HEAD, or answer a redirect
# chain without a length — and the caller treats it as "cannot verify" rather than as a
# failure. The LAST `content-length` in the response is the one that counts: `-L` prints the
# headers of every hop, and the redirect's own is not the file's.
#
# The HEAD is run on its own line and its failure swallowed, rather than piped straight into
# `awk`. Every caller is a `set -euo pipefail` script, and under `pipefail` a refused HEAD
# would fail the whole pipeline, fail the command substitution it is read through, and take
# the install down — turning "I could not verify the length" into "the install stopped", which
# is the opposite of what this function is for.
gg_fetch_length() {
	local headers
	headers="$(curl -sSfIL --connect-timeout 20 --max-time 60 "$1" 2>/dev/null)" || return 0
	printf '%s\n' "$headers" |
		tr -d '\r' |
		awk 'tolower($1) == "content-length:" { n = $2 } END { if (n) print n }'
}

# gg_fetch <url> <destination>
#
# Fetches <url> to <destination>, resuming and retrying, and leaves the partial file in place
# when it gives up. A destination that is already the advertised length is left alone, which
# is what makes calling this twice in one script — or once per re-run of a failed install —
# cost nothing.
gg_fetch() {
	local url="$1" dest="$2" expected attempt size status
	mkdir -p "$(dirname "$dest")"
	expected="$(gg_fetch_length "$url")"

	if [ -n "$expected" ] && [ "$(gg_fetch_size "$dest")" = "$expected" ]; then
		echo "  have $(basename "$dest") ($expected bytes, already fetched)"
		return 0
	fi

	for attempt in $(seq 1 "$GG_FETCH_ATTEMPTS"); do
		size="$(gg_fetch_size "$dest")"
		if [ "$attempt" -eq 1 ]; then
			if [ "$size" = 0 ]; then
				size=""
			fi
			echo "  fetching $(basename "$dest")${expected:+ ($expected bytes)}${size:+, resuming at byte $size}"
		else
			echo "  attempt $attempt/$GG_FETCH_ATTEMPTS, resuming at byte $size" >&2
			sleep "$GG_FETCH_DELAY"
		fi

		# `--speed-limit`/`--speed-time` turn a connection that has gone quiet into a
		# failed attempt after a minute instead of a build that hangs until someone
		# notices. The threshold is 4 KB/s, which a transfer that is merely slow — this
		# is a fetch that legitimately takes ten minutes on some links — never trips.
		status=0
		curl -sSfL --connect-timeout 20 --speed-limit 4096 --speed-time 60 \
			-C - "$url" -o "$dest" || status=$?

		if [ "$status" -eq 0 ]; then
			size="$(gg_fetch_size "$dest")"
			if [ -z "$expected" ] || [ "$size" = "$expected" ]; then
				return 0
			fi
			# A clean exit and a short file. Something between here and the server
			# ended the body early; the next attempt resumes from where it stopped.
			echo "  short: $size of $expected bytes" >&2
			continue
		fi

		# 33 is "server does not support resume", 36 "bad download resume", and 22 is
		# `-f` on an HTTP error — which for a ranged request is usually 416, the server
		# refusing a range that starts at or past the end of a file we already have in
		# full. All three mean the partial on disk cannot be continued, so it goes and
		# the next attempt starts from zero rather than repeating the same refusal.
		case "$status" in
		22 | 33 | 36)
			echo "  cannot resume (curl exit $status); starting over" >&2
			rm -f "$dest"
			;;
		esac
	done

	echo "error: could not fetch $url after $GG_FETCH_ATTEMPTS attempts." >&2
	size="$(gg_fetch_size "$dest")"
	if [ "$size" != 0 ]; then
		echo "       $size bytes are kept at $dest; re-running resumes from there." >&2
	fi
	return 1
}
