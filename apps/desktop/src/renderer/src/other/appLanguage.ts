/** What Settings saves for "Same as system"; also the default of a new profile. */
export const SYSTEM_LANGUAGE = 'system';

/** The first of the system's languages the app has: `ru-RU` finds `ru`, `zh-TW` finds `zh-CN`. */
const fromSystem = (systemLanguages: readonly string[], supported: readonly string[]) => {
  for (const language of systemLanguages) {
    const wanted = language.toLowerCase();
    const base = wanted.split('-')[0];
    const match =
      supported.find((code) => code.toLowerCase() === wanted) ??
      supported.find((code) => code.toLowerCase().split('-')[0] === base);
    if (match) return match;
  }
  return 'en';
};

/**
 * The language to show. A saved language the app has is used as it is; anything else (`system`,
 * nothing saved, or a language no longer offered) follows the system, and English is the last resort.
 */
export function pickLanguage(
  saved: string | null | undefined,
  systemLanguages: readonly string[],
  supported: readonly string[]
): string {
  return saved && saved !== SYSTEM_LANGUAGE && supported.includes(saved)
    ? saved
    : fromSystem(systemLanguages, supported);
}
