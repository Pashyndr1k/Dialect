# Changelog

## 0.41.0 — 2026-09-03

**No keys, no secrets, no passwords.** The app used to download its own
replacement and install it, which meant it had to tell its own build from
anyone else's — so every release had to be signed, which meant a private key,
a repository secret and a password to keep. That is a fair trade for software
with strangers using it and a poor one for a handful of people who know
whoever wrote it.

It now asks GitHub which release is newest, and if that is newer than what is
running it says so and offers to open the releases page. It downloads nothing
and runs nothing, so there is nothing to sign. The updater plugin, the signing
key, the repository secret and the release manifest are all gone, and the build
no longer depends on a secret it might not have.

Updating is: press the button, download the installer, run it.

## 0.40.0 — 2026-09-03

The release engineering that 0.31 said was missing, and an interface that
answers the questions people kept having to ask.

**It tells you when a new version is out.** On start it asks GitHub which
release is newest and, if that is newer than what is running, offers to open the
releases page. It does not download or install anything itself — which is why
there is no signing key, no repository secret and no password anywhere in this
project. Code signing is still not done either, so Windows and macOS warn on
first install.

**ffmpeg travels with it** on Windows — an LGPL build, bundled. Video and audio
references work out of the box instead of after a separate install. macOS still
looks for ffmpeg on your machine.

**Add a model by giving Dialect its prompting guide.** Paste the link and Opus
reads it and writes the card: the id, the family, the syntax, the field order,
the limits, what it will not do. Then it is checked — a field may only read IR
paths that exist, and one that does not renders nothing, for ever, without
saying why. Invented paths, empty fields and unknown rules are dropped and
listed. Nothing is saved: the card opens for reading, with the model's own
confidence and what it had to assume. A card can be brought up to date the same
way, from a newer guide, keeping the id your graphs point at.

**Model cards can be seen and edited.** The panel could install a set, count
them, and never show you one. Every card is now listed with the layer it came
from and whether a later layer overrides it; yours are editable in place and the
others offer a copy.

**No more publisher key.** A card set needed an Ed25519 signature from a key you
had trusted first. Cards are plain YAML the app itself lets you write and
delete, in a folder you can open — a 64-character key in front of that was a
lock on a door standing open beside it. A set is now a folder or a URL, and it
installs. Nothing is half-installed and a numbered set still will not go
backwards by accident.

**Several graphs open at once.** Tabs, with the undo history kept per tab, and
every open tab remembered across a restart.

**A right-click menu that belongs to this app**, replacing the web view's Back /
Reload / View Page Source, with Add node first.

**One node for a reference and its reading.** They were two — a file you have
not paid to look at, and the same file after you paid — which made using the
reading you already had a different box in a different port. Up to three files
and up to three readings from Memory; picking a reading greys the files rather
than removing them, because reading a file twice costs money twice.

**Names.** `docs/GLOSSARY.md` fixes one word per thing and the app follows it:
image not still, video not clip, audio not track, Input and Output for the node
groups, User prompt for what you type. "Kept" is **Memory**, and it holds
readings and templates — graphs went to the tabs, where documents belong.

**Buttons that work.** "Open the folder" did nothing, anywhere, in any build:
the opener plugin's `open-path` permission is granted with an empty scope, which
denies every path, and every call site swallowed the refusal. Opening a folder
is a host command now, and nothing swallows. Then every other button in the
window was checked; three more said nothing when they failed and one did nothing
when clicked.

**Fixed:** an effect that handed the title bar its state on every render and was
re-rendered by doing so; a failed card-set install leaving its staging folder on
disk for ever; a closed tab reopening itself at the next start; the sheet not
scrolling when it outgrew the window.

**Known:** 429 compiler tests, 23 CLI, 47 host, and none of them can press a
button. Dictation still needs whisper on PATH or a transcription key. macOS
still finds its own ffmpeg.

## 0.35.0 — 2026-09-02

Dialect is a node editor now. The two panes are gone and so is the fixed
pipeline behind them: what used to be one route through the app is a graph you
draw, save, and send to somebody.

The compiler did not change. That was the rule the whole rewrite was held to —
the interface moved and the substance did not — and it is checked rather than
claimed: every pipeline the old app could run is written twice in the tests,
once as the calls it used to make and once as a graph, and asserted to produce
the same document.

**Why it fits.** The pipeline was always a graph; it was just written as six
functions inside a very large component. The Prompt IR was already the thing
that flowed between them, so naming the wires was most of the work.

- **A canvas.** Sixteen node types across input, reading, composing, shaping and
  output. Ports are typed and coloured, and a wire that could not carry anything
  is refused while you are still dragging it — and says why.
- **Batch is gone, and nothing was lost.** A folder puts twenty references on
  one wire and everything downstream runs twenty times. It stops at its budget,
  and it resumes after a restart because the answers are on disk keyed by
  content — which holds even when the graph has changed in between.
- **Branching.** One document into three models at once, three prompts side by
  side, for nothing: rendering is free.
- **Graphs are files.** Saved beside the templates and the readings, and the one
  you had open is reopened where you left it.
- **The inspector** holds what a two-inch box cannot: the prompt, its negative,
  its findings, and the fields behind them. Correcting a prompt is still done by
  correcting the document, and the correction now travels with the graph.
- **Choose the model.** Any model the key can reach, listed from the API rather
  than compiled in. Changing it re-reads nothing — what a reference says is a
  fact about the reference, so answers already bought stay reachable and report
  which model actually made them. The default is Sonnet.

**Two things the compiler was getting wrong**, found by running eight variations
of one document on real photographs:

- The skin-realism block was asked of pictures with no skin — a charcoal study,
  a painted cel, a thermal capture, and a figure the same document called flat
  matte clay. It now stands down on anything not photographic.
- A prompt could say both that it was monochrome and that it was in colour, which
  is what varying a document does when an axis rewrites some look fields and
  leaves the rest. Warned, never blocked: which half is wrong is yours to decide.

**Not in this release.** Auto-update, code signing, a bundled ffmpeg — as
before. Sub-graphs and a per-node budget were planned and then dropped: both are
new capability rather than a new interface, and this release was not the place.

**Known:** the app is 403 tests of compiler and 39 of host, and none of them can
press a button. Dictation still needs whisper on PATH or a transcription key.

## 0.31.0 — 2026-08-30

First release. Pre-1.0 on purpose: the compiler and the app are finished enough
to use every day, and the release engineering around them is not. There is no
auto-update yet, nothing is code-signed, and ffmpeg is found on your machine
rather than shipped.

**What it does.** Turns a few words, a reference, or both into a prompt written
in one model's own dialect. Ten model cards across image, video and audio.

- **Reading a reference.** A still, a clip or a track — each read as what it is.
  A clip becomes frames taken in order, because what no single frame shows,
  the differences between them do. A track is measured before it is described:
  tempo, key and loudness are counted rather than guessed at, and only stated
  when the measurement is confident.
- **The bundle.** What you want and what you brought are sources with jobs. A
  style reference lends its grade and its light and nothing of its subject; a
  subject reference lends who it is and nothing of its room. Reading happens
  once and is text afterwards, so rewriting the sentence beside a photograph
  costs a text call rather than another look at the photograph.
- **Templates.** Paste a prompt that already works and it is taken apart, not
  improved: the parts describing that particular subject become boxes you fill
  with a few words, and the parts describing how the thing is made stay exactly
  as you wrote them.
- **Keeping.** A character or a look read once can be attached to fifty later
  prompts for nothing.
- **Variations.** Many versions along one named axis, in a single call — because
  twenty separate calls produce twenty similar answers.
- **Sequences.** Four shots that hold one character in one room, with the world
  stated once so it cannot drift.
- **Engine rules.** Eleven countable checks — no more than three look words, one
  action per clip, at most three tracked faces — that autofix, warn or block.
  A card set can now ship its own.
- **Card sets.** Model cards are data and can be replaced without a new binary,
  if they carry an Ed25519 signature from a key you trusted first.

**What it needs.** An Anthropic API key, entered in Settings and kept in the
operating system's credential store. ffmpeg on PATH for clips and tracks.
Reading a reference costs about five cents; composing or varying, about one.

**Not in this release.** Auto-update. Code signing and notarisation. A bundled
ffmpeg. Lyrics transcription, which needs a speech model. Dictation, which needs
either whisper on PATH or a transcription key.

**Known:** the macOS builds are the first ever made — every version until now
was built and run on Windows only.
