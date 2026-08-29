import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compile } from '../src/compile.ts';
import { extractFromImage, sceneToIR } from '../src/extract/image.ts';
import { EXTRACTION_VERSION, type ExtractedScene } from '../src/extract/schema.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MemoryCache } from '../src/providers/cache.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { BudgetExceededError } from '../src/providers/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();

const IMAGE = { mediaType: 'image/png', base64: 'aGVsbG8=' };

const SCENE: ExtractedScene = {
  headline: 'a matte-black cologne bottle on wet slate',
  entities: [
    {
      name: 'cologne bottle',
      type: 'product',
      description: 'matte-black glass, squared shoulders, a brushed steel cap, beaded with water',
    },
  ],
  action: 'a single droplet lands beside it in a small crown splash',
  location: 'a studio table of wet slate',
  locationDescription: 'charcoal seamless behind, water pooling in the stone texture, fine mist drifting',
  timeOfDay: 'indoors, no daylight',
  era: 'contemporary',
  shotSize: 'extreme-close-up',
  angle: 'slightly above the surface, near eye level with the bottle',
  aspectRatio: '4:5',
  lightingKey: 'hard raking light from the right',
  lightingSources: ['a dim fill from the left picking out the far edge'],
  contrast: 'high, with deep shadows stretching left',
  colorTemp: 'neutral, faintly cool',
  opticsEffect: 'the background melts into soft blur while the label stays razor legible',
  palette: ['#141416', '#3d4348', '#8f9499'],
  grade: 'muted, near-monochrome',
  grain: 'fine-uniform',
  medium: 'photograph',
  genre: 'product still life',
  atmosphere: 'water suspended mid-fall, the slate still slick from the last take',
  textInImage: [],
};

function gatewayWith(answers: unknown[], budgetUsd?: number) {
  const provider = new MockProvider(answers);
  const cache = new MemoryCache();
  const gateway = new Gateway(
    provider,
    budgetUsd === undefined ? { cache } : { cache, budgetUsd },
  );
  return { provider, cache, gateway };
}

describe('the gateway', () => {
  it('spends once for the same reference and question', async () => {
    const { provider, gateway } = gatewayWith([SCENE, SCENE]);

    const first = await extractFromImage(gateway, IMAGE, { reference: 'a.png' });
    const second = await extractFromImage(gateway, IMAGE, { reference: 'a.png' });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(second.usage.costUsd).toBe(0);
    expect(gateway.spentUsd).toBeCloseTo(0.01);
  });

  it('asks again when the schema version moves, so a stale answer is never reused', async () => {
    const { provider, gateway } = gatewayWith([SCENE, SCENE]);
    const base = {
      system: 'sys',
      instruction: 'go',
      images: [IMAGE],
      schema: z.any(),
      schemaVersion: '1',
    };

    await gateway.extract(base);
    await gateway.extract({ ...base, schemaVersion: '2' });

    expect(provider.calls).toHaveLength(2);
  });

  it('asks again when the image changes', async () => {
    const { provider, gateway } = gatewayWith([SCENE, SCENE]);

    await extractFromImage(gateway, IMAGE, { reference: 'a.png' });
    await extractFromImage(gateway, { ...IMAGE, base64: 'd29ybGQ=' }, { reference: 'b.png' });

    expect(provider.calls).toHaveLength(2);
  });

  it('refuses before spending past the cap, not after', async () => {
    const { provider, gateway } = gatewayWith([SCENE, SCENE, SCENE], 0.015);

    await extractFromImage(gateway, IMAGE, { reference: 'a.png' });
    await extractFromImage(gateway, { ...IMAGE, base64: 'Yg==' }, { reference: 'b.png' });

    await expect(
      extractFromImage(gateway, { ...IMAGE, base64: 'Yw==' }, { reference: 'c.png' }),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    // The third call never reached the provider.
    expect(provider.calls).toHaveLength(2);
    expect(gateway.spentUsd).toBeCloseTo(0.02);
  });

  it('reports spend as it goes', async () => {
    const provider = new MockProvider([SCENE]);
    const seen: number[] = [];
    const gateway = new Gateway(provider, { onSpend: (_u, total) => seen.push(total) });

    await extractFromImage(gateway, IMAGE, { reference: 'a.png' });
    expect(seen).toEqual([0.01]);
  });

  it('re-fetches a cached answer that no longer fits the schema', async () => {
    const provider = new MockProvider([{ a: 'fresh' }]);
    const cache = new MemoryCache();
    const gateway = new Gateway(provider, { cache });

    const request = {
      system: 'sys',
      instruction: 'go',
      images: [IMAGE],
      schema: z.object({ a: z.string() }),
      schemaVersion: EXTRACTION_VERSION,
    };

    // Something an older build left behind, under the key this request will use.
    await cache.set(await gateway.keyFor(request), { totally: 'different' });

    const result = await gateway.extract(request);

    expect(result.cached).toBe(false);
    expect(result.value.a).toBe('fresh');
    expect(provider.calls).toHaveLength(1);
  });
});

describe('scene to IR', () => {
  it('lands every reported field somewhere the compiler can use', () => {
    const ir = sceneToIR(SCENE, { reference: 'bottle.png' });

    expect(ir.subject?.headline).toBe(SCENE.headline);
    expect(ir.subject?.entities?.[0]?.id).toBe('e1');
    expect(ir.environment?.description).toContain('charcoal seamless');
    expect(ir.shot?.size).toBe('extreme-close-up');
    expect(ir.lighting?.sources).toHaveLength(1);
    expect(ir.palette?.dominant).toHaveLength(3);
    expect(ir.texture?.grain).toBe('fine-uniform');
  });

  it('carries no lens number, because none is visible in a photograph', () => {
    const ir = sceneToIR(SCENE, { reference: 'bottle.png' });
    expect(ir.optics?.gearHint).toBeUndefined();
    expect(ir.optics?.effect).toContain('melts into soft blur');
  });

  it('records where the fields came from', () => {
    const ir = sceneToIR(SCENE, { reference: 'bottle.png' });
    expect(ir.provenance?.[0]?.ref).toBe('bottle.png');
    expect(ir.provenance?.[0]?.fields).toContain('lighting');
  });

  it('omits in-image text when the reference has none', () => {
    expect(sceneToIR(SCENE, { reference: 'bottle.png' }).textInImage).toBeUndefined();
  });
});

describe('the whole path: reference to prompt', () => {
  it('turns one extraction into prompts for several models without asking again', async () => {
    const { provider, gateway } = gatewayWith([SCENE]);
    const { ir } = await extractFromImage(gateway, IMAGE, { reference: 'bottle.png' });

    const nano = compile(ir, getProfile(registry, 'nano-banana-2'));
    const gpt = compile(ir, getProfile(registry, 'gpt-image-2'));

    expect(nano.blocked).toBe(false);
    expect(nano.render.text).toContain('matte-black cologne bottle');
    expect(nano.render.text).toContain('hard raking light from the right');
    expect(gpt.render.text).toContain('matte-black cologne bottle');

    // The whole point: retargeting cost nothing.
    expect(provider.calls).toHaveLength(1);
  });

  it('renders the two image profiles identically until something distinguishes them', async () => {
    // Both take the natural form and neither accepts a negative field, so on an
    // extracted scene they genuinely agree. They part company only where the
    // profiles differ — GPT Image 2 is the one target that reads lens numbers.
    const { gateway } = gatewayWith([SCENE]);
    const { ir } = await extractFromImage(gateway, IMAGE, { reference: 'bottle.png' });

    expect(compile(ir, getProfile(registry, 'gpt-image-2')).render.text).toBe(
      compile(ir, getProfile(registry, 'nano-banana-2')).render.text,
    );

    const withGear = { ...ir, optics: { ...ir.optics, gearHint: '100mm macro' } };
    expect(compile(withGear, getProfile(registry, 'gpt-image-2')).render.text).toContain(
      '100mm macro',
    );
    expect(compile(withGear, getProfile(registry, 'nano-banana-2')).render.text).not.toContain(
      '100mm macro',
    );
  });

  it('strips the booster the model let slip into its own description', async () => {
    const slop: ExtractedScene = {
      ...SCENE,
      opticsEffect: 'the background melts into soft blur while the label stays razor sharp',
    };
    const { gateway } = gatewayWith([slop]);
    const { ir } = await extractFromImage(gateway, IMAGE, { reference: 'bottle.png' });

    const result = compile(ir, getProfile(registry, 'nano-banana-2'));
    expect(result.render.text).not.toContain('razor sharp');
    expect(result.findings.some((f) => f.ruleId === 'no-booster-words')).toBe(true);
  });
});
