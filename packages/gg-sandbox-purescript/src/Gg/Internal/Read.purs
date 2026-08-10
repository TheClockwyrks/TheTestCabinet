-- | **The one narrowing two capability modules share**, and the only reader that does not live
-- | beside the type it builds.
-- |
-- | Every other conversion from a JavaScript value to one of this SDK's types is a private function
-- | in the module that declares that type, because a capability module owns the types it produces and
-- | a reader that lived anywhere else would be a second place to look. Most of them are nothing at
-- | all: a PureScript record *is* a JavaScript object, so a result whose fields are all strings,
-- | numbers, booleans and arrays is taken as it stands. What genuinely differs is narrow — a field the
-- | wire may omit becomes a `Maybe`, and a field that is one of a fixed set of words becomes an arm.
-- |
-- | A file read is the exception: `Gg.Files.readFile` and `Gg.Views.openFile` return the same shape,
-- | and neither module may import the other's reader without a module cycle. So the narrowing is here
-- | and takes each arm's constructor as an argument, which is what lets it name the two record shapes
-- | **structurally** rather than importing them. That spelling is not a second copy anything could
-- | drift from: `purs` unifies it with `Gg.Files.TextFile` and `Gg.Files.ImageFile` at both call
-- | sites, so a field added to either type is a compile error here.
-- |
-- | Nothing here is model-facing.
module Gg.Internal.Read
  ( fileRead
  ) where

import Data.Maybe (Maybe)
import Gg.Internal.Wire (Wire, field, optional, taken, text)

-- | A read, narrowed to the arm its `kind` names.
-- |
-- | The text arm is taken as it stands: every one of its fields is a plain value under the same name,
-- | and the `kind` the wire also carries is a field that type does not declare, so nothing reading it
-- | can see it.
fileRead
  :: forall a
   . ( { contents :: String
       , firstLine :: Int
       , lastLine :: Int
       , totalLines :: Int
       , byteTruncated :: Boolean
       }
       -> a
     )
  -> ( { mediaType :: String
       , label :: String
       , bytes :: Int
       , shown :: Boolean
       , notShownReason :: Maybe String
       }
       -> a
     )
  -> Wire
  -> a
fileRead onText onImage value = case text "kind" value of
  "image" -> onImage
    { mediaType: text "mediaType" value
    , label: text "label" value
    , bytes: field "bytes" value
    , shown: field "shown" value
    , notShownReason: optional "notShownReason" value
    }
  _ -> onText (taken value)
