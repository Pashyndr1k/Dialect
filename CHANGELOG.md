# Changelog

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
