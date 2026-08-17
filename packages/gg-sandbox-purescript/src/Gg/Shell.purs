-- | Run shell commands in the workspace.
-- |
-- | One function, and the way a program reaches everything gg has no tool for: a build, a test run,
-- | `git`, `curl`, a package manager. The workspace is the working directory.
-- |
-- | A non-zero exit is a *result* rather than a failure, because deciding whether a build or a test
-- | run passed is the single most common thing a program does with one.
module Gg.Shell
  ( shell
  , ShellOutput
  , ShellOptions
  ) where

import Prelude

import Data.Maybe (Maybe)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | How to run a command. Optional; `{}` takes gg's own defaults.
type ShellOptions = (timeoutSecs :: Int)

-- | What a command reported when it finished.
-- |
-- | # Fields
-- |
-- | - `exitCode` — The process's exit status; `Nothing` when a signal killed it. Zero means success.
-- | - `output` — Merged stdout and stderr, tail-truncated at 16 KiB.
-- |
-- |   Under a run that offloads shell output the ceiling is the configured line or character limit
-- |   instead, and what is kept ends with a note naming the files that hold the whole of it. Under
-- |   the default `adaptive` mode a command that succeeded returns just that note.
-- | - `truncated` — Whether the cap cut `output`, dropping the head and keeping the tail.
type ShellOutput =
  { exitCode :: Maybe Int
  , output :: String
  , truncated :: Boolean
  }

-- | Run a command with `sh -c` in the workspace directory and collect its merged output.
-- |
-- | A non-zero exit is not a failure: it arrives as `exitCode` on the result, and only a process that
-- | could not be launched, or one the timeout killed, throws.
-- |
-- | This run may **offload** shell output, and the `shell` tool's own description says which mode is
-- | in force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the
-- | two files the command's full stdout and stderr were written to. Under `adaptive`, the default, a
-- | command that succeeded returns no output at all beyond that note, and one that failed returns the
-- | tail. Grepping the named files beats re-running the command.
-- |
-- | # Operation
-- |
-- | shell.shell
-- |
-- | # Arguments
-- |
-- | - `command` — The command line, run by `sh -c` with the workspace as its working directory.
-- | - `options` — How to run it; `{}` takes gg's own defaults.
-- | - `options.timeoutSecs` — How long to let it run, in seconds, before killing it. Left out, gg's
-- |   default of 120 applies, clamped to whatever is left of the run's wall-clock budget.
-- |
-- | # Returns
-- |
-- | The command's merged stdout and stderr, its `exitCode` — `Nothing` when a signal killed it —
-- | and whether gg's cap `truncated` the output.
-- |
-- | # Throws
-- |
-- | `LimitExceeded` when the timeout killed the process, and `IoError` when it could not be launched.
shell
  :: forall given rest
   . Union given rest ShellOptions
  => String
  -> Record given
  -> Effect ShellOutput
shell command options =
  shellOutput <$> Wire.call "shell" "shell" "Gg.Shell.shell" [ Wire.wire command, Wire.lower {} options ]

-- | A finished command. `exitCode` is absent when a signal killed the process.
shellOutput :: Wire.Wire -> ShellOutput
shellOutput value =
  { exitCode: Wire.optional "exitCode" value
  , output: Wire.text "output" value
  , truncated: Wire.field "truncated" value
  }
