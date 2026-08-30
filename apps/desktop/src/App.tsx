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
  compileSequence,
  sequenceFromIR,
  sequenceToDocument,
  extractFromAudio,
  extractFromImages,
  extractFromVideo,
  expandIdea,
  fillTemplate,
  ideaLabel,
  applyTemplate,
  createLibrary,
  learnTemplate,
  templateToYaml,
  toDocument as renderDocument,
  type CastSize,
  type Template,
  type TemplateKind,
  kindOf,
  modalityOfFamily,
  kindOfMediaType,
  mediaTypeOf,
  nameOf,
  type ReferenceKind,
  Gateway,
  ExtractedScene,
  getProfile,
  sceneToIR,
  toDocument,
  type Finding,
  type PromptIR,
  type Segment,
  type Sequence,
  type SequenceShot,
} from '@dialect/core';
import { createQueue, runQueue } from '@dialect/core';
import { PromptActions, References, type BatchItem } from './Batch.tsx';
import { Library } from './Library.tsx';
import { Fields } from './Fields.tsx';
import { Input } from './Input.tsx';
import { Templates } from './Templates.tsx';
import { Shots } from './Shots.tsx';
import { HostProvider } from './provider.ts';
import { ANTHROPIC_KEY, secretStatus } from './secrets.ts';
import {
  cachedAnswer,
  cacheStats,
  clearCache,
  hostCache,
  loadLibrary,
  loadSession,
  hasDesktop,
  measureAudio,
  mediaTools,
  pickFolder,
  pickReferences,
  readFile,
  scanFolder,
  thumbOf,
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
import {
  deleteTemplate,
  libraryWith,
  listTemplates,
  openTemplatesFolder,
  saveTemplate,
  templatesForModality,
} from './templates.ts';
import { record, transcribe, voiceTools, type Recording } from './voice.ts';
import videoExample from '../../../packages/core/tests/golden/cowboy-saloon.ir.json';
import imageExample from './example.image.json';
import audioExample from './example.audio.json';

const LEVEL_ORDER: Record<Finding['level'], number> = { block: 0, warn: 1, autofix: 2 };

/**
 * A reference, however it arrived.
 *
 * A file chosen through the dialog has a path, which is what ffmpeg needs. A
 * file dropped on the page has bytes and no path — fine for a still, which the
 * web view can encode itself, and for a clip only after the host has written it
 * down somewhere ffmpeg can reach.
 */
interface Source {
  kind: ReferenceKind;
  name: string;
  path?: string;
  file?: File;
}

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

/**
 * Below this, a measurement is a number the arithmetic produced rather than
 * something the track actually does. Stated as fact it would mislead.
 */
const SURE_ENOUGH = 0.25;

/** More stills than this in one prompt stops adding anything and starts costing. */
const MAX_ATTACHED = 4;

export function App() {
  const [irText, setIrText] = useState(() => JSON.stringify(imageExample, null, 2));
  const [target, setTarget] = useState('nano-banana-2');
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  /** What the user typed instead of, or as well as, bringing a reference. */
  const [idea, setIdea] = useState('');
  /** References attached to what is being written, not yet read. */
  const [attached, setAttached] = useState<Source[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [writing, setWriting] = useState(false);
  const asked = useRef({ note: '', templateId: '' });

  const [canSpeak, setCanSpeak] = useState(false);
  const [speakNote, setSpeakNote] = useState('Checking what can transcribe…');
  const [recording, setRecording] = useState(false);
  const [hearing, setHearing] = useState(false);
  const recorder = useRef<Recording | null>(null);

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [custom, setCustom] = useState<Template[]>([]);
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<Template | null>(null);
  const [learnedPreview, setLearnedPreview] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

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

  /**
   * A sequence is stored as its shots alone, never as a snapshot of the world.
   *
   * The world *is* the document above, so editing the document changes every
   * shot at once — which is the whole reason the world is kept in one place.
   */
  const [shots, setShots] = useState<SequenceShot[] | null>(null);
  const [openShot, setOpenShot] = useState<string | null>(null);
  const [canReadMedia, setCanReadClips] = useState(false);

  useEffect(() => {
    void mediaTools().then((t) => setCanReadClips(t.ffmpeg && t.ffprobe));
  }, []);

  useEffect(() => {
    void loadLibrary().then(setLibrary);
  }, []);

  useEffect(() => {
    void listTemplates().then(setCustom, () => setCustom([]));
  }, []);

  useEffect(() => {
    void voiceTools().then((t) => {
      setCanSpeak(t.ready);
      setSpeakNote(
        t.ready
          ? t.whisper
            ? `Transcribed here by ${t.whisper}.`
            : 'Transcribed by the service your key is for.'
          : 'Speaking needs something that can transcribe: whisper on PATH, or a transcription key in Settings.',
      );
    });
  }, [settingsOpen]);

  // An object URL holds the file open until it is revoked, so each one is
  // released as soon as another reference takes its place.
  useEffect(() => {
    const source = activeRef ? held.current.get(activeRef) : undefined;

    if (source?.file) {
      const url = URL.createObjectURL(source.file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }

    // Whatever was kept from an earlier look, shown at once so the pane does
    // not blink while the host draws a new one.
    setPreview(activeRef ? (thumbs.current.get(activeRef) ?? null) : null);
    if (!source?.path || thumbs.current.has(source.name)) return;

    let live = true;
    void thumbOf(source.path).then((thumb) => {
      thumbs.current.set(source.name, thumb ?? null);
      if (live && thumb) setPreview(thumb);
    });
    return () => {
      live = false;
    };
  }, [activeRef, batch]);

  const refreshCache = (): void => {
    void cacheStats().then(setCache);
  };
  useEffect(refreshCache, []);
  const [running, setRunning] = useState(false);
  // Files and their extracted IRs live outside React state: neither is
  // serialisable, and neither belongs in a render.
  /** The references themselves, kept so a preview has something to show. */
  const held = useRef(new Map<string, Source>());
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

  /**
   * Read one reference, whichever of the three it is.
   *
   * The kind decides how it is read and nothing else: what happens around the
   * reading — filing it in the library under a name and a picture, clearing a
   * stale error when the answer came free — is the same either way.
   */
  const readOne = async (sources: Source[]): Promise<PromptIR> => {
    const source = sources[0]!;
    const { ir, key, thumb, cached } = await readByKind(sources);

    // Filed under a name and a picture, so what was paid for can be found
    // again. A cached read still refreshes the date — it was used today.
    if (thumb) thumbs.current.set(source.name, thumb);
    setLibrary(
      await rememberRead({
        key,
        ref: source.name,
        readAt: new Date().toISOString(),
        ...(thumb ? { thumb } : {}),
      }),
    );
    if (cached) setExtractError(null);

    return ir;
  };

  /**
   * One reading, of everything that was brought and everything that was said.
   *
   * A note and a template are not second passes over the answer: they go into
   * the same question, because a document assembled from two answers agrees
   * with neither of them. What the kind decides is only how the reference is
   * turned into something a model can look at.
   */
  const readByKind = async (
    sources: Source[],
  ): Promise<{ ir: PromptIR; key: string; cached: boolean; thumb?: string }> => {
    const first = sources[0];
    if (!first) throw new Error('nothing to read');

    const { note, templateId: template } = asked.current;
    const reference =
      sources.length === 1 ? first.name : `${first.name} +${sources.length - 1}`;

    const through = async (
      parts: Array<{ mediaType: string; base64: string }>,
      plain: () => Promise<{ ir: PromptIR; key: string; cached: boolean }>,
    ) =>
      template
        ? await fillTemplate(gateway, note, activeLibrary, template, parts)
        : await plain();

    if (first.kind === 'video') {
      const path = first.path!;
      const probe = await probeVideo(path);
      const frames = await videoFrames(path, 5);
      const parts = frames.map((f) => ({ mediaType: 'image/jpeg', base64: f.base64 }));

      const { ir, key, cached } = await through(parts, () =>
        extractFromVideo(gateway, parts, {
          reference,
          durationS: probe.duration_s,
          aspectRatio: probe.aspect_ratio,
          ...(note ? { note } : {}),
        }),
      );
      // The first frame stands in for the clip.
      return { ir, key, cached, thumb: `data:image/jpeg;base64,${frames[0]!.base64}` };
    }

    if (first.kind === 'audio') {
      const m = await measureAudio(first.path!);
      const parts = m.pictures.map((p) => ({ mediaType: 'image/jpeg', base64: p.base64 }));

      const { ir, key, cached } = await through(parts, () =>
        extractFromAudio(gateway, parts, {
          reference,
          durationS: m.probe.duration_s,
          ...(note ? { note } : {}),
          ...(m.tempo && m.tempo.confidence > SURE_ENOUGH ? { bpm: m.tempo.bpm } : {}),
          ...(m.key && m.key.confidence > SURE_ENOUGH ? { musicalKey: m.key.name } : {}),
          ...(m.lufs !== null ? { lufs: m.lufs } : {}),
          ...(m.lra !== null ? { lra: m.lra } : {}),
          ...(m.probe.title ? { title: m.probe.title } : {}),
          ...(m.probe.artist ? { artist: m.probe.artist } : {}),
          ...(m.probe.genre ? { taggedGenre: m.probe.genre } : {}),
        }),
      );

      const picture = m.pictures[0];
      return {
        ir,
        key,
        cached,
        ...(picture ? { thumb: `data:image/jpeg;base64,${picture.base64}` } : {}),
      };
    }

    const parts = await Promise.all(
      sources.map(async (source) => ({
        mediaType: source.file?.type || mediaTypeOf(source.name),
        base64: source.file ? await toBase64(source.file) : (await readFile(source.path!)).base64,
      })),
    );

    const { ir, key, cached } = await through(parts, () =>
      extractFromImages(gateway, parts, { reference, ...(note ? { note } : {}) }),
    );

    const thumb = first.file ? await thumbnail(first.file) : await thumbOf(first.path!);
    return { ir, key, cached, ...(thumb ? { thumb } : {}) };
  };

  const showIR = (next: PromptIR): void => {
    setIrText(JSON.stringify(next, null, 2));
    setDisabled(new Set());
    setSelected(null);
    // Shots are differences from a world. A new document is a new world, and
    // the old differences mean nothing against it.
    setShots(null);
    setOpenShot(null);
  };

  /**
   * Anything dropped joins the list at the top and stays for the session.
   *
   * One reference is read straight away — a single deliberate act. Several are
   * staged and wait for a decision, because a dozen is a spend worth seeing
   * before it happens.
   */
  const takeSources = async (incoming: Source[], skipped = 0): Promise<void> => {
    setExtractError(null);

    if (incoming.length === 0) {
      if (skipped > 0) {
        setExtractError(
          `Nothing readable there — ${skipped} file(s) were something this cannot read.`,
        );
      }
      return;
    }

    // Names are the identity, so bringing the same file twice does not read it
    // twice or split the list.
    const fresh = incoming.filter((source) => !held.current.has(source.name));
    if (fresh.length === 0) {
      setExtractError(
        incoming.length === 1
          ? `${incoming[0]!.name} is already in the list.`
          : 'Those are all in the list already.',
      );
      setActiveRef(incoming[0]!.name);
      return;
    }
    if (skipped > 0) setExtractError(`Skipped ${skipped} file(s) this cannot read.`);

    for (const source of fresh) held.current.set(source.name, source);
    const mark = (id: string, patch: Partial<BatchItem>): void =>
      setBatch((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    if (fresh.length === 1) {
      const source = fresh[0]!;
      setBatch((prev) => [{ id: source.name, name: source.name, state: 'running' }, ...prev]);
      setActiveRef(source.name);
      setExtracting(source.name);

      try {
        const ir = await readOne([source]);
        results.current.set(source.name, ir);
        showIR(ir);
        setPromptOf(source.name);
        mark(source.name, { state: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExtractError(message);
        mark(source.name, { state: 'failed', error: message });
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

  /**
   * The browser fallback: files from a plain `<input>`, which has bytes but no
   * path. Only reachable in the dev server, where there is no host to run
   * ffmpeg — so only stills can be read, and the rest says why.
   */
  const takeFiles = async (incoming: File[]): Promise<void> => {
    const sources: Source[] = [];
    let skipped = 0;
    let needsApp = 0;

    for (const file of incoming) {
      const kind = kindOfMediaType(file.type) ?? kindOf(file.name);
      if (!kind) skipped += 1;
      else if (kind === 'image') sources.push({ kind, name: file.name, file });
      else needsApp += 1;
    }

    attach(sources);
    if (skipped > 0) setExtractError(`Skipped ${skipped} file(s) this cannot read.`);

    if (needsApp > 0 && sources.length === 0) {
      setExtractError('Clips and tracks need the desktop app: a browser cannot reach ffmpeg.');
    }
  };

  /**
   * Chosen references are attached, not read.
   *
   * Nothing is spent until the button is pressed, because what a reference
   * costs depends on what is typed next to it — and because a picture and a
   * sentence go to the model together or not at all.
   *
   * Stills accumulate: a style reference and a character reference are two
   * pictures of one intention. A clip or a track is exclusive, because there is
   * no sensible reading of a song and a photograph at once.
   */
  const attach = (incoming: Source[]): void => {
    if (incoming.length === 0) return;
    setExtractError(null);

    setAttached((prev) => {
      const exclusive = incoming.find((s) => s.kind !== 'image');
      if (exclusive) return [exclusive];

      const kept = prev.filter((s) => s.kind === 'image');
      const fresh = incoming.filter((s) => !kept.some((k) => k.name === s.name));
      return [...kept, ...fresh].slice(0, MAX_ATTACHED);
    });
  };

  /** Files chosen through the dialog: every kind, by path. */
  const chooseReferences = async (): Promise<void> => {
    if (!hasDesktop()) {
      fileInput.current?.click();
      return;
    }

    try {
      const [sources, skipped] = sourcesFrom(await pickReferences(!canReadMedia));
      attach(sources);
      if (skipped > 0) setExtractError(`Skipped ${skipped} file(s) this cannot read.`);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    }
  };

  const chooseFolder = async (): Promise<void> => {
    if (!hasDesktop()) {
      folderInput.current?.click();
      return;
    }

    try {
      const dir = await pickFolder();
      if (!dir) return;

      const found = await scanFolder(dir);
      const [sources, skipped] = sourcesFrom(found.map((f) => f.path));
      if (sources.length === 0 && skipped === 0) {
        setExtractError('That folder is empty.');
        return;
      }
      await takeSources(sources, skipped);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Write a document from a few words.
   *
   * With no template the model invents the whole thing; with one it answers
   * that template's questions and the template decides the rest. Either way the
   * result lands in the document on the right, exactly where a reference would
   * have put it — there is only one kind of document, and nothing downstream
   * cares which way it arrived.
   */
  /**
   * The one action: whatever the words and the references add up to.
   *
   * With both, the reference is what exists and the words are what is wanted,
   * and they go as one question. With only one of them, that one is the whole
   * of it. A template, when chosen, decides everything neither of them said.
   */
  const makePrompt = async (): Promise<void> => {
    if (writing || (!idea.trim() && attached.length === 0)) return;

    setExtractError(null);
    setWriting(true);
    asked.current = { note: idea.trim(), templateId };

    const label =
      attached.length > 0
        ? attached[0]!.name
        : idea.trim()
          ? ideaLabel(idea)
          : (templates.find((t) => t.id === templateId)?.name ?? 'prompt');

    try {
      if (attached.length > 0) {
        // Held under its own name, so the list, the preview and the library all
        // agree about what this prompt came from.
        for (const source of attached) held.current.set(source.name, source);
        setBatch((prev) => [
          { id: label, name: label, state: 'running' as const },
          ...prev.filter((i) => i.id !== label),
        ]);
        setActiveRef(label);

        const ir = await readOne(attached);
        results.current.set(label, ir);
        showIR(ir);
        setPromptOf(label);
        setBatch((prev) => prev.map((i) => (i.id === label ? { ...i, state: 'done' } : i)));
        setAttached([]);
        return;
      }

      const { ir } = templateId
        ? await fillTemplate(gateway, idea, activeLibrary, templateId)
        : await expandIdea(gateway, idea, { modality: modalityOfFamily(profile.family) });

      results.current.set(label, ir);
      showIR(ir);
      // Nothing to preview and nothing to re-read: it belongs in the prompt
      // header and nowhere else.
      setActiveRef(null);
      setPromptOf(label);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExtractError(message);
      setBatch((prev) =>
        prev.map((i) => (i.id === label ? { ...i, state: 'failed', error: message } : i)),
      );
    } finally {
      setWriting(false);
      refreshCache();
    }
  };

  const startSpeaking = async (): Promise<void> => {
    setExtractError(null);
    try {
      recorder.current = await record();
      setRecording(true);
    } catch (err) {
      setExtractError(
        err instanceof Error
          ? `Could not start recording: ${err.message}`
          : 'Could not start recording.',
      );
    }
  };

  /**
   * Stop, transcribe, and put the words in the box rather than acting on them.
   *
   * Speech recognition is wrong often enough that spending money on what it
   * thought it heard, without anyone reading it first, would be a bad trade.
   */
  const stopSpeaking = async (): Promise<void> => {
    const current = recorder.current;
    if (!current) return;

    recorder.current = null;
    setRecording(false);
    setHearing(true);

    try {
      const { base64, extension } = await current.stop();
      const text = await transcribe(base64, extension);
      setIdea((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setHearing(false);
    }
  };

  // ------------------------------------------------------------ templates

  const activeLibrary = useMemo(() => libraryWith(custom), [custom]);

  const learnFromExample = async (
    example: string,
    kind: TemplateKind,
    cast: CastSize,
    name: string,
  ): Promise<void> => {
    setTemplateError(null);
    setLearning(true);

    try {
      const taken = [...activeLibrary.templates.keys()];
      const { template } = await learnTemplate(
        gateway,
        example,
        { kind, cast, ...(name.trim() ? { name: name.trim() } : {}) },
        taken,
      );

      setLearned(template);
      setLearnedPreview(previewOf(template));
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err));
    } finally {
      setLearning(false);
      refreshCache();
    }
  };

  /**
   * The template applied to the values the example itself used, compiled.
   *
   * This is the only honest check on a learned template: if it does not come
   * back reading like what was pasted in, the split between what varies and
   * what is fixed was drawn in the wrong place.
   */
  const previewOf = (template: Template): string | null => {
    try {
      const { ir } = applyTemplate(createLibrary([template], []), template.id);
      const family = template.modality === 'video' ? 'kling-3-omni' : 'nano-banana-2';
      const target = getProfile(registry, family);
      return renderDocument(compile(ir, target).render, target);
    } catch (err) {
      // A template that cannot be previewed can still be kept and edited by
      // hand, so this says why rather than refusing to show the template.
      return `This template could not be tried out: ${(err as Error).message}`;
    }
  };

  const keepTemplate = async (): Promise<void> => {
    if (!learned) return;
    setTemplateError(null);

    try {
      await saveTemplate(learned.id, templateToYaml(learned));
      setCustom(await listTemplates());
      setTemplateId(learned.id);
      setLearned(null);
      setLearnedPreview(null);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeTemplate = async (id: string): Promise<void> => {
    setTemplateError(null);
    try {
      await deleteTemplate(id);
      setCustom(await listTemplates());
      if (templateId === id) setTemplateId('');
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Paths to sources, dropping anything this app has no way to read. */
  const sourcesFrom = (paths: string[]): [Source[], number] => {
    const sources: Source[] = [];
    let skipped = 0;

    for (const path of paths) {
      const name = nameOf(path);
      const kind = kindOf(name);
      if (kind) sources.push({ kind, name, path });
      else skipped += 1;
    }
    return [sources, skipped];
  };

  const runBatch = async (): Promise<void> => {
    setExtractError(null);
    setRunning(true);
    // Whatever is in the box applies to every reference in the run: twenty
    // character sheets are twenty readings of one intention.
    asked.current = { note: idea.trim(), templateId };

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
          const source = held.current.get(item.id);
          if (!source) throw new Error('that file is no longer here');
          results.current.set(item.id, await readOne([source]));
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
    setAttached([]);
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

  /** Built fresh from the live document, so an edit above reaches every shot. */
  const sequence = useMemo<Sequence | null>(() => {
    if (!shots || 'error' in parsed) return null;
    return { ...sequenceFromIR(parsed.ir), shots };
  }, [shots, parsed]);

  const compiledSeq = useMemo(
    () => (sequence ? compileSequence(sequence, profile) : null),
    [sequence, profile],
  );

  const slug = (): string =>
    (parsed && !('error' in parsed) && parsed.ir.title ? parsed.ir.title : 'sequence')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'sequence';

  const copySequence = async (): Promise<void> => {
    if (!sequence || !compiledSeq) return;
    await navigator.clipboard.writeText(sequenceToDocument(sequence, profile, compiledSeq));
    setSavedTo(null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const saveSequence = async (): Promise<void> => {
    if (!sequence || !compiledSeq) return;
    setExtractError(null);

    const base = `${slug()}_${profile.id}`;
    // One file per shot, because they are pasted one at a time — plus the whole
    // thing in order, and the world, so it can be picked up again later.
    const files: OutFile[] = [
      { name: `${base}.txt`, contents: sequenceToDocument(sequence, profile, compiledSeq) },
      ...compiledSeq.shots.map((shot) => ({
        name: `${base}_${shot.id}.txt`,
        contents: toDocument(shot.render, profile, { title: `${slug()} ${shot.id}` }),
      })),
      { name: `${base}.ir.json`, contents: `${JSON.stringify(sequence, null, 2)}
` },
    ];

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
   * Only the templates that make sense for what is being made. A template that
   * cannot apply to the chosen target is not a choice, it is a mistake waiting.
   */
  const templates = useMemo(
    () => templatesForModality(activeLibrary, modalityOfFamily(profile.family)),
    [activeLibrary, profile.family],
  );

  useEffect(() => {
    // Switching from a video target to an image one leaves a video template
    // selected and unusable, so it is dropped rather than left to fail.
    if (templateId && !templates.some((t) => t.id === templateId)) setTemplateId('');
  }, [templates, templateId]);

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

      {templatesOpen ? (
        <Templates
          custom={custom}
          learning={learning}
          learned={learned}
          preview={learnedPreview}
          error={templateError}
          onLearn={(example, kind, cast, name) =>
            void learnFromExample(example, kind, cast, name)
          }
          onKeep={() => void keepTemplate()}
          onDiscard={() => {
            setLearned(null);
            setLearnedPreview(null);
          }}
          onDelete={(id) => void removeTemplate(id)}
          onOpenFolder={() => void openTemplatesFolder()}
          onClose={() => {
            setTemplatesOpen(false);
            setTemplateError(null);
          }}
        />
      ) : null}

      <main className="panes">
        <section className="pane">
          <div className="pane-h">
            <h2>References</h2>
            <button className="ghost" onClick={resetSession}>
              Reset
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*,audio/*"
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

          <Input
            idea={idea}
            attached={attached.map((a) => ({ name: a.name, kind: a.kind }))}
            templateId={templateId}
            templates={templates}
            working={writing ? 'Working…' : extracting ? `Reading ${extracting}…` : null}
            recording={recording}
            hearing={hearing}
            canSpeak={canSpeak}
            speakNote={speakNote}
            noKey={hasKey === false}
            onIdea={setIdea}
            onTemplate={setTemplateId}
            onGo={() => void makePrompt()}
            onRecord={() => void startSpeaking()}
            onStopRecording={() => void stopSpeaking()}
            onAttach={() => void chooseReferences()}
            onDetach={(name) => setAttached((prev) => prev.filter((a) => a.name !== name))}
            onFolder={() => void chooseFolder()}
            onTemplates={() => setTemplatesOpen(true)}
          />

          <div className="spend">
            {hasKey === false ? (
              <p className="drop-n">
                {'Nothing can be read or written until there is a key in '}
                <button className="link" onClick={() => setSettingsOpen(true)}>
                  Settings
                </button>
              </p>
            ) : null}

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

          {sequence && compiledSeq ? (
            <Shots
              sequence={sequence}
              compiled={compiledSeq}
              selected={openShot}
              saved={savedTo}
              onSelect={setOpenShot}
              onChange={(next) => setShots(next.shots)}
              onClear={() => {
                setShots(null);
                setOpenShot(null);
              }}
              onCopyAll={() => void copySequence()}
              onSaveAll={() => void saveSequence()}
            />
          ) : !('error' in parsed) && parsed.ir.modality !== 'audio' ? (
            <div className="block seq-start">
              <button
                className="ghost"
                onClick={() => {
                  const seeded = sequenceFromIR(parsed.ir);
                  setShots(seeded.shots);
                  setOpenShot(seeded.shots[0]?.id ?? null);
                }}
              >
                Make a sequence
              </button>
              <p className="quiet">Several shots that share this document.</p>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
