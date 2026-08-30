/**
 * Prompt IR — the model-independent description of what is being generated.
 *
 * Everything in Dialect passes through this shape. References are extracted
 * into it, templates are partial versions of it, the rules engine validates it,
 * and each renderer turns it into one model's dialect. Adding a target model
 * must never require changing this file.
 */

export type Modality = 'image' | 'video' | 'audio';

/**
 * `generate` builds a prompt that creates something new.
 * `edit` builds a prompt that changes an existing frame or clip, which follows
 * the opposite discipline: name only the delta, pin everything else.
 */
export type Mode = 'generate' | 'edit';

export const IR_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityType = 'person' | 'product' | 'creature' | 'object';

export interface Entity {
  id: string;
  type?: EntityType;
  /** Short noun phrase. Becomes the `Subject` line in field-ordered dialects. */
  name: string;
  /**
   * Ultra-detailed appearance. Repeated verbatim in every clip of a sequence —
   * that repetition is what holds a character or product together across
   * separate generations, so renderers must never abbreviate it.
   */
  description?: string;
  /**
   * Identity that has to stay recognisable across cuts. Engines lose track past
   * three, so `max-tracked-entities` counts these and leaves extras generic.
   */
  tracked?: boolean;
  /** Pointer into the entity library, e.g. `sheet://cowboy`. */
  sheetRef?: string;
}

// ---------------------------------------------------------------------------
// Framing and motion
// ---------------------------------------------------------------------------

/**
 * Widest to tightest, then the two that describe who is in frame rather than
 * how close. The order is the order a size picker should offer them in.
 */
export const SHOT_SIZES = [
  'extreme-wide', 'wide', 'medium-wide', 'medium',
  'medium-close', 'close-up', 'extreme-close-up', 'two-shot', 'over-shoulder',
] as const;

export type ShotSize = (typeof SHOT_SIZES)[number];

/** `static` first, because it is the right answer more often than it is chosen. */
export const CAMERA_MOVES = [
  'static', 'push-in', 'pull-back', 'pan', 'tilt', 'tracking',
  'orbit', 'crane', 'zoom', 'dolly-zoom', 'whip-pan', 'handheld',
] as const;

export type CameraMove = (typeof CAMERA_MOVES)[number];

export interface Shot {
  size?: ShotSize;
  /** Free text when the angle needs more nuance than a preset, e.g. "slight low angle". */
  angle?: string;
  aspectRatio?: string;
  durationS?: number;
  /** Extra framing notes that belong on the camera line rather than in the scene. */
  framing?: string;
}

export interface CameraMovement {
  move: CameraMove;
  /** Almost everything reads better slow; fast moves expose what the model cannot render. */
  speed?: 'slow' | 'medium' | 'fast';
  /** Free-text elaboration, e.g. "from just behind the bartender's right shoulder". */
  detail?: string;
}

/** One action at one timecode. Stops the model cramming a shot into its first second. */
export interface Beat {
  /** `mm:ss`. */
  t: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

export interface Lighting {
  /** Primary named source, e.g. "warm amber oil lantern glow from the ceiling beams". */
  key?: string;
  /** Further named sources, in the order they should read. */
  sources?: string[];
  quality?: string;
  direction?: string;
  colorTemp?: string;
  contrast?: string;
  /**
   * Tested look words such as `shadowplay` or `cinematic`. Capped by
   * `max-look-words`: stacked past three they cancel each other out.
   */
  lookWords?: string[];
}

export interface Optics {
  /**
   * The visible result, e.g. "background melts into soft blur". This is what
   * models actually respond to.
   */
  effect?: string;
  /**
   * Focal length or aperture as shorthand, e.g. "50mm". Emitted only when the
   * profile sets `emitsGearNumbers`, and never on its own — `gear-needs-effect`
   * pairs it with `effect` or drops it.
   */
  gearHint?: string;
}

export interface Texture {
  grain?: 'none' | 'fine-uniform' | 'heavy';
  /** Insert the skin-realism block; without it models retouch faces to plastic. */
  skinBlock?: boolean;
  notes?: string[];
}

export interface Palette {
  dominant?: string[];
  grade?: string;
  saturation?: string;
}

export interface Style {
  medium?: string;
  genre?: string;
  era?: string;
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Sound (inside video; omni models generate picture and audio in one pass)
// ---------------------------------------------------------------------------

export interface Dialogue {
  /** Entity id of the speaker. */
  speaker: string;
  /** Rendered inside quotation marks, verbatim. */
  line: string;
  /** Delivery qualities — mix two or three; one flat label reads dead. */
  delivery?: string[];
}

export interface Sound {
  sfx?: string[];
  ambience?: string;
  /** Generated music cannot be separated later, so this defaults to false. */
  music?: boolean;
  /** Burned-in captions cannot be removed, so this defaults to false. */
  subtitles?: boolean;
}

/** Standalone audio generation (Suno, ElevenLabs, Stable Audio) — not in-clip sound. */
export interface AudioSpec {
  genre?: string;
  bpm?: number;
  musicalKey?: string;
  instruments?: string[];
  vocals?: { present: boolean; description?: string };
  /** Section labels in order, e.g. ["intro", "verse", "chorus"]. */
  structure?: string[];
  lyrics?: string;
  mix?: string;
}

// ---------------------------------------------------------------------------
// References, frames, continuity
// ---------------------------------------------------------------------------

/** What a reference teaches the model. Distinct from where a shot starts and ends. */
export type ReferenceRole = 'style' | 'character' | 'product' | 'performance' | 'image' | 'audio';

export interface Reference {
  /** Label used inside the prompt when the profile has a reference syntax, e.g. `@image1`. */
  id: string;
  role: ReferenceRole;
  src: string;
}

/** Start and end frames control the moment; references control identity. */
export interface Frames {
  start?: string;
  end?: string;
}

export const SEAMS = [
  'frozen-handoff', 'action-bridge', 'match-cut', 'portal', 'hard-cut',
] as const;

export type Seam = (typeof SEAMS)[number];

export interface Continuity {
  seamIn?: Seam;
  prevShot?: string;
  /** Restated positions and facing directions, so characters do not swap sides. */
  reestablish?: string;
}

export interface TextInImage {
  /** Rendered inside quotation marks exactly as written, or it gets paraphrased. */
  exact: string;
  placement?: string;
  /** Spell the word out letter by letter when it keeps mangling. */
  spellOut?: boolean;
}

// ---------------------------------------------------------------------------
// Intent, constraints, provenance
// ---------------------------------------------------------------------------

export interface Intent {
  /** Job label used to route to a model, e.g. `cinematic_shot`, `product_shot`, `layout`. */
  job?: string;
  /** Chosen target model id. Absent means "let the router pick". */
  target?: string;
  audience?: string;
}

export interface Constraints {
  /** Feeds the negative prompt, or `--no`-style flags, or nothing — profile decides. */
  avoid?: string[];
  /** IR paths the user pinned. In edit mode these become explicit "keep exactly". */
  locked?: string[];
}

/** Which source supplied which IR fields. Powers the source map in the editor. */
export interface ProvenanceEntry {
  ref: string;
  fields: string[];
}

/** For `mode: 'edit'` — the single thing that changes. */
export interface EditDelta {
  /** What should change, stated affirmatively. */
  change: string;
  /** What must not move. Rendered as explicit keep-clauses. */
  keep?: string[];
  /** Reference to the source image or clip being edited. */
  source?: string;
}

// ---------------------------------------------------------------------------

export interface PromptIR {
  irVersion: typeof IR_VERSION;
  modality: Modality;
  mode: Mode;
  intent?: Intent;

  /** One-line title, used for file names and history entries. */
  title?: string;

  shot?: Shot;
  cameraMove?: CameraMovement;

  subject?: {
    /**
     * Short noun phrase naming who or what is in frame, and where — the line a
     * dialect puts first. Composed prose, because the extractor or the user
     * writes it; the renderer only decides where it goes.
     */
    headline?: string;
    entities?: Entity[];
    /** One action per clip. A second one belongs in the next shot. */
    action?: string;
  };

  environment?: {
    location?: string;
    description?: string;
    timeOfDay?: string;
    era?: string;
    weather?: string;
    layers?: string[];
  };

  lighting?: Lighting;
  optics?: Optics;
  texture?: Texture;
  palette?: Palette;
  style?: Style;
  mood?: { emotion?: string; energy?: string; atmosphere?: string };

  beats?: Beat[];
  dialogue?: Dialogue[];
  sound?: Sound;
  audio?: AudioSpec;

  frames?: Frames;
  references?: Reference[];
  textInImage?: TextInImage[];
  continuity?: Continuity;

  edit?: EditDelta;

  constraints?: Constraints;
  provenance?: ProvenanceEntry[];
}

/** A minimal valid document, so callers never start from `{}`. */
export function emptyIR(modality: Modality, mode: Mode = 'generate'): PromptIR {
  return { irVersion: IR_VERSION, modality, mode };
}
