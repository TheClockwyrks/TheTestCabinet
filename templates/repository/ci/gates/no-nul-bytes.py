"""Refuse a NUL byte in a file that is not a declared binary format.

A raw NUL makes every tool that reads text decide the file is binary. `grep`
and `rg` then report ZERO matches in it rather than an error, so such a file is
not merely awkward to search: it is silently invisible to every search anyone
runs. Editing tools are no better: a file whose bytes are read as binary is one
no string-matching edit can reliably touch, so the byte tends to survive every
attempt to remove it by hand.

The byte gets in by accident rather than on purpose. An agent harness writing
source files has been observed emitting a literal NUL where an escape like
`"\\0"` was meant, and the result goes unnoticed precisely because nothing that
reads the repository as text can see the file at all.

Why this asks .gitattributes and not git's own opinion: the obvious
implementation, skipping whatever `git diff --numstat` calls binary, does not
work. Git infers binary FROM a NUL byte, so under that rule "binary" and
"contains a NUL" are the same question and every file this gate exists to catch
excuses itself. The discriminator has to be a DECLARATION, which is why the
binary formats this workspace commits are named in .gitattributes. A format
that is genuinely binary belongs there; a file that wants a NUL and is not one
of those formats wants an escape instead.

It takes paths as arguments, which is how pre-commit hands it the staged files,
and checks everything staged when given none. Both forms read the index, so
this is the one gate that needs a checkout rather than a workspace.
"""

import sys
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, git, say, skip

MESSAGE = """
A NUL byte in a text file makes grep and rg report zero matches in it rather
than an error, so its contents stop being findable by any search at all.

If the byte is meant (a separator, a sentinel, a fixture) write it as the
escape your language spells it with rather than as the byte itself. It is the
same character at run time and ordinary text on disk.

Removing one is a job for a script (`perl -0777 -pi -e 's/\\0/\\\\0/g' <file>` or
similar), not an editor: the same binary-ness that hides the file from grep
defeats string-matching edits.

If the file is a binary format this workspace commits on purpose, declare it
in .gitattributes with a `binary` line, which is also what stops git trying to
diff and merge it as text."""

# Paths per `git check-attr` call, which keeps a run over the whole workspace
# well under the limit on a command line's length.
BATCH = 500


def declared_binary(paths: list[str]) -> set[str]:
    """The paths a `binary` line in .gitattributes matches.

    A declared binary format is a format, not a defect. `check-attr` reports
    `set` for such a path, and `-z` keeps a path with a colon or a newline in
    it whole.
    """
    declared: set[str] = set()
    for start in range(0, len(paths), BATCH):
        batch = paths[start : start + BATCH]
        answer = git(["check-attr", "-z", "binary", "--", *batch])
        if answer.returncode != 0:
            fail("Could not read the binary attribute of the files to check.")
        fields = answer.stdout.split("\0")
        # Every record is three fields and ends in a separator, so splitting
        # leaves a trailing empty field and one more path than value: pairing
        # them is deliberately not strict.
        for path, value in zip(fields[0::3], fields[2::3], strict=False):
            if value == "set":
                declared.add(path)
    return declared


# pre-commit names paths relative to the workspace root, so they are read from
# there.
enter_repo_root()

# Both halves of this gate ask git: the declarations come from `check-attr` and
# the file set, when none is given, from the index. A workspace that is not a
# repository yet, which is what a fresh render is until `git init`, therefore
# has nothing here to judge and nothing to judge it with.
if git(["rev-parse", "--is-inside-work-tree"], quiet=True).returncode != 0:
    skip("no-nul-bytes: skipped, this workspace is not a git checkout yet")

files = sys.argv[1:]
if not files:
    # The index of the checkout this gate entered, never the one a hook's
    # GIT_INDEX_FILE names: the hook that runs this gate hands it the staged
    # paths on the command line instead, so nothing reads a partial commit's
    # temporary index here.
    staged = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"])
    if staged.returncode != 0:
        fail("Could not list the staged files.")
    files = [name for name in staged.stdout.split("\0") if name]

files = [name for name in files if Path(name).is_file()]
if not files:
    sys.exit(0)

binary = declared_binary(files)
found = False
for name in files:
    if name in binary:
        continue
    nuls = Path(name).read_bytes().count(b"\0")
    if nuls:
        say(f"{name}: {nuls} NUL byte(s), and its format is not declared binary", err=True)
        found = True

if found:
    fail(MESSAGE)
