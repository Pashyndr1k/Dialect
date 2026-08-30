/**
 * A reading, reduced to lines.
 *
 * The composer never sees a picture or a schema — only what each source turned
 * out to say. Labelled lines rather than JSON, because a model handed a JSON
 * document tends to copy its shape back rather than reason about it, and
 * because a line that resolved to nothing can simply be absent.
 */

import type { ExtractedScene } from '../extract/schema.ts';
import type { ExtractedShot } from '../extract/video.ts';
import type { ExtractedSong } from '../extract/audio.ts';

const line = (label: string, value: string | undefined): string | undefined =>
  value?.trim() ? `${label}: ${value.trim()}` : undefined;

const list = (label: string, values: readonly string[] | undefined): string | undefined =>
  line(label, values?.filter((v) => v.trim()).join(', '));

const kept = (...lines: Array<string | undefined>): string[] =>
  lines.filter((l): l is string => l !== undefined);

export function sceneLines(scene: ExtractedScene): string[] {
  return kept(
    line('Subject', scene.headline),
    ...scene.entities.map((e, i) =>
      line(`Who ${i + 1}`, [e.name, e.description].filter(Boolean).join(' — ')),
    ),
    line('Action', scene.action),
    line('Place', scene.location),
    line('Place detail', scene.locationDescription),
    line('Time', scene.timeOfDay),
    line('Era', scene.era),
    line('Framing', [scene.shotSize, scene.angle].filter(Boolean).join(', ')),
    line('Aspect', scene.aspectRatio),
    line('Key light', scene.lightingKey),
    list('Other light', scene.lightingSources),
    line('Contrast', scene.contrast),
    line('Colour temperature', scene.colorTemp),
    line('Optics', scene.opticsEffect),
    list('Palette', scene.palette),
    line('Grade', scene.grade),
    line('Grain', scene.grain === 'none' ? undefined : scene.grain),
    line('Medium', scene.medium),
    line('Genre', scene.genre),
    line('Atmosphere', scene.atmosphere),
    ...scene.textInImage.map((t) => line('Text in frame', t.exact)),
  );
}

export function shotLines(shot: ExtractedShot): string[] {
  return [
    ...sceneLines(shot),
    ...kept(
      line('Movement', shot.subjectMotion),
      line('Camera move', [shot.cameraSpeed, shot.cameraMove].filter(Boolean).join(' ')),
      ...shot.beats.map((b) => line(`Beat ${b.t}`, b.action)),
    ),
  ];
}

export function songLines(song: ExtractedSong): string[] {
  return kept(
    line('Genre', song.genre),
    list('Instruments', song.instruments),
    line('Vocals', song.vocals === 'present' ? song.vocalDescription || 'present' : song.vocals),
    list('Structure', song.structure),
    line('Mood', song.mood),
    line('Mix', song.mix),
  );
}

/** What someone typed, as one line, since it is already what it is. */
export const wordLines = (text: string): string[] =>
  text.trim() ? [text.trim()] : [];
