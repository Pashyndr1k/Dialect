/**
 * Every IR path a card's field may read, with what it holds.
 *
 * A `field-list` card is data: each field names the paths that feed it. Which
 * makes the set of legal paths part of the contract, and until now it was only
 * written down in the type — readable by a compiler, and by nobody writing a
 * card by hand or having one written for them.
 *
 * So it is a list. It is what the card learner is shown instead of being left
 * to invent plausible-looking paths, and it is what a finished card is checked
 * against: a field reading `subject.description` renders empty for ever and
 * says nothing, because a path that is not there and a field that is empty look
 * exactly alike at render time.
 *
 * `[]` on a path means "each item of that array, in order".
 */

export interface PathEntry {
  path: string;
  /** One line. What a field reading this gets. */
  what: string;
}

export const IR_PATHS: readonly PathEntry[] = [
  { path: 'title', what: 'One-line title for the document. Rarely wanted inside a prompt.' },

  { path: 'subject.headline', what: 'Short noun phrase: who or what is in frame, and where.' },
  { path: 'subject.entities[].name', what: 'Each subject by name, in order.' },
  {
    path: 'subject.entities[].description',
    what: 'Full appearance of each subject. Long on purpose — repeating it verbatim is what holds a character together across separate generations.',
  },
  { path: 'subject.action', what: 'The one thing happening. A second action belongs in the next shot.' },

  { path: 'environment.location', what: 'Where it is.' },
  { path: 'environment.description', what: 'What that place looks like.' },
  { path: 'environment.timeOfDay', what: 'Time of day.' },
  { path: 'environment.era', what: 'Period.' },
  { path: 'environment.weather', what: 'Weather.' },
  { path: 'environment.layers[]', what: 'Foreground/midground/background notes, in order.' },

  { path: 'shot.size', what: 'Shot size, e.g. wide, medium-close, extreme-close-up.' },
  { path: 'shot.angle', what: 'Camera angle in words, e.g. "slight low angle".' },
  { path: 'shot.framing', what: 'Framing notes that belong on the camera line.' },
  { path: 'shot.aspectRatio', what: 'Aspect ratio, e.g. 16:9.' },
  { path: 'shot.durationS', what: 'Requested duration in seconds.' },

  { path: 'cameraMove.move', what: 'The move alone, e.g. push-in. Usually you want @cameraMove instead.' },
  { path: 'cameraMove.speed', what: 'slow, medium or fast.' },
  { path: 'cameraMove.detail', what: 'Where the camera is and what it follows.' },

  { path: 'lighting.key', what: 'The main light, named as a source.' },
  { path: 'lighting.sources[]', what: 'Further named light sources, in order.' },
  { path: 'lighting.quality', what: 'Hard, soft, diffused.' },
  { path: 'lighting.direction', what: 'Where the light comes from.' },
  { path: 'lighting.colorTemp', what: 'Warm, cool, a Kelvin figure.' },
  { path: 'lighting.contrast', what: 'How far the shadows fall.' },
  { path: 'lighting.lookWords[]', what: 'Tested look words. Capped at three by max-look-words.' },

  { path: 'optics.effect', what: 'The visible optical result, e.g. "background melts into soft blur".' },
  { path: 'optics.gearHint', what: 'Focal length or aperture. Prefer @lens, which respects emitsGearNumbers.' },

  { path: 'texture.grain', what: 'none, fine-uniform or heavy.' },
  { path: 'texture.notes[]', what: 'Surface and material notes.' },

  { path: 'palette.dominant[]', what: 'The colours that carry the frame.' },
  { path: 'palette.grade', what: 'The grade, e.g. "bleach bypass".' },
  { path: 'palette.saturation', what: 'How saturated.' },

  { path: 'style.medium', what: 'Photograph, film, 3D render, illustration.' },
  { path: 'style.genre', what: 'Genre.' },
  { path: 'style.era', what: 'Period of the style, as opposed to of the scene.' },
  { path: 'style.notes[]', what: 'Anything else about the treatment.' },

  { path: 'mood.emotion', what: 'What is felt.' },
  { path: 'mood.energy', what: 'How much is happening.' },
  { path: 'mood.atmosphere', what: 'The air of the place.' },

  { path: 'beats[].t', what: 'Timecode of each beat, mm:ss.' },
  { path: 'beats[].action', what: 'What happens at each beat, in order.' },

  { path: 'dialogue[].line', what: 'Each spoken line, verbatim.' },
  { path: 'dialogue[].delivery[]', what: 'How each line is delivered.' },

  { path: 'sound.sfx[]', what: 'Named effects.' },
  { path: 'sound.ambience', what: 'The bed under everything.' },
  {
    path: 'sound.music',
    what: 'Whether music is generated with the picture. A flag, not text — normally a card sets it under defaults rather than reading it into a field.',
  },
  { path: 'sound.subtitles', what: 'Whether captions are burned in. A flag; usually forced false under defaults.' },

  { path: 'audio.genre', what: 'Genre, for standalone audio models.' },
  { path: 'audio.bpm', what: 'Tempo as a bare number. Prefer @tempo, which writes "78 BPM".' },
  { path: 'audio.musicalKey', what: 'Key.' },
  { path: 'audio.instruments[]', what: 'Instruments, in order.' },
  { path: 'audio.vocals.description', what: 'The voice.' },
  { path: 'audio.structure[]', what: 'Section labels. Prefer @sections, which joins them as an arrangement.' },
  { path: 'audio.lyrics', what: 'Lyrics, verbatim.' },
  { path: 'audio.mix', what: 'How it should sit.' },

  { path: 'textInImage[].exact', what: 'Words that must appear in the picture, exactly.' },
  { path: 'textInImage[].placement', what: 'Where those words go.' },

  { path: 'frames.start', what: 'Start frame reference.' },
  { path: 'frames.end', what: 'End frame reference.' },

  { path: 'continuity.reestablish', what: 'Positions and facing directions, restated so nobody swaps sides.' },

  { path: 'edit.change', what: 'In edit mode: the one thing that changes.' },
  { path: 'edit.keep[]', what: 'In edit mode: what must not move.' },

  { path: 'constraints.avoid[]', what: 'What to keep out. Feeds a negative field where the model has one.' },
];

/**
 * The computed phrases, which are word order rather than a field.
 *
 * They exist because a couple of lines in a prompt only make sense as a phrase
 * — "slow push-in" is two IR values and an order that neither of them knows.
 */
export const COMPUTED_PATHS: readonly PathEntry[] = [
  { path: '@cameraMove', what: 'The move and its speed as one phrase: "slow push-in", or "static camera".' },
  { path: '@lens', what: 'The gear hint, but only where the card sets supports.emitsGearNumbers.' },
  { path: '@tempo', what: 'The tempo written as "78 BPM" rather than as a bare number.' },
  { path: '@sections', what: 'The arrangement as one line: "intro, verse, chorus".' },
];

const KNOWN = new Set<string>([
  ...IR_PATHS.map((p) => p.path),
  ...COMPUTED_PATHS.map((p) => p.path),
]);

/** Whether a card may read this path. */
export const isReadablePath = (path: string): boolean => KNOWN.has(path.trim());

/** The vocabulary as a list to put in front of a model, one path per line. */
export function vocabularyText(): string {
  const lines = (list: readonly PathEntry[]): string =>
    list.map((p) => `  ${p.path} — ${p.what}`).join('\n');
  return `IR paths a field may read:\n${lines(IR_PATHS)}\n\nComputed phrases:\n${lines(COMPUTED_PATHS)}`;
}
