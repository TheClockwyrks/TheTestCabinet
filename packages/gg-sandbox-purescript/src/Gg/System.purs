-- | The `system` object: running commands in the workspace.
module Gg.System
  ( system
  , shell
  , ShellOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (shellOutput)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary, ShellOutput)
import Prim.Row (class Union)

-- | How to run a command. Optional; `{}` takes gg's own defaults.
type ShellOptions = (timeoutSecs :: Int)

-- | run shell commands in the workspace
system
  :: { shell ::
         forall given rest
          . Union given rest ShellOptions
         => String
         -> Record given
         -> Effect ShellOutput
     , list :: Effect (Array FunctionSummary)
     }
system =
  { shell
  , list: listOn "system"
  }

-- | Run a command with `sh -c` in the workspace directory and hand back its merged stdout and
-- | stderr.
-- |
-- | A non-zero exit is NOT a failure — read `exitCode` on the result; only a process that could not
-- | be launched, or one the timeout killed, raises.
-- |
-- | This run may **offload** shell output — the `shell` tool's own description says which mode is in
-- | force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the
-- | two files the command's full stdout and stderr were written to. Under `adaptive` (the default),
-- | a command that **succeeded** returns no output at all, only that note; one that **failed**
-- | returns the tail. Grep the named files instead of re-running the command.
-- |
-- | # Arguments
-- |
-- | - `command` — The command line, run by `sh -c` with your workspace as its working directory.
-- | - `options` — How to run it; pass `{}` for gg's own defaults.
-- | - `options.timeoutSecs` — How long to let it run, in seconds, before killing it. Leave it out
-- |   for gg's default of 120, which is clamped to whatever is left of the run's wall-clock budget.
-- |
-- | # Raises
-- |
-- | `LimitExceeded` when the timeout killed the process, and `IoError` when it could not be
-- | launched.
shell
  :: forall given rest
   . Union given rest ShellOptions
  => String
  -> Record given
  -> Effect ShellOutput
shell command options =
  shellOutput <$> Wire.call "shell" "system" "shell" [ Wire.wire command, Wire.lower {} options ]
