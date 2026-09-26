-- | The library of programs this session has already run.
-- |
-- | A program that ran can be fetched by its id, patched with ordinary string work, and handed back
-- | to run in place of the current one.
-- |
-- | ```
-- | source <- Gg.Programs.get "k3p9"
-- | Gg.Programs.rerun (replaceAll (Pattern "opentext") (Replacement "openText") source)
-- | ```
module Gg.Programs
  ( history
  , get
  , sourceOf
  , rerun
  , ProgramSummary
  ) where

import Prelude

import Data.Maybe (Maybe)
import Effect (Effect)
import Gg.Internal.Wire as Wire

-- | One program that has already run, as the library's directory lists it.
-- |
-- | It describes the program's shape, never its source.
-- |
-- | # Fields
-- |
-- | - `id` — The id its `submit_program` acknowledgement carried, which is what fetches its source.
-- | - `turn` — The turn it ran on.
-- | - `lines` — How many lines of source it was.
-- | - `chars` — How many characters of source it was.
-- | - `ok` — Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
-- | - `error` — The error it ended with, when it did not run to its end.
type ProgramSummary =
  { id :: String
  , turn :: Int
  , lines :: Int
  , chars :: Int
  , ok :: Boolean
  , error :: Maybe String
  }

-- | The programs already run this session, oldest first.
-- |
-- | It lists shapes rather than sources. The list survives a compaction.
-- |
-- | # Operation
-- |
-- | programs.history
-- |
-- | # Arguments
-- |
-- | (none)
-- |
-- | # Returns
-- |
-- | One summary per program already run, oldest first: its id, the turn it ran on, how big it was,
-- | and whether it ran to its end. A session that has run nothing yet gets an empty array.
history :: Effect (Array ProgramSummary)
history = Wire.callMap (map programSummary) "history" "programs" "Gg.Programs.history" []

-- | Fetch the exact source of one program that ran, by the id its acknowledgement carried.
-- |
-- | What comes back is the program that executed. Where a submission handed its program over, its id
-- | holds the program that ran rather than the few lines that asked for it.
-- |
-- | # Operation
-- |
-- | programs.get
-- |
-- | # Arguments
-- |
-- | - `id` — The program's id, as its acknowledgement carried it and as the history reports it.
-- |
-- | # Returns
-- |
-- | The program's source, exactly as it executed.
-- |
-- | # Throws
-- |
-- | `NotFound`, naming the ids that are held, for an id this session was never issued or one whose
-- | program is old enough that the library has dropped it.
get :: String -> Effect String
get id = Wire.call "get" "programs" "Gg.Programs.get" [ Wire.wire id ]

-- | Fetch the source of one program the history listed.
-- |
-- | `Gg.Programs.get` with the id taken out of the summary, which describes a program's shape and
-- | never its text.
-- |
-- | # Alias
-- |
-- | programs.get
-- |
-- | # Arguments
-- |
-- | - `program` — The program to fetch, as `Gg.Programs.history` listed it.
-- |
-- | # Returns
-- |
-- | The program's source, exactly as it executed.
-- |
-- | # Throws
-- |
-- | `NotFound` when the library has since dropped that program.
sourceOf :: ProgramSummary -> Effect String
sourceOf program = get program.id

-- | Hand gg a program to run in place of this one.
-- |
-- | This program finishes, then gg compiles and runs the given source as this submission's program,
-- | under the same id. Nothing is undone: every call this program already made stands, and the
-- | program that runs next sees the world this one left behind.
-- |
-- | The first call in a program is the one that stands. A program that then fails cancels the
-- | hand-over along with everything else it decided, and the turn ends as an ordinary error. A
-- | submission runs at most four programs: this one plus three handed over.
-- |
-- | # Operation
-- |
-- | programs.rerun
-- |
-- | # Arguments
-- |
-- | - `source` — The program to run in place of this one, as PureScript. It may not be blank.
-- |
-- | # Throws
-- |
-- | `Refused` for a second hand-over from the same program, and `InvalidArgument` for a blank source.
rerun :: String -> Effect Unit
rerun source = Wire.call_ "rerun" "programs" "Gg.Programs.rerun" [ Wire.wire source ]


-- | One program in the library's directory.
programSummary :: Wire.Wire -> ProgramSummary
programSummary value =
  { id: Wire.field "id" value
  , turn: Wire.field "turn" value
  , lines: Wire.field "lines" value
  , chars: Wire.field "chars" value
  , ok: Wire.field "ok" value
  , error: Wire.optional "error" value
  }
