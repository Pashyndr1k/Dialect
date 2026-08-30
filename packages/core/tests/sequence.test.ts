import { describe, expect, it } from 'vitest';

import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import {
  addShot,
  checkSequence,
  compileSequence,
  expandShot,
  sequenceFromIR,
  sequenceRuntimeS,
  sequenceToDocument,
  updateShot,
  type Sequence,
} from '../src/sequence/index.ts';

const registry = await loadBuiltinRegistry();
const kling = getProfile(registry, 'kling-3-omni');

const COWBOY =
  'a weathered man in his late sixties, silver stubble, a dust-covered canvas duster, ' +
  'a hat brim worn soft at the edge';

const WORLD: PromptIR = {
  ...emptyIR('video'),
  subject: {
    headline: 'an aged cowboy at a saloon bar',
    entities: [{ id: 'e1', type: 'person', name: 'the cowboy', description: COWBOY, tracked: true }],
  },
  environment: {
    location: 'a frontier saloon',
    description: 'a long scratched counter, whiskey bottles against a cracked mirror',
    timeOfDay: 'mid-afternoon',
  },
  lighting: { key: 'warm oil lanterns from the ceiling beams', contrast: 'high' },
  palette: { grade: 'warm, muted' },
  style: { medium: 'film still', genre: 'western' },
  shot: { aspectRatio: '16:9', durationS: 5 },
};

const RULE = '-'.repeat(60);

/** Four shots of one man in one room — the thing a sequence has to hold. */
function saloon(): Sequence {
  let seq = sequenceFromIR(
    { ...WORLD, subject: { ...WORLD.subject, action: 'leans on the bar' } },
    'Closing time',
  );
  seq = updateShot(seq, 's1', {
    shot: { size: 'wide', aspectRatio: '16:9', durationS: 5 },
    cameraMove: { move: 'push-in', speed: 'slow' },
  });
  seq = addShot(seq, {
    action: 'lifts the glass without drinking from it',
    shot: { size: 'medium', durationS: 5 },
    cameraMove: { move: 'static' },
  });
  seq = addShot(seq, {
    action: 'turns his head towards the doors',
    shot: { size: 'close-up', durationS: 4 },
    cameraMove: { move: 'tracking', speed: 'slow' },
  });
  seq = addShot(seq, {
    action: 'sets the glass down on the counter',
    shot: { size: 'medium-close', durationS: 5 },
    cameraMove: { move: 'pull-back', speed: 'slow' },
  });
  return seq;
}

describe('a chain of four shots', () => {
  const compiled = compileSequence(saloon(), kling);

  it('holds the character across all four', () => {
    expect(compiled.shots).toHaveLength(4);
    for (const shot of compiled.shots) {
      expect(shot.render.text, `${shot.id} lost the character`).toContain(COWBOY);
    }
  });

  it('holds the location across all four', () => {
    for (const shot of compiled.shots) {
      expect(shot.render.text, `${shot.id} left the saloon`).toContain('a frontier saloon');
    }
  });

  it('gives each shot its own action and its own move', () => {
    const texts = compiled.shots.map((s) => s.render.text);
    expect(new Set(texts).size, 'four shots produced the same prompt').toBe(4);

    expect(texts[0]).toContain('leans on the bar');
    expect(texts[1]).toContain('lifts the glass');
    expect(texts[2]).toContain('turns his head');
    expect(texts[3]).toContain('sets the glass down');
  });

  it('produces four prompts that would survive generation', () => {
    expect(compiled.blocked).toBe(false);
    expect(compiled.shots.map((s) => s.blocked)).toEqual([false, false, false, false]);
  });

  it('adds up the runtime', () => {
    expect(compiled.runtimeS).toBe(19);
  });

  it('has nothing to say about the joins', () => {
    expect(compiled.continuity).toEqual([]);
  });
});

describe('expanding a shot', () => {
  it('overrides the world rather than being merged into it', () => {
    const seq = updateShot(saloon(), 's1', {
      overrides: { lighting: { key: 'the lanterns are out; only the doorway is lit' } },
    });
    const ir = expandShot(seq, 0);

    expect(ir.lighting?.key).toContain('only the doorway');
    // Everything not overridden is still the world's.
    expect(ir.lighting?.contrast).toBe('high');
    expect(ir.environment?.location).toBe('a frontier saloon');
  });

  it('never lets the world action leak into a later shot', () => {
    const ir = expandShot(saloon(), 2);
    expect(ir.subject?.action).toBe('turns his head towards the doors');
  });

  it('records which shot each one follows', () => {
    expect(expandShot(saloon(), 0).continuity).toBeUndefined();
    expect(expandShot(saloon(), 1).continuity?.prevShot).toBe('s1');
    expect(expandShot(saloon(), 1).continuity?.seamIn).toBe('frozen-handoff');
  });

  it('refuses a shot that is not there', () => {
    expect(() => expandShot(saloon(), 9)).toThrow(/no shot 9/);
  });
});

describe('continuing from the previous frame', () => {
  const continued = expandShot(saloon(), 1);

  it('stops describing what the frame already shows', () => {
    expect(continued.lighting).toBeUndefined();
    expect(continued.palette).toBeUndefined();
    expect(continued.environment?.description).toBeUndefined();
  });

  it('keeps who this is, because the model has to track them', () => {
    expect(continued.subject?.entities?.[0]?.description).toBe(COWBOY);
    expect(continued.environment?.location).toBe('a frontier saloon');
  });

  it('keeps a change that was made on purpose', () => {
    // The frame shows the room as it was. A light going out is the one thing it
    // cannot show, because it is what happens next.
    const seq = updateShot(saloon(), 's2', {
      overrides: { lighting: { key: 'the lanterns are out; only the doorway is lit' } },
    });
    const ir = expandShot(seq, 1);

    expect(ir.lighting?.key).toContain('only the doorway');
    // And only that: the contrast nobody touched is still the frame's business.
    expect(ir.lighting?.contrast).toBeUndefined();
  });

  it('points at the frame it starts from', () => {
    expect(continued.frames?.start).toBe('shot:s1#last');
  });

  it('writes no empty fields and no stand-in phrases', () => {
    const text = compileSequence(saloon(), kling).shots[1]!.render.text;

    // Every labelled line has something after the colon.
    for (const block of text.split(/\n\n/)) {
      expect(block, 'a labelled field was left blank').not.toMatch(/^[A-Za-z]+:\s*$/);
    }
    // And no card fallback stood in for what the frame already shows.
    for (const field of kling.fields ?? []) {
      if (field.fallback) expect(text).not.toContain(field.fallback);
    }
  });

  it('makes a shorter prompt than the same shot cut cold', () => {
    const seq = saloon();
    const cold = updateShot(seq, 's2', { continuesFromFrame: false, seam: 'hard-cut' });

    const continuation = compileSequence(seq, kling).shots[1]!.render.text;
    const full = compileSequence(cold, kling).shots[1]!.render.text;

    expect(continuation.length).toBeLessThan(full.length);
    // And still says the thing only words can say.
    expect(continuation).toContain('lifts the glass');
  });
});

describe('the joins', () => {
  it('notices a character described two ways', () => {
    const seq = updateShot(saloon(), 's3', {
      overrides: {
        subject: {
          entities: [{ id: 'e1', name: 'the cowboy', description: 'a young man, clean-shaven' }],
        },
      },
    });

    expect(checkSequence(seq).map((f) => f.ruleId)).toContain('seq-cast-drift');
  });

  it('notices a shot that changes place without cutting there', () => {
    const seq = updateShot(saloon(), 's3', {
      overrides: { environment: { location: 'the street outside' } },
    });

    const found = checkSequence(seq).find((f) => f.ruleId === 'seq-location-drift');
    expect(found?.message).toContain('the street outside');

    // A hard cut is an answer, so it stops being a finding.
    const cut = updateShot(seq, 's3', { seam: 'hard-cut' });
    expect(checkSequence(cut).map((f) => f.ruleId)).not.toContain('seq-location-drift');
  });

  it('notices a hand-off with no frame behind it', () => {
    const seq = updateShot(saloon(), 's2', { continuesFromFrame: false });
    expect(checkSequence(seq).map((f) => f.ruleId)).toContain('seq-handoff-needs-a-frame');
  });

  it('notices the same size from the same angle twice running', () => {
    const seq = updateShot(saloon(), 's3', { shot: { size: 'medium', durationS: 4 } });
    const found = checkSequence(seq).find((f) => f.ruleId === 'seq-jump-cut');
    expect(found?.message).toContain('s2 and s3');
  });

  it('notices a camera that never stops moving the same way', () => {
    let seq = saloon();
    for (const id of ['s2', 's3', 's4']) {
      seq = updateShot(seq, id, { cameraMove: { move: 'push-in', speed: 'slow' } });
    }

    const found = checkSequence(seq).find((f) => f.ruleId === 'seq-camera-monotony');
    expect(found?.message).toBe('4 shots in a row are a push-in.');
  });

  it('counts a move the shots inherited rather than stated', () => {
    // No shot names a move, so every prompt renders the world's. The joins have
    // to see what the prompts say, not what the shots store.
    const world = { ...WORLD, cameraMove: { move: 'push-in' as const, speed: 'slow' as const } };
    let seq = { ...saloon(), world };
    for (const id of ['s1', 's2', 's3', 's4']) {
      const { cameraMove: _dropped, ...rest } = seq.shots.find((s) => s.id === id)!;
      seq = { ...seq, shots: seq.shots.map((s) => (s.id === id ? rest : s)) };
    }

    const found = checkSequence(seq).find((f) => f.ruleId === 'seq-camera-monotony');
    expect(found?.message).toBe('4 shots in a row are a push-in.');
  });

  it('says nothing about a run of two', () => {
    const seq = updateShot(saloon(), 's2', { cameraMove: { move: 'push-in', speed: 'slow' } });
    expect(checkSequence(seq).map((f) => f.ruleId)).not.toContain('seq-camera-monotony');
  });

  it('notices a first shot that joins onto nothing', () => {
    const seq = updateShot(saloon(), 's1', { seam: 'match-cut' });
    expect(checkSequence(seq).map((f) => f.ruleId)).toContain('seq-first-shot-has-a-seam');
  });
});

describe('building one', () => {
  it('starts from a document that was written on its own', () => {
    const seq = sequenceFromIR({
      ...WORLD,
      subject: { ...WORLD.subject, action: 'leans on the bar' },
    });

    expect(seq.shots).toHaveLength(1);
    expect(seq.shots[0]?.action).toBe('leans on the bar');
    expect(seq.shots[0]?.seam).toBeUndefined();
  });

  it('gives every shot a free id, even after a deletion', () => {
    const seq = addShot(addShot(sequenceFromIR(WORLD)));
    expect(seq.shots.map((s) => s.id)).toEqual(['s1', 's2', 's3']);

    const gapped = { ...seq, shots: seq.shots.filter((s) => s.id !== 's2') };
    expect(addShot(gapped).shots.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
  });

  it('turns a song into a silent sequence rather than refusing', () => {
    expect(sequenceFromIR(emptyIR('audio')).world.modality).toBe('video');
  });

  it('counts a shot with no duration as nothing rather than guessing', () => {
    const { shot: _timed, ...untimed } = WORLD;
    const seq = sequenceFromIR(untimed);
    expect(sequenceRuntimeS(seq)).toBe(0);
  });
});

describe('the whole thing as one file', () => {
  const text = sequenceToDocument(saloon(), kling);

  it('names every shot and separates them to be read one at a time', () => {
    for (const id of ['S1', 'S2', 'S3', 'S4']) expect(text).toContain(id);
    expect(text.split(RULE)).toHaveLength(5);
  });

  it('says which shots start from a frame', () => {
    expect(text).toContain('starts from the previous frame');
  });

  it('carries the continuity notes where they will be seen', () => {
    const drifted = updateShot(saloon(), 's3', {
      overrides: { environment: { location: 'the street outside' } },
    });
    expect(sequenceToDocument(drifted, kling)).toContain('Continuity:');
  });

  it('ends with a newline, like every other document', () => {
    expect(text.endsWith('\n')).toBe(true);
  });
});
