/**
 * What kind of reference a file is.
 *
 * One list, in one place, because three parts of the app need the same answer:
 * the file dialog needs it as filters, the folder scan needs it to decide what
 * to keep, and the reader needs it to decide which of the three ways to read.
 * Three copies of a list of extensions is three chances for `.m4v` to work in
 * one place and not another.
 *
 * The extension is the whole test. A file dialog gives a path and nothing else,
 * and sniffing bytes to disagree with a name nobody mistyped is work that only
 * produces new ways to be wrong.
 */

export type ReferenceKind = 'image' | 'video' | 'audio';

export const EXTENSIONS: Record<ReferenceKind, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'wma'],
};

export const extensionOf = (name: string): string => {
  const at = name.lastIndexOf('.');
  return at < 0 ? '' : name.slice(at + 1).toLowerCase();
};

/** `undefined` for anything this app has no way to read. */
export function kindOf(name: string): ReferenceKind | undefined {
  const extension = extensionOf(name);
  for (const [kind, list] of Object.entries(EXTENSIONS)) {
    if (list.includes(extension)) return kind as ReferenceKind;
  }
  return undefined;
}

/** The last path segment, whichever kind of slash the platform used. */
export const nameOf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * What a browser puts in `File.type`. Needed because a file dropped on the page
 * arrives as bytes with a MIME type and no name on disk worth trusting.
 */
export function kindOfMediaType(mediaType: string): ReferenceKind | undefined {
  const family = mediaType.split('/')[0];
  return family === 'image' || family === 'video' || family === 'audio' ? family : undefined;
}

/** Image extension to MIME type, for bytes the host read off disk. */
export function mediaTypeOf(name: string): string {
  const extension = extensionOf(name);
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
  return `image/${extension || 'png'}`;
}

/** Every extension a file dialog should offer, in one flat list. */
export const ALL_EXTENSIONS: readonly string[] = [
  ...EXTENSIONS.image,
  ...EXTENSIONS.video,
  ...EXTENSIONS.audio,
];
