-- | The `programs` object: the library of programs this agent has already run.
-- |
-- | Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
-- | program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
-- | what ran, patch it with ordinary string work, hand it back.
-- |
-- | ```
-- | source <- programs.get {}
-- | programs.rerun (replaceAll (Pattern "fs.readfile") (Replacement "fs.readFile") source)
-- | ```
module Gg.Programs
  ( programs
  , history
  , get
  , rerun
  , GetOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (programSummary)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary, ProgramSummary)
import Prim.Row (class Union)

-- | Which program to fetch. Optional; `{}` fetches your most recent one.
type GetOptions = (turn :: Int)

-- | fetch a program you already ran, and hand a patched copy back to be run
programs
  :: { history :: Effect (Array ProgramSummary)
     , get ::
         forall given rest
          . Union given rest GetOptions
         => Record given
         -> Effect String
     , rerun :: String -> Effect Unit
     , list :: Effect (Array FunctionSummary)
     }
programs =
  { history
  , get
  , rerun
  , list: listOn "programs"
  }

-- | The programs you have already run this session, oldest first — each with the turn it ran on, how
-- | big it was, and whether it ran to its end.
-- |
-- | It lists shapes, not sources: fetch the one you want with `programs.get`. The list survives a
-- | compaction, so it is also how you find a program whose text has left your context window. It is
-- | empty — never an error — for a session that has run nothing yet.
-- |
-- | # Arguments
-- |
-- | (none)
history :: Effect (Array ProgramSummary)
history = map programSummary <$> Wire.call "history" "programs" "history" []

-- | The exact source of one program you ran, as a string. With `{}`, your most recent one.
-- |
-- | This is the first half of fixing a program without rewriting it: get what ran, patch it with
-- | ordinary string work, and hand the result to `programs.rerun`. What comes back is the program
-- | that **executed** — so when a turn's program was itself handed over by `programs.rerun`, you get
-- | the program that ran, not the few lines that asked for it, and fetch-patch-run composes turn
-- | after turn.
-- |
-- | # Arguments
-- |
-- | - `options` — Which program to fetch; pass `{}` for your most recent one.
-- | - `options.turn` — The turn whose program to fetch, as `programs.history` reports it.
-- |
-- | # Raises
-- |
-- | `NotFound`, naming the turns that are held, for a turn that ran no program or one old enough
-- | that the library has dropped it.
get
  :: forall given rest
   . Union given rest GetOptions
  => Record given
  -> Effect String
get options = Wire.call "get" "programs" "get" [ Wire.pick "turn" options ]

-- | Hand gg a program to run in place of this one. Your program finishes, then gg compiles and runs
-- | `source` as this turn's program.
-- |
-- | Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every call
-- | your program already made stands, and the program that runs next sees the world your program left
-- | behind — so hand over BEFORE doing work you do not want done twice.
-- |
-- | The first call stands, because a silently replaced program is a change you cannot see. If your
-- | program then fails, the hand-over is cancelled along with everything else the failed program
-- | decided, and you get an ordinary error turn instead. Chains are bounded: hand over once per turn,
-- | and write the fixed program to do the work.
-- |
-- | # Arguments
-- |
-- | - `source` — The program to run in place of this one, as PureScript. It may not be blank.
-- |
-- | # Raises
-- |
-- | `Refused` for a second hand-over in one turn, and `InvalidArgument` for a blank source.
rerun :: String -> Effect Unit
rerun source = Wire.call_ "rerun" "programs" "rerun" [ Wire.wire source ]
