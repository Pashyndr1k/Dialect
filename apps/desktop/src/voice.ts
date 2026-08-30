import { invoke } from '@tauri-apps/api/core';

/**
 * Recording, in the window; transcribing, on the host.
 *
 * The split is the same one everything else here follows: the web view owns the
 * microphone because only it has one, and the host owns whatever turns sound
 * into words, because that is either a program on PATH or a request carrying a
 * key — and neither belongs in a page.
 */

const hasHost = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface VoiceTools {
  /** Which whisper is on PATH, if any. */
  whisper: string | null;
  /** Whether a transcription key is stored. */
  api: boolean;
  /** Whether anything here can turn speech into text at all. */
  ready: boolean;
}

export async function voiceTools(): Promise<VoiceTools> {
  if (!hasHost()) return { whisper: null, api: false, ready: false };
  try {
    return await invoke<VoiceTools>('voice_tools', {});
  } catch {
    return { whisper: null, api: false, ready: false };
  }
}

export interface Recording {
  /** Stop, and hand back what was recorded. */
  stop(): Promise<{ base64: string; extension: string }>;
  /** Stop and throw it away. */
  cancel(): void;
}

/** `audio/webm;codecs=opus` is the extension `webm`. */
const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split(';')[0]?.split('/')[1] ?? 'webm';
  return subtype === 'mpeg' ? 'mp3' : subtype.replace(/[^a-z0-9]/g, '') || 'webm';
};

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording back.'));
    // A data URL, of which only the part after the comma is the base64.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });

export async function record(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This window has no microphone available.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  // The tracks hold the microphone open — and the indicator light on — until
  // they are stopped, which has to happen down every path out of here.
  const release = (): void => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });

          if (blob.size === 0) {
            reject(new Error('Nothing was recorded.'));
            return;
          }
          toBase64(blob).then(
            (base64) => resolve({ base64, extension: extensionOf(type) }),
            reject,
          );
        };
        recorder.stop();
      }),

    cancel: () => {
      recorder.onstop = release;
      if (recorder.state !== 'inactive') recorder.stop();
      else release();
    },
  };
}

export const transcribe = (base64Audio: string, extension: string): Promise<string> =>
  invoke<string>('voice_transcribe', { base64Audio, extension });
