-- | Find the callable surface, and take a documentation view back out of the window.
-- |
-- | The system prompt names modules and no function, so `search` is what turns a keyword or a module
-- | id into fully-qualified names, and a documentation view reads one of those names in full.
-- |
-- | Searching is bound in every program whatever a run enables. Closing a documentation view is
-- | bought by a capability of its own.
module Gg.Docs
  ( search
  , close
  , closeAll
  , DocKind(..)
  , DocHit
  , DocSearch
  , SearchOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The words, the filters and the page a search is made of. Every field is optional, and none of
-- | them is a default worth relying on: a record naming neither a query nor a filter asks for
-- | nothing, and is the one record `search` refuses.
type SearchOptions =
  ( query :: String
  , modules :: Array String
  , type :: String
  , kind :: DocKind
  , offset :: Int
  , limit :: Int
  )

-- | Which of the three kinds of thing a documentation entry describes.
data DocKind
  -- | A module a program imports, and inside which its functions live.
  = ModuleEntry
  -- | A function a program calls.
  | FunctionEntry
  -- | A type a function takes or hands back.
  | TypeEntry

derive instance Eq DocKind
derive instance Generic DocKind _
instance Show DocKind where
  show = genericShow

-- | One entry a search matched.
-- |
-- | # Fields
-- |
-- | - `key` — The entry's fully-qualified name, which is what a documentation view is opened by.
-- | - `kind` — Whether it is a module, a function or a type.
-- | - `module` — The module it lives in, written the way a program writes it.
-- |
-- |   Exactly one, whatever the entry is: the module that publishes a function, the module that
-- |   declares a type, and, for a module, itself. It is a name a `modules` filter accepts, and
-- |   filtering on it answers with that module's whole directory.
-- | - `name` — The name a program calls it by, the type's own name, or the module's own path.
-- | - `summary` — Its one-line brief.
type DocHit =
  { key :: String
  , kind :: DocKind
  , module :: String
  , name :: String
  , summary :: String
  }

-- | A page of search results, with the total behind it.
-- |
-- | # Fields
-- |
-- | - `total` — How many entries matched before paging, which tells a capped page from a complete
-- |   answer.
-- | - `offset` — The offset this page starts at, echoed back.
-- | - `hits` — The page itself, best first.
type DocSearch =
  { total :: Int
  , offset :: Int
  , hits :: Array DocHit
  }

-- | Search every module this run bound, every function inside one, and every type they mention.
-- |
-- | Matching is a case-insensitive substring over names, signatures, briefs and detailed
-- | descriptions, so `docs` finds `openDocsView`. Ranking is by the kind of evidence that matched: an
-- | entry whose own name matched outranks one that mentions the word in a paragraph, and a weaker
-- | kind never overtakes a stronger one however often it occurs.
-- |
-- | Only entries this run bound are returned. The filters compose with each other and with the
-- | query, and every one of them, the query included, is optional.
-- |
-- | The page comes back as a value and is also opened as a view under the selector `search results`.
-- | The next search replaces that view.
-- |
-- | # Operation
-- |
-- | docs.search
-- |
-- | # Arguments
-- |
-- | - `options` — The words, the filters and the page. Nothing in it is required and any of it may
-- |   be left out, but a record that names neither a query nor a filter is refused.
-- | - `options.query` — The words to match, as a case-insensitive substring. It may be left out
-- |   when a filter says what to look at instead.
-- | - `options.modules` — The modules to look inside, each named by gg's own id — `files`, `views`,
-- |   `docs` — or by the path a program writes it as, `Gg.Files`, and matched exactly. Several are a
-- |   union rather than an intersection, and with no query it is those modules' directories in full.
-- |   A name no module has matches nothing rather than failing, and an empty array is no filter at
-- |   all.
-- | - `options.type` — One type's name, narrowing to that type and to the functions that take or
-- |   return it. Like `options.modules`, a name nothing declares matches nothing rather than failing.
-- | - `options.kind` — Whether to return modules, functions or types. The default returns all three.
-- | - `options.offset` — How many hits to skip, for reading past the first page. The default starts
-- |   at the best hit.
-- | - `options.limit` — The most hits to return. The default is gg's own page size and there is a
-- |   ceiling above it, so comparing the hits against `total` is the only way to see a capped page.
-- |   Zero is refused rather than read as "no cap".
-- |
-- | # Returns
-- |
-- | The page that matched, best first. `total` counts every entry that matched before paging, so a
-- | page shorter than `total` is a page there is more of.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a record that names neither a query nor a filter, and for a `limit` of
-- | zero. A module or type name gg does not hold matches nothing rather than failing.
search
  :: forall given rest
   . Union given rest SearchOptions
  => Record given
  -> Effect DocSearch
search options =
  Wire.callMap docSearch "search" "docs" "Gg.Docs.search" [ Wire.lower { kind: docKindWire } options ]

-- | Take one documentation view out of the context window, by the key it was opened under.
-- |
-- | The removal has no cascade: closing a type's view leaves every function view beside it, and
-- | closing a function's leaves its types. Nothing records why a view was opened, so a type that
-- | is closed is opened again by the next function that mentions it.
-- |
-- | # Operation
-- |
-- | docs.close
-- |
-- | # Arguments
-- |
-- | - `key` — The fully-qualified name the view was opened under, as a search hit reports it.
-- |
-- | # Returns
-- |
-- | How many views were taken away; a key that is not open closes `0` rather than failing.
-- |
-- | # Throws
-- |
-- | `Unavailable` under a run that did not enable closing documentation views.
close :: String -> Effect Int
close key = Wire.call "close" "docs" "Gg.Docs.close" [ Wire.wire key ]

-- | Take every documentation view out of the context window.
-- |
-- | The blanket form of `close`, on exactly the same terms and behind the same capability: no
-- | cascade to consider, because nothing is left.
-- |
-- | # Operation
-- |
-- | docs.close_all
-- |
-- | # Arguments
-- |
-- | (none)
-- |
-- | # Returns
-- |
-- | How many documentation views went, and `0` rather than a failure when none was open.
-- |
-- | # Throws
-- |
-- | `Unavailable` under a run that did not enable closing documentation views.
closeAll :: Effect Int
closeAll = Wire.call "close_all" "docs" "Gg.Docs.closeAll" []

-- | One page of results, read field by field because `kind` is a string on the wire and a value here.
docSearch :: Wire.Wire -> DocSearch
docSearch value =
  { total: Wire.field "total" value
  , offset: Wire.field "offset" value
  , hits: docHit <$> (Wire.field "hits" value :: Array Wire.Wire)
  }

-- | One hit, with its kind taken from the wire's word for it.
docHit :: Wire.Wire -> DocHit
docHit value =
  { key: Wire.text "key" value
  , kind: docKind (Wire.text "kind" value)
  , module: Wire.text "module" value
  , name: Wire.text "name" value
  , summary: Wire.text "summary" value
  }

-- | Which kind of entry this is. The wire's set is closed at three and gg owns it, so the fallback
-- | exists only because the conversion has to be total.
docKind :: String -> DocKind
docKind = case _ of
  "module" -> ModuleEntry
  "type" -> TypeEntry
  _ -> FunctionEntry

-- | A kind as the filter word the guest takes.
docKindWire :: DocKind -> String
docKindWire = case _ of
  ModuleEntry -> "module"
  FunctionEntry -> "function"
  TypeEntry -> "type"
