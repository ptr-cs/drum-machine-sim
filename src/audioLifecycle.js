const DEFAULT_UNLOCK_TIMEOUT = 4000;

function browserNavigator() {
  return typeof navigator === "undefined" ? null : navigator;
}

export function isAppleMobile(navigatorObject = browserNavigator()) {
  if (!navigatorObject) return false;
  const userAgent = navigatorObject.userAgent ?? "";
  const platform = navigatorObject.platform ?? "";
  return /iPad|iPhone|iPod/.test(userAgent)
    || (platform === "MacIntel" && Number(navigatorObject.maxTouchPoints) > 1);
}

export function selectPlaybackAudioSession(navigatorObject = browserNavigator()) {
  const audioSession = navigatorObject?.audioSession;
  if (!audioSession) return false;
  try {
    audioSession.type = "playback";
    return audioSession.type === "playback";
  } catch {
    return false;
  }
}

export function primeAudioContext(context) {
  if (!context?.createBuffer || !context?.createBufferSource || !context?.destination) {
    return false;
  }

  try {
    const buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    source.start(0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForAudioUnlock(
  resume,
  getState,
  { timeout = DEFAULT_UNLOCK_TIMEOUT } = {},
) {
  let timeoutId;
  try {
    await Promise.race([
      Promise.resolve().then(resume),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Audio unlock timed out.")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  const state = getState();
  if (state !== "running") {
    throw new Error(`Audio context is ${state || "unavailable"}.`);
  }
  return state;
}
