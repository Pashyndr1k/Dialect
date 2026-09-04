# Glossary

**Scope: Dialect only.** This is a local convention for one repository, not a
claim about English and not a house style for anything else. Other projects have
other subjects and are free to call things whatever suits them.

The words this app uses, and the ones it does not. One name per thing,
everywhere: in the interface, in error messages, in the guide, in the CLI, and
in the comments. A thing with two names is two things to the person reading.

Where a word is listed as **not**, it is not a synonym to be varied for style.
It is wrong *here*, and changing it back is a bug. The words in the "Not" column
are mostly good words — they are simply not the ones this project picked, and
the value is in having picked one at all.

The reason Dialect needs this and a smaller project might not: the same three
kinds of reference have to be named identically across a window, a command line,
a document format and a card schema, and they are the thing every feature
touches. Where a name is only in one place, one name is not worth a rule.

## Material you bring in

| Use | Not | Why |
| --- | --- | --- |
| **Image** | still, picture, photo, shot | "Still" is a film word for a frame lifted out of a moving picture. Most images here never came from a film. The file is an image; the field is `image`; the sentence says image. |
| **Video** | clip, footage, movie | "Clip" implies a fragment of something longer. A file is a video whether it runs four seconds or forty minutes. |
| **Audio** | track, sound, recording | "Track" means a numbered song on a record, and also a channel in an editor, and also the thing a camera does. Audio means none of those and exactly this. |
| **Reference** | source file, input file, asset | A file you bring in *for the app to look at*. It stays a reference whether it is an image, a video or audio. The node of that name holds up to three of them, and the readings of them you already have. |
| **User prompt** | words, text, description | What you type yourself, as against what the app writes. Two words rather than one because it is the counterpart of the finished **prompt** below, and "words" on its own never said whose. The port type is still `words` in the code; the socket reads "user prompt". |

`image`, `video` and `audio` are also the three values of a reference's kind in
the code, which is the point: the interface says what the type says.

## What the app makes

| Use | Not | Why |
| --- | --- | --- |
| **Reading** | analysis, extraction, description of a reference | What the app got from looking at one reference. Costs money once, then is free forever. |
| **Document** | IR, intermediate representation, prompt document | One model-independent description of the thing you want. `PromptIR` is its type; nothing in the interface says IR. |
| **Prompt** | output, result, text | The finished words for one named model. A document plus a model card makes a prompt. |
| **Card** | model card, profile, model definition | The formula for one model: which fields it wants, in what order, joined how. "Model cards" is the name of the panel; one of them is a card. |
| **Graph** | project, workspace, flow, canvas | What you build and save. The canvas is the surface you build it on; the graph is the thing itself. |
| **Node** | block, step, box | One thing in a graph. |
| **Wire** | edge, connection, link | What joins two nodes. `edge` is the type name; the interface says wire. |
| **Tab** | window, pane, document slot | One open graph. Several can be open; one is on screen. |

## Node groups

The five groups a node can be in, as the catalogue names them. The id is what
the code stores; the label is what a person reads.

| Id | Label | What belongs there |
| --- | --- | --- |
| `in` | **Input** | Brings material into the graph: words, a reference, a saved reading, a document, a template. |
| `read` | **Read** | Looks at a reference and turns it into a reading. The step that costs. |
| `compose` | **Describe** | Turns words and readings into one document. |
| `shape` | **Shape** | Changes a document: edit fields, check rules, make variations. |
| `out` | **Output** | Gets something out: a prompt for a model, files on disk. |

Not "Bring in" and "Get out". A group is a noun in this list, because the other
three always were and two odd ones out made the catalogue read as five
unrelated ideas rather than one series.

## Things you do

| Use | Not | Why |
| --- | --- | --- |
| **Run** | execute, build, generate, compile | Running a graph is the one verb for making it happen. |
| **Save** | keep, store, write | Save puts a graph in Dialect's own folder under its name. **Save as** puts a copy anywhere. |
| **Memory** | Kept, library, shelf, cache | The panel holding readings and templates — the expensive half of earlier sessions, kept so it need not happen twice. It was called Kept, which read as a verb and sat one word away from Save. Graphs are not in it: they are documents, and they live in the tabs. |
| **Show in the file manager** | open the folder, reveal, browse | Naming Explorer or Finder generically. "Open the folder" never said which folder, and the answer people wanted was the path. |

## One exemption

Text sent *to a model* — a schema description, an extraction instruction — is
not interface copy and is not bound by this list. "Film still" is the correct
term of art for a frame lifted from a film, and a vision model answers a
question in its own vocabulary better than in ours. Those strings live in
`extract/`, `vary/` and the cards, and are written for the reader they have.

Everything a person reads is bound by it.

## Money

| Use | Not | Why |
| --- | --- | --- |
| **Spend** | cost, usage, credits, tokens | What a run costs you in real money. Shown in dollars, never in tokens — nobody buys tokens on purpose. |
| **Free** | cached, no cost | A step that will not spend, because it has already been paid for or never spends. |
