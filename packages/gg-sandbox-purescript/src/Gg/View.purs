-- | The `view` object: the only way material enters your own context window.
-- |
-- | Under responses as code a whole program's output would otherwise collapse into one anonymous
-- | blob of logs, charged to one band, attributable to nothing and closable by nothing. A view
-- | restores what tool calling gave for free: one message per view, carrying the band it is charged
-- | to and the selector it can be closed by. So `Effect.Console.log` reaches the run's **operator**,
-- | and a view reaches **you**.
module Gg.View
  ( view
  , openFile
  , openText
  , openDocsView
  , close
  , current
  , OpenFileOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (fileRead, openView)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FileRead, FunctionSummary, OpenView)
import Prim.Row (class Union)

-- | The window of lines a file view shows. Every field is optional; `{}` shows the whole file.
type OpenFileOptions = (offset :: Int, limit :: Int)

-- | show yourself a file, a value, or a function's documentation — the only way material enters your
-- | context
view
  :: { openFile ::
         forall given rest
          . Union given rest OpenFileOptions
         => String
         -> Record given
         -> Effect FileRead
     , openText :: String -> String -> Effect Unit
     , openDocsView :: String -> Effect Unit
     , close :: String -> Effect Int
     , current :: Effect (Array OpenView)
     , list :: Effect (Array FunctionSummary)
     }
view =
  { openFile
  , openText
  , openDocsView
  , close
  , current
  , list: listOn "view"
  }

-- | Read a file AND show it to yourself: you get back exactly what `fs.readFile` returns, and the
-- | file also becomes its own item in your context window, attributed to its path and closable by it.
-- |
-- | The split from `fs.readFile` is the point — `fs.readFile` gets bytes for your PROGRAM,
-- | `view.openFile` shows a file to YOU — so a program that reads forty files to grep them still
-- | puts nothing in your window. `offset` and `limit` select a window of lines, and two pages of one
-- | file are two views that coexist; re-opening the SAME page replaces what it showed rather than
-- | piling up a duplicate. An image file is shown to you as a picture, and is the ONLY way to look at
-- | one — `fs.readFile` of an image describes it without showing it.
-- |
-- | Pictures are the one thing this call can refuse. Only so many image-carrying views may be open at
-- | once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you pass that
-- | cap, so close one with `view.close` and try again. Re-opening a picture you already have open
-- | replaces it rather than adding one, and is never refused. Text views are never refused by this
-- | cap.
-- |
-- | # Arguments
-- |
-- | - `path` — The file to open. Relative to your workspace, or absolute.
-- | - `options` — The window of lines to show; pass `{}` to show the whole file.
-- | - `options.offset` — The 1-based line to start at.
-- | - `options.limit` — How many lines to show from `offset`.
-- |
-- | # Raises
-- |
-- | `LimitExceeded`, naming the cap, when opening a picture would pass your agent's image-view cap.
openFile
  :: forall given rest
   . Union given rest OpenFileOptions
  => String
  -> Record given
  -> Effect FileRead
openFile path options =
  fileRead <$> Wire.call "open_file" "view" "openFile" [ Wire.wire path, Wire.lower {} options ]

-- | Show yourself a value your program computed, under `label` — a directory listing, a command's
-- | output, a child agent's answer, a table you assembled.
-- |
-- | This is the channel into your context: logs go to the run's operator, views come back to you on
-- | your next turn. Opening the same `label` again replaces what it showed, so a program may refine a
-- | view in a loop without piling up a copy per iteration. An empty BODY is allowed, since it is how
-- | you say that something you were showing is now empty.
-- |
-- | # Arguments
-- |
-- | - `label` — What to file the view under. It is what `view.close` takes, and opening the same
-- |   label again replaces what it showed. It may not be empty.
-- | - `body` — What to show yourself. An empty body is allowed: it is how you say that something you
-- |   were showing is now empty.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` for an empty label — a view with no selector could never be closed or
-- | attributed — and `LimitExceeded`, naming the cap, for a body or label over gg's caps; nothing is
-- | ever silently truncated.
openText :: String -> String -> Effect Unit
openText label body =
  Wire.call_ "open_text" "view" "openText" [ Wire.wire label, Wire.wire body ]

-- | Show yourself the full documentation for one function: its signature, its description, and the
-- | declarations of any types it refers to that you have not already been shown this session.
-- |
-- | This is how you read what a function does. It is a **view**, not a return value — the
-- | documentation arrives in your next prompt under a `Documentation` heading keyed by the function
-- | name, exactly as a file or a computed value arrives — so it is not available in the turn you ask
-- | for it. Plan for that: ask in one turn, use it in the next. Opening the same function's docs
-- | again replaces the view rather than adding a second copy, and `view.close` closes it when you are
-- | done with it.
-- |
-- | # Arguments
-- |
-- | - `name` — The function to document, by the name it is called on its object — `"readFile"` for
-- |   `fs.readFile`. Every object's `list` is how you find out which names exist.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown or unbound name.
openDocsView :: String -> Effect Unit
openDocsView name = Wire.call_ "open_docs_view" "view" "openDocsView" [ Wire.wire name ]

-- | Close every view carrying `selector` and hand back how many were closed, freeing the tokens they
-- | occupied.
-- |
-- | For a file that is every page of that path, for a text view the one with that label, for a
-- | documentation view the function's name. Closing a selector that is not open hands back `0` rather
-- | than failing, so a program that tidies up unconditionally does not have to guard every call.
-- | Closing a file view forgets what you read, not what exists; closing a text view discards the only
-- | copy of what it held, so write anything you will need later to a file or a memory first.
-- |
-- | # Arguments
-- |
-- | - `selector` — What the view is filed under: a file's path, a text view's label, or a
-- |   documentation view's function name.
close :: String -> Effect Int
close selector = Wire.call "close" "view" "close" [ Wire.wire selector ]

-- | List what is open in your context window right now: each view's `kind`, the `selector` that
-- | closes it, roughly what it costs you in `tokens`, and — for a paged file view — the `region` it
-- | covers.
-- |
-- | It is called `current` rather than `list` because every API object already carries a `list` that
-- | lists that object's own functions. Read it before deciding what to close when your window is
-- | filling up.
-- |
-- | # Arguments
-- |
-- | (none)
current :: Effect (Array OpenView)
current = map openView <$> Wire.call "current" "view" "current" []
