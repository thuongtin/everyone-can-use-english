/**
 * Reads text aloud with the browser speech synthesis that ships with the
 * operating system. The dictionary needs pronunciation without a TTS provider
 * or a network call, and Web Speech covers exactly that.
 */

const normalize = (lang: string) => lang.replace("_", "-").toLowerCase();

export const speechAvailable = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

/** Picks the closest installed voice: exact locale first, then the language. */
export const findVoice = (lang: string): SpeechSynthesisVoice | undefined => {
  if (!speechAvailable()) return undefined;

  const wanted = normalize(lang);
  const voices = window.speechSynthesis.getVoices();

  return (
    voices.find((voice) => normalize(voice.lang) === wanted) ||
    voices.find((voice) => normalize(voice.lang).startsWith(wanted.slice(0, 2)))
  );
};

/**
 * Speaks `text` in `lang` (BCP 47, e.g. "en-US"). Returns false when speech
 * synthesis is unavailable so callers can tell the user instead of failing
 * silently.
 */
export const speakText = (text: string, lang: string): boolean => {
  if (!speechAvailable()) return false;
  if (!text.trim()) return false;

  const synthesis = window.speechSynthesis;
  synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = findVoice(lang);
  if (voice) utterance.voice = voice;
  synthesis.speak(utterance);

  return true;
};
