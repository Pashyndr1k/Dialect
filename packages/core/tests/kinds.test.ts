import { describe, expect, it } from 'vitest';

import {
  ALL_EXTENSIONS,
  EXTENSIONS,
  kindOf,
  kindOfMediaType,
  mediaTypeOf,
  nameOf,
} from '../src/extract/kinds.ts';

describe('what kind of reference a file is', () => {
  it('knows the three it can read', () => {
    expect(kindOf('cowboy.png')).toBe('image');
    expect(kindOf('saloon.mp4')).toBe('video');
    expect(kindOf('closing-time.mp3')).toBe('audio');
  });

  it('does not care how the extension was typed', () => {
    expect(kindOf('COWBOY.JPEG')).toBe('image');
    expect(kindOf('Clip.MOV')).toBe('video');
  });

  it('says nothing rather than guessing at what it cannot read', () => {
    expect(kindOf('notes.txt')).toBeUndefined();
    expect(kindOf('workflow.json')).toBeUndefined();
    expect(kindOf('no-extension')).toBeUndefined();
    expect(kindOf('')).toBeUndefined();
  });

  it('reads a name off either kind of path', () => {
    expect(nameOf('D:\\refs\\cowboy.png')).toBe('cowboy.png');
    expect(nameOf('/home/me/refs/cowboy.png')).toBe('cowboy.png');
    expect(nameOf('cowboy.png')).toBe('cowboy.png');
    // A trailing separator names the folder rather than nothing.
    expect(nameOf('/home/me/refs/')).toBe('refs');
  });

  it('takes a browser MIME type as well, for a file that was dropped', () => {
    expect(kindOfMediaType('image/webp')).toBe('image');
    expect(kindOfMediaType('video/quicktime')).toBe('video');
    expect(kindOfMediaType('audio/flac')).toBe('audio');
    expect(kindOfMediaType('application/pdf')).toBeUndefined();
    expect(kindOfMediaType('')).toBeUndefined();
  });

  it('names an image type the way a provider expects it', () => {
    expect(mediaTypeOf('a.jpg')).toBe('image/jpeg');
    expect(mediaTypeOf('a.jpeg')).toBe('image/jpeg');
    expect(mediaTypeOf('a.png')).toBe('image/png');
    expect(mediaTypeOf('a.webp')).toBe('image/webp');
  });

  it('offers every extension it knows in one list, with no duplicates', () => {
    expect(new Set(ALL_EXTENSIONS).size).toBe(ALL_EXTENSIONS.length);
    for (const list of Object.values(EXTENSIONS)) {
      for (const extension of list) expect(ALL_EXTENSIONS).toContain(extension);
    }
  });

  it('claims no extension for two kinds at once', () => {
    for (const extension of ALL_EXTENSIONS) {
      const claims = Object.entries(EXTENSIONS).filter(([, list]) => list.includes(extension));
      expect(claims.map(([kind]) => kind), `${extension} is claimed twice`).toHaveLength(1);
    }
  });
});
