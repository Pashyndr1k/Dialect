# Dialect

## Words

`docs/GLOSSARY.md` is binding. Read it before naming anything a person will
read — a label, a hint, an error, a heading, a commit message, a comment.

The short version: **Image**, not still. **Video**, not clip. **Audio**, not
track. **Input** and **Output** are the node groups, not "Bring in" and "Get
out". A **reading** is what came back from looking at a reference; a
**document** is the model-independent description; a **prompt** is the finished
words for one named model. Never write "IR" where a person can see it.

Text sent *to a model* is exempt — see the glossary's one exemption.

## Two rules that keep being learned the hard way

**Nothing swallows.** A handler that ends in `.catch(() => undefined)` turns a
refusal into a button that does nothing and says nothing. Three separate
buttons have been broken this way. Every failure reaches somewhere a person can
read it.

**Check what a permission actually grants.** `opener:default` does not include
`open-path`; `opener:allow-open-path` enables the command with an empty scope,
which denies every path. Both were assumed, both were wrong, and both failed
silently. Opening a folder is a host command now.

## Conventions

- The API key lives in the OS credential store. There is no `secret_get`
  command, deliberately — the window can store and clear a key, never read one.
- Version is `major.minor` in `package.json`, mirrored as `major.minor.0` in
  `Cargo.toml` and `tauri.conf.json`.
- Core has no filesystem. Each front end supplies its own `SourceResolver`.
- Nothing is pushed, tagged or released without being asked.
