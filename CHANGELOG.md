# Changelog

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
