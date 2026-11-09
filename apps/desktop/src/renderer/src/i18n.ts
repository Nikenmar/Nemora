import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './assets/locales/en/en.json';
import type { DropdownOption } from './components/Dropdown';
import { pickLanguage, SYSTEM_LANGUAGE } from './other/appLanguage';

/** English is always there, as the fallback; another language is loaded only when it is the one in use. */
export const languageLoaders = {
  en: () => Promise.resolve({ default: en }),
  ru: () => import('./assets/locales/ru/ru.json'),
  uk: () => import('./assets/locales/uk/uk.json'),
  de: () => import('./assets/locales/de/de.json'),
  es: () => import('./assets/locales/es/es.json'),
  pt: () => import('./assets/locales/pt/pt.json'),
  it: () => import('./assets/locales/it/it.json'),
  fr: () => import('./assets/locales/fr/fr.json'),
  ja: () => import('./assets/locales/ja/ja.json'),
  'zh-CN': () => import('./assets/locales/zh-CN/zh-CN.json'),
  ko: () => import('./assets/locales/ko/ko.json'),
  ar: () => import('./assets/locales/ar/ar.json'),
  hi: () => import('./assets/locales/hi/hi.json')
};

export const supportedLanguagesDropdownOptions: DropdownOption<LanguageCodes>[] = [
  { label: `English`, value: 'en' },
  { label: `Русский`, value: 'ru' },
  { label: `Українська`, value: 'uk' },
  { label: `Deutsch`, value: 'de' },
  { label: `Español`, value: 'es' },
  { label: `Português`, value: 'pt' },
  { label: `Italiano`, value: 'it' },
  { label: `Français`, value: 'fr' },
  { label: `日本語`, value: 'ja' },
  { label: `简体中文`, value: 'zh-CN' },
  { label: `한국어`, value: 'ko' },
  { label: `العربية`, value: 'ar' },
  { label: `हिन्दी`, value: 'hi' }
];

const supportedLanguages = Object.keys(languageLoaders);

/** The language a saved setting means now; `system` and a language no longer offered follow Windows. */
export const resolveLanguage = (saved?: string | null) =>
  pickLanguage(saved, navigator.languages, supportedLanguages) as LanguageCodes;

/** What the language dropdown shows as chosen. */
export const chosenLanguage = (saved?: string | null): LanguageCodes | typeof SYSTEM_LANGUAGE =>
  saved && saved !== SYSTEM_LANGUAGE && supportedLanguages.includes(saved)
    ? (saved as LanguageCodes)
    : SYSTEM_LANGUAGE;

/** Makes a language's strings available; English and a language already loaded need nothing. */
export const loadLanguage = async (language: LanguageCodes) => {
  if (language === 'en' || i18n.hasResourceBundle(language, 'translation')) return;
  const { default: translation } = await languageLoaders[language]();
  i18n.addResourceBundle(language, 'translation', translation);
};

const userData = await window.api.userData.getUserData();

const language = resolveLanguage(userData.language);

// Read by styles.css: the fonts of some scripts, and Arabic's direction.
document.documentElement.lang = language;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false } // React is safe from xss attacks
});

await loadLanguage(language);

export default i18n;
