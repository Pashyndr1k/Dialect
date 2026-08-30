/**
 * The window is two panes, and which side a thing belongs on is not a matter of
 * taste:
 *
 *   Left  — what you gave the app. The references, how each one is getting on,
 *           what reading them costs, and what the cache already holds.
 *   Right — what the app made. The document it extracted, the prompt that
 *           compiles from it, the blocks that prompt is made of, the fields
 *           behind them, and what the rules had to say.
 *
 * The IR belongs on the right for the same reason the prompt does: it is a
 * result, not something anyone typed. It sits under the prompt because that is
 * the order you reach for them in.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleText,
  compile,
  extractFromImage,
  extractFromVideo,
  Gateway,
  ExtractedScene,
  getProfile,
  sceneToIR,
  toDocument,
  type Finding,
  type PromptIR,
  type Segment,
} from '@dialect/core';
import { createQueue, runQueue } from '@dialect/core';
import { PromptActions, References, type BatchItem } from './Batch.tsx';
import { Library } from './Library.tsx';
import { Fields } from './Fields.tsx';
import { HostProvider } from './provider.ts';
import { ANTHROPIC_KEY, secretStatus } from './secrets.ts';
import {
  cachedAnswer,
  cacheStats,
  clearCache,
  hostCache,
  loadLibrary,
  loadSession,
  mediaTools,
  pickVideo,
  probeVideo,
  rememberRead,
  videoFrames,
  thumbnail,
  type LibraryEntry,
  saveSession,
  savePromptsTo,
  SESSION_VERSION,
  showFolder,
  type OutFile,
  type Session,
} from './store.ts';
import { profiles, registry } from './registry.ts';
import { Settings } from './Settings.tsx';
import videoExample from '../../../packages/core/tests/golden/cowboy-saloon.ir.json';
import imageExample from './example.image.json';
import audioExample from './example.audio.json';

const LEVEL_ORDER: Record<Finding['level'], number> = { block: 0, warn: 1, autofix: 2 };

const READABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** The opening document follows the target, so the two never disagree. */
const exampleFor = (family: string): unknown =>
  family === 'video' ? videoExample : family === 'audio' ? audioExample : imageExample;

/**
 * One gateway for the window's lifetime, so its cache and its running total
 * survive between drops. Re-reading the same reference costs nothing.
 */
const gateway = new Gateway(new HostProvider(), {
  cache: hostCache,
  budgetUsd: 5,
  onSpend: (_usage, total) => window.dispatchEvent(new CustomEvent('dialect:spend', { detail: total })),
});

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseIR(text: string): { ir: PromptIR } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return { error: 'The document is not an object.' };
    return { ir: parsed as PromptIR };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function App() {
  const [irText, setIrText] = useState(() => JSON.stringify(imageExample, null, 2));
  const [target, setTarget] = useState('nano-banana-2');
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  /**
   * Which reference the prompt on the right actually came from. Not the same
   * as what is being previewed: you can look at a reference that has not been
   * read, and the header must not claim its prompt is on screen.
   */
  const [promptOf, setPromptOf] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [cache, setCache] = useState<{ entries: number; bytes: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** Thumbnails for references restored from the library, which have no file. */
  const thumbs = useRef(new Map<string, string | null>());
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [canReadClips, setCanReadClips] = useState(false);

  useEffect(() => {
    void mediaTools().then((t) => setCanReadClips(t.ffmpeg && t.ffprobe));
  }, []);

  useEffect(() => {
    void loadLibrary().then(setLibrary);
  }, []);

  // An object URL holds the file open until it is revoked, so each one is
  // released as soon as another reference takes its place.
  useEffect(() => {
    const file = activeRef ? held.current.get(activeRef) : undefined;
    if (!file) {
      // No file, but perhaps a thumbnail kept from when there was one.
      setPreview(activeRef ? (thumbs.current.get(activeRef) ?? null) : null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [activeRef, batch]);

  const refreshCache = (): void => {
    void cacheStats().then(setCache);
  };
  useEffect(refreshCache, []);
  const [running, setRunning] = useState(false);
  // Files and their extracted IRs live outside React state: neither is
  // serialisable, and neither belongs in a render.
  /** The dropped files themselves, kept so a preview has bytes to show. */
  const held = useRef(new Map<string, File>());
  const results = useRef(new Map<string, PromptIR>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    secretStatus(ANTHROPIC_KEY).then(
      (s) => setHasKey(s.stored),
      () => setHasKey(false),
    );
  }, [settingsOpen]);

  useEffect(() => {
    const onSpend = (e: Event): void => setSpent((e as CustomEvent<number>).detail);
    window.addEventListener('dialect:spend', onSpend);
    return () => window.removeEventListener('dialect:spend', onSpend);
  }, []);

  // What the window was showing last time. The files themselves cannot come
  // back — a dropped file is gone once the page reloads — so this restores the
  // record and their results, and the cache makes re-reading them free.
  const restored = useRef(false);
  useEffect(() => {
    void loadSession().then((session) => {
      restored.current = true;
      if (!session) return;

      if (registry.profiles.has(session.target)) setTarget(session.target);
      if (session.ir) setIrText(JSON.stringify(session.ir, null, 2));
      setSpent(session.spentUsd);

      if (session.items.length > 0) {
        for (const item of session.items) {
          if (item.ir) results.current.set(item.id, item.ir);
        }
        setBatch(
          session.items.map(({ ir: _ir, ...item }) => ({
            ...item,
            // Nothing is staged after a restart: the files are gone.
            state: item.state === 'done' ? ('done' as const) : ('failed' as const),
            ...(item.state === 'done' ? {} : { error: 'not read before the window closed' }),
          })),
        );
      }
    });
  }, []);

  // Saved after every change, but never before the restore has run — an empty
  // first render must not overwrite what is on disk.
  useEffect(() => {
    if (!restored.current) return;

    const session: Session = {
      version: SESSION_VERSION,
      target,
      items: batch.map((item) => {
        const ir = results.current.get(item.id);
        return ir ? { ...item, ir } : item;
      }),
      spentUsd: spent,
      // Parsed here rather than reaching for the memo below: an effect that
      // refers to something declared a hundred lines later reads like a bug.
      ...(() => {
        const current = parseIR(irText);
        return 'error' in current ? {} : { ir: current.ir };
      })(),
    };
    void saveSession(session);
  }, [batch, target, spent, irText]);

  const readOne = async (file: File): Promise<PromptIR> => {
    const { ir: extracted, key, cached } = await extractFromImage(
      gateway,
      { mediaType: file.type, base64: await toBase64(file) },
      { reference: file.name },
    );

    // Filed under a name and a picture, so what was paid for can be found
    // again. A cached read still refreshes the date — it was used today.
    const thumb = await thumbnail(file);
    const entry: LibraryEntry = {
      key,
      ref: file.name,
      readAt: new Date().toISOString(),
      ...(thumb ? { thumb } : {}),
    };
    setLibrary(await rememberRead(entry));
    if (cached) setExtractError(null);

    return extracted;
  };

  const showIR = (next: PromptIR): void => {
    setIrText(JSON.stringify(next, null, 2));
    setDisabled(new Set());
    setSelected(null);
  };

  /**
   * Anything dropped joins the list at the top and stays for the session.
   *
   * One reference is read straight away — a single deliberate act. Several are
   * staged and wait for a decision, because a dozen is a spend worth seeing
   * before it happens.
   */
  const takeFiles = async (incoming: File[]): Promise<void> => {
    setExtractError(null);

    const usable = incoming.filter((f) => READABLE.has(f.type));
    const rejected = incoming.length - usable.length;

    if (usable.length === 0) {
      setExtractError(
        `Nothing readable there. Drop PNG, JPEG, WebP or GIF${rejected > 0 ? ` — ${rejected} file(s) were something else` : ''}.`,
      );
      return;
    }

    // Names are the identity, so dropping the same file twice does not read it
    // twice or split the list.
    const fresh = usable.filter((f) => !held.current.has(f.name));
    if (fresh.length === 0) {
      setExtractError(
        usable.length === 1
          ? `${usable[0]!.name} is already in the list.`
          : 'Those are all in the list already.',
      );
      setActiveRef(usable[0]!.name);
      return;
    }
    if (rejected > 0) setExtractError(`Skipped ${rejected} file(s) that were not images.`);

    for (const file of fresh) held.current.set(file.name, file);
    const mark = (id: string, patch: Partial<BatchItem>): void =>
      setBatch((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    if (fresh.length === 1) {
      const file = fresh[0]!;
      setBatch((prev) => [{ id: file.name, name: file.name, state: 'running' }, ...prev]);
      setActiveRef(file.name);
      setExtracting(file.name);

      try {
        const ir = await readOne(file);
        results.current.set(file.name, ir);
        showIR(ir);
        setPromptOf(file.name);
        mark(file.name, { state: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExtractError(message);
        mark(file.name, { state: 'failed', error: message });
      } finally {
        setExtracting(null);
        refreshCache();
      }
      return;
    }

    setBatch((prev) => [
      ...fresh.map((f) => ({ id: f.name, name: f.name, state: 'staged' as const })),
      ...prev,
    ]);
    // Show the first straight away, so the set can be looked through before
    // anyone decides to pay for it.
    setActiveRef(fresh[0]!.name);
  };

  const runBatch = async (): Promise<void> => {
    setExtractError(null);
    setRunning(true);

    const controller = new AbortController();
    abort.current = controller;

    const waiting = batch.filter((i) => i.state === 'staged' || i.state === 'queued');
    const state = createQueue(waiting.map((i) => ({ id: i.id, ref: i.id })));

    try {
      await runQueue(state, {
        concurrency: 3,
        signal: controller.signal,
        onChange: (s) => {
          const byId = new Map(s.items.map((i) => [i.id, i]));
          setBatch((prev) =>
            prev.map((item) => {
              const run = byId.get(item.id);
              return run
                ? { ...item, state: run.state, ...(run.error ? { error: run.error } : {}) }
                : item;
            }),
          );
        },
        work: async (item) => {
          const file = held.current.get(item.id);
          if (!file) throw new Error('that file is no longer here');
          results.current.set(item.id, await readOne(file));
          return item.id;
        },
      });

      if (state.stoppedBecause) setExtractError(state.stoppedBecause);

      // Open the first one that worked, so the run ends on something to look at.
      const first = state.items.find((i) => i.state === 'done');
      if (first) {
        const ir = results.current.get(first.id);
        if (ir) {
          showIR(ir);
          setActiveRef(first.id);
          setPromptOf(first.id);
        }
      }
    } finally {
      abort.current = null;
      setRunning(false);
      refreshCache();
    }
  };

  const openFromBatch = (id: string): void => {
    setActiveRef(id);
    // A reference that failed, or has not been read yet, still shows its
    // picture; there is simply no prompt to go with it.
    const ir = results.current.get(id);
    if (ir) {
      showIR(ir);
      setPromptOf(id);
    } else {
      setPromptOf(null);
    }
  };

  /** The finished references, compiled against whatever target is showing. */
  const finished = (): Array<{ id: string; base: string; ir: PromptIR; document: string }> =>
    batch
      .filter((item) => item.state === 'done')
      .flatMap((item) => {
        const ir = results.current.get(item.id);
        if (!ir) return [];
        const rendered = compile(ir, profile);
        return [
          {
            id: item.id,
            base: item.name.replace(/\.[^.]+$/, ''),
            ir,
            document: toDocument(rendered.render, profile, { title: ir.title }),
          },
        ];
      });

  const copyAll = async (): Promise<void> => {
    const all = finished();
    if (all.length === 0) return;
    await navigator.clipboard.writeText(all.map((f) => f.document).join('\n\n'));
    setSavedTo(null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const saveAll = async (): Promise<void> => {
    setExtractError(null);
    const all = finished();
    if (all.length === 0) return;

    // The IR goes beside each prompt, so an edit can be picked up later
    // without paying to read the reference again.
    const files: OutFile[] = all.flatMap((f) => [
      { name: `${f.base}_${profile.id}.txt`, contents: f.document },
      { name: `${f.base}_${profile.id}.ir.json`, contents: `${JSON.stringify(f.ir, null, 2)}\n` },
    ]);

    try {
      const dir = await savePromptsTo(files);
      if (dir) {
        setSavedTo(dir);
        void showFolder(dir);
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Read a clip: frames out of the host, one question to the model.
   *
   * The name is the path's last segment, which is what everything else keys on
   * — the same name in the list, the library and the saved file.
   */
  const takeVideo = async (): Promise<void> => {
    setExtractError(null);

    let path: string | null;
    try {
      path = await pickVideo();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!path) return;

    const name = path.split(/[\\/]/).pop() ?? path;
    if (held.current.has(name) || batch.some((i) => i.id === name)) {
      setExtractError(`${name} is already in the list.`);
      setActiveRef(name);
      return;
    }

    setBatch((prev) => [{ id: name, name, state: 'running' as const }, ...prev]);
    setActiveRef(name);
    setExtracting(name);

    try {
      const probe = await probeVideo(path);
      const frames = await videoFrames(path, 5);

      // The first frame stands in for the clip, since there is no file object
      // to make an object URL from.
      const thumb = `data:image/jpeg;base64,${frames[0]!.base64}`;
      thumbs.current.set(name, thumb);

      const { ir, key } = await extractFromVideo(
        gateway,
        frames.map((f) => ({ mediaType: 'image/jpeg', base64: f.base64 })),
        { reference: name, durationS: probe.duration_s, aspectRatio: probe.aspect_ratio },
      );

      results.current.set(name, ir);
      showIR(ir);
      setPromptOf(name);
      setBatch((prev) => prev.map((i) => (i.id === name ? { ...i, state: 'done' } : i)));
      setLibrary(await rememberRead({ key, ref: name, readAt: new Date().toISOString(), thumb }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExtractError(message);
      setBatch((prev) =>
        prev.map((i) => (i.id === name ? { ...i, state: 'failed', error: message } : i)),
      );
    } finally {
      setExtracting(null);
      refreshCache();
    }
  };

  /**
   * Bring back a reference read earlier. The picture is the thumbnail that was
   * kept — the original file is long gone — and the prompt comes from the
   * answer already in the cache, so this costs nothing.
   */
  const restoreFromLibrary = async (entry: LibraryEntry): Promise<void> => {
    setRestoring(entry.key);
    setExtractError(null);

    try {
      const answer = await cachedAnswer(entry.key);
      const scene = ExtractedScene.safeParse(answer);
      if (!scene.success) {
        setExtractError(
          `The stored answer for ${entry.ref} no longer matches what the app expects. ` +
            `Reading it again would cost money, so nothing was changed.`,
        );
        return;
      }

      const ir = sceneToIR(scene.data, { reference: entry.ref });
      results.current.set(entry.ref, ir);
      thumbs.current.set(entry.ref, entry.thumb ?? null);

      setBatch((prev) => [
        { id: entry.ref, name: entry.ref, state: 'done' as const, cached: true },
        ...prev.filter((i) => i.id !== entry.ref),
      ]);
      setActiveRef(entry.ref);
      setPromptOf(entry.ref);
      showIR(ir);
    } finally {
      setRestoring(null);
    }
  };

  /** Back to nothing: no references, no results, the example document again. */
  const resetSession = (): void => {
    held.current.clear();
    results.current.clear();
    setBatch([]);
    setActiveRef(null);
    setPromptOf(null);
    setSavedTo(null);
    setExtractError(null);
    showIR(exampleFor(profile.family) as PromptIR);
  };

  const parsed = useMemo(() => parseIR(irText), [irText]);
  const profile = useMemo(() => getProfile(registry, target), [target]);

  const compiled = useMemo(() => {
    if ('error' in parsed) return null;
    try {
      return compile(parsed.ir, profile);
    } catch (err) {
      return { failure: (err as Error).message } as const;
    }
  }, [parsed, profile]);

  const isOn = (s: Segment): boolean => !disabled.has(s.label);

  const toggle = (label: string): void => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
    setCopied(false);
  };

  const render = compiled && !('failure' in compiled) ? compiled.render : null;
  const selectedSegment = render?.segments.find((s) => s.label === selected) ?? null;
  const promptText = render ? assembleText(render, isOn) : '';

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const findings = render && compiled && !('failure' in compiled)
    ? [...compiled.findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    : [];

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">Dialect</span>
        <span className="ver" title="version">{__APP_VERSION__}</span>
        <label className="field">
          <span className="field-k">Target</span>
          <select
            title={profile.routingNote?.trim().replace(/\s+/g, ' ')}
            value={target}
            onChange={(e) => {
              const next = getProfile(registry, e.target.value);
              if (next.family !== profile.family && batch.length === 0) {
                setIrText(JSON.stringify(exampleFor(next.family), null, 2));
              }
              setTarget(e.target.value);
              setDisabled(new Set());
              setSelected(null);
              setCopied(false);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.family}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost bar-end" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}

      <main className="panes">
        <section
          className={`pane${dragging ? ' dropping' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void takeFiles([...e.dataTransfer.files]);
          }}
        >
          <div className="pane-h">
            <h2>References</h2>
            <button className="ghost" onClick={resetSession}>
              Reset
            </button>
          </div>

          <div className={`drop${dragging ? ' over' : ''}`}>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                void takeFiles([...(e.target.files ?? [])]);
                // Cleared so choosing the same file twice fires again.
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              hidden
              // Not in the TS DOM types, but every Chromium webview has it.
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                void takeFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />

            {extracting ? (
              <p className="drop-busy">Reading {extracting}…</p>
            ) : (
              <>
                <p className="drop-t">Drop references here — one, or a folder of them</p>
                <div className="drop-b">
                  <button className="solid" onClick={() => fileInput.current?.click()}>
                    Upload reference
                  </button>
                  <button className="ghost" onClick={() => folderInput.current?.click()}>
                    Upload folder
                  </button>
                  <button
                    className="ghost"
                    disabled={!canReadClips}
                    title={
                      canReadClips
                        ? 'Read a video clip as one shot'
                        : 'Needs ffmpeg on PATH to read a clip'
                    }
                    onClick={() => void takeVideo()}
                  >
                    Upload clip
                  </button>
                </div>
                <p className="drop-n">
                  PNG, JPEG, WebP or GIF{canReadClips ? ' · MP4, MOV, WebM' : ''}
                  {hasKey === false ? (
                    <>
                      {' · needs a key in '}
                      <button className="link" onClick={() => setSettingsOpen(true)}>
                        Settings
                      </button>
                    </>
                  ) : null}
                </p>
              </>
            )}

            <p className="drop-n money">
              <span>${spent.toFixed(4)} spent this session</span>
              {cache && cache.entries > 0 ? (
                <>
                  <span className="dot">·</span>
                  <span title="Reading any of these again is free">
                    {cache.entries} kept, {(cache.bytes / 1024).toFixed(0)} kB
                  </span>
                  <button
                    className="link"
                    title="Reading those references again would cost money"
                    onClick={() =>
                      void clearCache().then(async () => {
                        refreshCache();
                        setSpent(0);
                        setLibrary(await loadLibrary());
                      })
                    }
                  >
                    forget them
                  </button>
                </>
              ) : null}
            </p>

          </div>

          {extractError ? <p className="err">{extractError}</p> : null}

          {preview && activeRef ? (
            <figure className="preview">
              <img src={preview} alt={`The reference being worked on: ${activeRef}`} />
              <figcaption>{activeRef}</figcaption>
            </figure>
          ) : null}

          <References
            items={batch}
            selected={activeRef}
            running={running}
            onRun={() => void runBatch()}
            onStop={() => abort.current?.abort()}
            onSelect={openFromBatch}
          />

          <Library
            entries={library.filter((e) => !batch.some((i) => i.id === e.ref))}
            busy={restoring}
            onRestore={(entry) => void restoreFromLibrary(entry)}
          />
        </section>

        <section className="pane">
          <div className="pane-h">
            <h2>
              Prompt
              {promptOf ? <span className="pane-of">{promptOf}</span> : null}
            </h2>
            <button className="ghost" onClick={() => void copy()} disabled={!promptText}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <PromptActions
            done={batch.filter((i) => i.state === 'done').length}
            saved={savedTo}
            onSaveAll={() => void saveAll()}
            onCopyAll={() => void copyAll()}
          />

          {compiled && 'failure' in compiled ? (
            <p className="err">{compiled.failure}</p>
          ) : render ? (
            <>
              <div className="chips">
                {render.segments.map((s) => (
                  <span
                    key={s.label}
                    className={`chip${isOn(s) ? '' : ' off'}${s.source === 'rule' ? ' ruled' : ''}${
                      selected === s.label ? ' sel' : ''
                    }`}
                  >
                    <button
                      className="chip-t"
                      title="Open the fields behind this block"
                      onClick={() => setSelected(selected === s.label ? null : s.label)}
                    >
                      {s.label}
                    </button>
                    <button
                      className="chip-x"
                      title={isOn(s) ? 'Leave this block out' : 'Put this block back'}
                      aria-label={isOn(s) ? `Leave ${s.label} out` : `Put ${s.label} back`}
                      onClick={() => toggle(s.label)}
                    >
                      {isOn(s) ? '\u00d7' : '+'}
                    </button>
                  </span>
                ))}
              </div>

              {selectedSegment && !('error' in parsed) ? (
                <Fields
                  ir={parsed.ir}
                  segment={selectedSegment}
                  onChange={(next) => setIrText(JSON.stringify(next, null, 2))}
                />
              ) : null}

              <pre className="out">{promptText}</pre>

              {render.negative ? (
                <div className="block">
                  <h3>Negative</h3>
                  <pre className="out sub">{render.negative}</pre>
                </div>
              ) : null}

              {Object.keys(render.params).length > 0 ? (
                <div className="block">
                  <h3>Settings</h3>
                  <dl className="params">
                    {Object.entries(render.params).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              <div className="block">
                <h3>
                  Rules
                  {findings.length > 0 ? <span className="count">{findings.length}</span> : null}
                </h3>
                {findings.length === 0 ? (
                  <p className="quiet">Nothing to flag.</p>
                ) : (
                  <ul className="findings">
                    {findings.map((f, i) => (
                      <li key={`${f.ruleId}-${i}`} className={f.level}>
                        <span className="lvl">{f.level}</span>
                        <div>
                          <p className="msg">{f.message}</p>
                          {f.fix ? <p className="fix">{f.fix}</p> : null}
                          <p className="rid">{f.ruleId}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}

          <div className="block doc">
            <h3>Document</h3>
            <textarea
              className="ir"
              spellCheck={false}
              value={irText}
              onChange={(e) => setIrText(e.target.value)}
            />
            {'error' in parsed ? (
              <p className="err">This is not valid JSON: {parsed.error}</p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
