import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { toDocument } from '../src/renderers/document.ts';

const registry = await loadBuiltinRegistry();
const target = (id: string) => getProfile(registry, id);

const SONG: PromptIR = {
  ...emptyIR('audio'),
  title: 'Saloon closing time',
  audio: {
    genre: 'dusty americana',
    bpm: 78,
    musicalKey: 'A minor',
    instruments: ['brushed drums', 'upright bass', 'a lap steel a room away'],
    structure: ['intro', 'verse', 'chorus', 'outro'],
    lyrics: '[Verse]\nThe doors still swing an hour after closing\n[Chorus]\nNobody left to tell it to',
    mix: 'warm tape, gentle compression',
  },
  mood: { emotion: 'world-weary' },
};

describe('Suno', () => {
  it('keeps style and lyrics apart, because it reads them apart', () => {
    const { render } = compile(SONG, target('suno'));

    const style = render.segments.find((s) => s.label === 'Style')?.text ?? '';
    const lyrics = render.segments.find((s) => s.label === 'Lyrics')?.text ?? '';

    expect(style).toContain('dusty americana');
    expect(style).toContain('78 BPM');
    expect(style).toContain('A minor');
    expect(style).toContain('brushed drums');

    // The lyrics box is a script: anything in it gets sung, so nothing
    // descriptive may leak into it.
    expect(lyrics).toBe(SONG.audio?.lyrics);
    expect(lyrics).not.toContain('dusty americana');
    expect(lyrics).not.toContain('BPM');
  });

  it('says it is instrumental rather than leaving the box empty', () => {
    const { audio: _dropped, ...rest } = SONG;
    const instrumental: PromptIR = { ...rest, audio: { genre: 'lo-fi' } };

    const { render } = compile(instrumental, target('suno'));
    expect(render.segments.find((s) => s.label === 'Lyrics')?.text).toBe('[Instrumental]');
  });

  it('turns a bare number into a tempo anyone would write', () => {
    const { render } = compile(SONG, target('suno'));
    expect(render.text).toContain('78 BPM');
    expect(render.text).not.toMatch(/(^|[^\d])78($|[^\d\sB])/);
  });
});

describe('ElevenLabs', () => {
  const LINE: PromptIR = {
    ...emptyIR('audio'),
    subject: {
      entities: [
        { id: 'e1', type: 'person', name: 'the bartender', description: 'a stout man in his sixties, unhurried' },
      ],
    },
    dialogue: [
      { speaker: 'e1', line: 'Careful, it is hot.', delivery: ['warm', 'unhurried', 'a little amused'] },
    ],
  };

  it('speaks the line and describes only the delivery', () => {
    const { render } = compile(LINE, target('elevenlabs'));

    expect(render.segments.find((s) => s.label === 'Text')?.text).toBe('Careful, it is hot.');
    const delivery = render.segments.find((s) => s.label === 'Delivery')?.text ?? '';
    expect(delivery).toContain('warm');
    expect(delivery).toContain('a little amused');
    // Direction is not script: none of it may end up spoken.
    expect(render.segments.find((s) => s.label === 'Text')?.text).not.toContain('warm');
  });

  it('carries who is speaking, so a voice can be chosen', () => {
    const { render } = compile(LINE, target('elevenlabs'));
    expect(render.segments.find((s) => s.label === 'Voice')?.text).toContain('stout man');
  });

  it('says there is nothing to say rather than rendering an empty box', () => {
    const { render } = compile(emptyIR('audio'), target('elevenlabs'));
    expect(render.segments.find((s) => s.label === 'Text')?.text).toBe('(nothing to say yet)');
  });
});

describe('Stable Audio', () => {
  it('is one line with no labels, because it takes a description', () => {
    const { render } = compile(SONG, target('stable-audio'));

    expect(render.text).not.toContain('Prompt:');
    expect(render.text.split('\n')).toHaveLength(1);
    expect(render.text).toContain('dusty americana');
    expect(render.text).toContain('78 BPM');
  });

  it('leaves the lyrics out — it does not sing', () => {
    const { render } = compile(SONG, target('stable-audio'));
    expect(render.text).not.toContain('doors still swing');
  });
});

describe('one song, three dialects', () => {
  it('renders differently for each without touching the document', () => {
    const suno = compile(SONG, target('suno')).render.text;
    const stable = compile(SONG, target('stable-audio')).render.text;

    expect(suno).not.toBe(stable);
    expect(suno).toContain('Lyrics:');
    expect(stable).not.toContain('Lyrics');
  });

  it('produces a document worth saving', () => {
    const profile = target('suno');
    const { render } = compile(SONG, profile);
    const document = toDocument(render, profile, { title: SONG.title });

    expect(document.startsWith('Suno prompt — Saloon closing time')).toBe(true);
    expect(document.endsWith('\n')).toBe(true);
  });

  it('is not tripped up by the video rules', () => {
    // Those rules guard against things audio cannot do; none should fire here.
    for (const id of ['suno', 'elevenlabs', 'stable-audio']) {
      const result = compile(SONG, target(id));
      expect(result.blocked, `${id} blocked a song`).toBe(false);
      expect(
        result.findings.map((f) => f.ruleId),
        `${id} raised something`,
      ).not.toContain('one-action-one-move');
    }
  });
});

describe('every card in the registry', () => {
  it('renders something for a document of its own modality', async () => {
    const byModality: Record<string, PromptIR> = {
      audio: SONG,
      image: { ...emptyIR('image'), subject: { headline: 'a bottle on slate' } },
      video: {
        ...emptyIR('video'),
        subject: { headline: 'a cowboy at the bar', action: 'leans on the counter' },
        environment: { location: 'a saloon' },
        lighting: { key: 'oil lanterns' },
      },
    };

    for (const profile of registry.profiles.values()) {
      const ir = byModality[profile.family];
      if (!ir) continue;

      const result = compile(ir, profile);
      expect(result.render.text.trim(), `${profile.id} rendered nothing`).not.toBe('');
      expect(result.blocked, `${profile.id} blocked a plain document`).toBe(false);
    }
  });

  it('gives every card a routing note and a source', () => {
    for (const profile of registry.profiles.values()) {
      expect(profile.routingNote, `${profile.id} has no routing note`).toBeTruthy();
      expect(profile.source?.dated, `${profile.id} is undated`).toBeTruthy();
    }
  });
});
