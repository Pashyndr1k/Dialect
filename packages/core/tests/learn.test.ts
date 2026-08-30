import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { fillTemplate } from '../src/extract/idea.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { applyTemplate } from '../src/templates/apply.ts';
import { createLibrary, parseTemplate } from '../src/templates/library.ts';
import {
  EmptyExampleError,
  learnTemplate,
  learnedToTemplate,
  MAX_VARIABLES,
  templateId,
  templateToYaml,
  type LearnedImageTemplate,
  type LearnedVideoTemplate,
} from '../src/templates/learn.ts';

const registry = await loadBuiltinRegistry();

/** The prompt someone brought: a character sheet that already works. */
const EXAMPLE = `Full-body character concept for a dark fantasy RPG. A grizzled
dwarven smith, broad and low-slung, beard braided with iron rings, soot ground
into the creases of his hands. Hand-painted texture, thick confident brushwork,
visible canvas grain. Three-quarter view, neutral A-pose, plain slate background,
even studio light with a warm rim from the left. No text, no watermark, no
border.`;

const LEARNED_IMAGE: LearnedImageTemplate = {
  name: 'RPG character sheet',
  description: 'A full-body character concept in hand-painted style, on a plain background.',
  variables: [
    {
      name: 'character',
      label: 'Who they are',
      hint: 'Build, face, wear. "A grizzled dwarven smith, broad and low-slung".',
      default: 'a grizzled dwarven smith, broad and low-slung',
    },
    {
      name: 'detail',
      label: 'What marks them',
      hint: 'One or two things nobody else has. "Beard braided with iron rings".',
      default: 'beard braided with iron rings, soot ground into the creases of his hands',
    },
  ],
  headline: 'full-body character concept for a dark fantasy RPG',
  entities: [
    { name: '{{character}}', type: 'person', description: '{{character}}, {{detail}}' },
  ],
  action: '',
  location: '',
  locationDescription: 'plain slate background',
  timeOfDay: '',
  era: '',
  shotSize: 'wide',
  angle: 'three-quarter view, neutral A-pose',
  aspectRatio: '4:5',
  lightingKey: 'even studio light with a warm rim from the left',
  lightingSources: [],
  contrast: '',
  colorTemp: '',
  opticsEffect: '',
  palette: [],
  grade: '',
  grain: 'fine-uniform',
  medium: 'hand-painted texture, thick confident brushwork, visible canvas grain',
  genre: 'dark fantasy',
  atmosphere: '',
  textInImage: [],
};

const LEARNED_VIDEO: LearnedVideoTemplate = {
  ...LEARNED_IMAGE,
  action: '{{motion}}',
  cameraMove: 'push-in',
  cameraSpeed: 'slow',
  subjectMotion: '{{motion}}',
  beats: [],
  variables: [
    {
      name: 'motion',
      label: 'What they do',
      hint: 'One action. "Raises the hammer and holds it".',
      default: 'turns his head towards the forge',
    },
  ],
};

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('learning from an example', () => {
  it('refuses an empty example', async () => {
    await expect(
      learnTemplate(gatewayWith([LEARNED_IMAGE]), '   ', { kind: 'text2img', cast: 1 }),
    ).rejects.toThrow(EmptyExampleError);
  });

  it('hands the example over whole, and says what shape to make of it', async () => {
    const provider = new MockProvider([LEARNED_IMAGE]);
    await learnTemplate(new Gateway(provider), EXAMPLE, { kind: 'text2img', cast: 1 });

    const asked = provider.calls[0]?.instruction ?? '';
    expect(asked).toContain('dark fantasy RPG');
    expect(asked).toContain('exactly one character');
    expect(provider.calls[0]?.system).toContain('Do not improve it.');
  });

  it('tells it to keep the wording that makes the prompt work', async () => {
    const provider = new MockProvider([LEARNED_IMAGE]);
    await learnTemplate(new Gateway(provider), EXAMPLE, { kind: 'text2img', cast: 1 });
    expect(provider.calls[0]?.system).toContain('verbatim');
  });

  it('will not hand back an answer bought for a different shape', async () => {
    const gateway = new Gateway(new MockProvider([LEARNED_IMAGE, LEARNED_IMAGE]), {
      budgetUsd: 10,
    });

    const one = await learnTemplate(gateway, EXAMPLE, { kind: 'text2img', cast: 1 });
    const two = await learnTemplate(gateway, EXAMPLE, { kind: 'text2img', cast: 2 });
    expect(one.key).not.toBe(two.key);
  });
});

describe('the template it produces', () => {
  const { template } = { template: learnedToTemplate(LEARNED_IMAGE, { kind: 'text2img', cast: 1 }) };

  it('keeps the fixed half word for word', () => {
    const ir = template.ir as Record<string, Record<string, unknown>>;

    expect(ir['style']?.['medium']).toBe(
      'hand-painted texture, thick confident brushwork, visible canvas grain',
    );
    expect(ir['lighting']?.['key']).toBe('even studio light with a warm rim from the left');
    expect(ir['shot']?.['angle']).toBe('three-quarter view, neutral A-pose');
  });

  it('leaves holes where the subject was', () => {
    expect(JSON.stringify(template.ir)).toContain('{{character}}');
    expect(template.variables?.map((v) => v.name)).toEqual(['character', 'detail']);
  });

  it('writes each hint as an instruction with an example in it', () => {
    for (const variable of template.variables ?? []) {
      expect(variable.hint, `${variable.name} has no hint`).toBeTruthy();
      expect(variable.label).toBeTruthy();
    }
  });

  it('carries the example values, so it can be tried as it stands', () => {
    const { ir } = applyTemplate(createLibrary([template], []), template.id);

    expect(JSON.stringify(ir)).not.toContain('{{');
    expect(ir.subject?.entities?.[0]?.description).toContain('grizzled dwarven smith');
  });

  it('makes a document that compiles', () => {
    const { ir } = applyTemplate(createLibrary([template], []), template.id);
    const { render, blocked } = compile(ir, getProfile(registry, 'nano-banana-2'));

    expect(blocked).toBe(false);
    expect(render.text).toContain('thick confident brushwork');
  });

  it('is a file that can be read back into the same template', () => {
    const yaml = templateToYaml(template);
    const round = parseTemplate(yaml, `${template.id}.yaml`);

    expect(round).toEqual(template);
    // The identifying fields are at the top, because these get edited by hand.
    expect(yaml.startsWith(`id: ${template.id}`)).toBe(true);
  });

  it('refuses to keep more holes than a person will fill', () => {
    const many = {
      ...LEARNED_IMAGE,
      variables: Array.from({ length: 9 }, (_, i) => ({
        name: `v${i}`,
        label: `V ${i}`,
        hint: 'x',
        default: 'y',
      })),
    };

    const trimmed = learnedToTemplate(many, { kind: 'text2img', cast: 1 });
    expect(trimmed.variables).toHaveLength(MAX_VARIABLES);
  });

  it('marks a hole with no example value as one that must be given', () => {
    const blank = {
      ...LEARNED_IMAGE,
      variables: [{ name: 'character', label: 'Who', hint: 'anyone', default: '  ' }],
    };

    expect(learnedToTemplate(blank, { kind: 'text2img', cast: 1 }).variables?.[0]?.required).toBe(
      true,
    );
  });
});

describe('what each kind is shaped like', () => {
  it('gives an image-to-image template a source and an edit mode', () => {
    const template = learnedToTemplate(LEARNED_IMAGE, { kind: 'img2img', cast: 1 });
    const ir = template.ir as Record<string, unknown>;

    expect(ir['mode']).toBe('edit');
    expect(ir['frames']).toEqual({ start: '{{source}}' });
    expect(template.variables?.some((v) => v.name === 'source')).toBe(true);
  });

  it('gives an image-to-video template a start frame but not an edit mode', () => {
    const template = learnedToTemplate(LEARNED_VIDEO, { kind: 'img2vid', cast: 1 });
    const ir = template.ir as Record<string, unknown>;

    expect(ir['modality']).toBe('video');
    expect(ir['mode']).not.toBe('edit');
    expect(ir['frames']).toEqual({ start: '{{source}}' });
  });

  it('leaves a text-to-image template starting from nothing', () => {
    const template = learnedToTemplate(LEARNED_IMAGE, { kind: 'text2img', cast: 1 });
    expect((template.ir as Record<string, unknown>)['frames']).toBeUndefined();
    expect(template.variables?.some((v) => v.name === 'source')).toBe(false);
  });

  it('carries motion into a video template', () => {
    const template = learnedToTemplate(LEARNED_VIDEO, { kind: 'text2vid', cast: 1 });
    const ir = template.ir as Record<string, Record<string, unknown>>;

    expect(ir['subject']?.['action']).toBe('{{motion}}');
    expect(ir['cameraMove']).toEqual({ move: 'push-in', speed: 'slow' });
  });

  it('says how many characters the template carries', async () => {
    for (const [cast, said] of [
      [0, 'no people in it'],
      [1, 'exactly one character'],
      [2, 'exactly two characters'],
    ] as const) {
      const provider = new MockProvider([LEARNED_IMAGE]);
      await learnTemplate(new Gateway(provider), EXAMPLE, { kind: 'text2img', cast });
      expect(provider.calls[0]?.instruction).toContain(said);
    }
  });
});

describe('naming one', () => {
  it('turns a name into an id nobody has to type twice', () => {
    expect(templateId('RPG Character Sheet')).toBe('rpg-character-sheet');
    expect(templateId('  Spaces  &  symbols!  ')).toBe('spaces-symbols');
    expect(templateId('')).toBe('template');
  });

  it('does not take an id that is already in use', () => {
    const taken = ['rpg-character-sheet', 'rpg-character-sheet-2'];
    expect(templateId('RPG Character Sheet', taken)).toBe('rpg-character-sheet-3');
  });

  it('lets the caller name it instead of the model', () => {
    const template = learnedToTemplate(LEARNED_IMAGE, {
      kind: 'text2img',
      cast: 1,
      name: 'Game characters',
    });
    expect(template.name).toBe('Game characters');
    expect(template.id).toBe('game-characters');
  });
});

describe('the whole way round', () => {
  it('turns one good prompt into many, from a few words each', async () => {
    // What the user brought.
    const { template } = await learnTemplate(gatewayWith([LEARNED_IMAGE]), EXAMPLE, {
      kind: 'text2img',
      cast: 1,
      name: 'Game characters',
    });
    const library = createLibrary([template], []);

    // What they type next: a few words about the next character.
    const gateway = gatewayWith([
      {
        character: 'a wiry elven scout, all angles',
        detail: 'a burn scar across one cheek, a bowstring callus',
      },
      {
        character: 'a heavyset orc cook',
        detail: 'a cleaver worn thin, flour to the elbows',
      },
    ]);

    const scout = await fillTemplate(gateway, 'an elf scout', library, template.id);
    const cook = await fillTemplate(gateway, 'an orc cook', library, template.id);

    const one = compile(scout.ir, getProfile(registry, 'nano-banana-2')).render.text;
    const two = compile(cook.ir, getProfile(registry, 'nano-banana-2')).render.text;

    // Different characters.
    expect(one).toContain('wiry elven scout');
    expect(two).toContain('heavyset orc cook');
    expect(one).not.toBe(two);

    // The same prompt, otherwise: the half that made the example work is in both.
    for (const text of [one, two]) {
      expect(text).toContain('thick confident brushwork');
      expect(text).toContain('even studio light with a warm rim from the left');
      expect(text).toContain('three-quarter view, neutral A-pose');
      expect(text).not.toContain('{{');
    }
  });
});
