import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MainContainer from '../MainContainer';
import AppearanceSettings from './Settings/AppearanceSettings';
import AudioPlaybackSettings from './Settings/AudioPlaybackSettings';
import LyricsSettings from './Settings/LyricsSettings';
import DefaultPageSettings from './Settings/DefaultPageSettings';
import PreferencesSettings from './Settings/PreferencesSettings';
import AccessibilitySettings from './Settings/AccessibilitySettings';
import StartupSettings from './Settings/StartupSettings';
import AboutSettings from './Settings/AboutSettings';
import StorageSettings from './Settings/StorageSettings';
import EqualizerSettings from './Settings/EqualizerSettings';
import PerformanceSettings from './Settings/PerformanceSettings';
import AdvancedSettings from './Settings/AdvancedSettings';
import AccountsSettings from './Settings/AccountsSettings';
import LanguageSettings from './Settings/LanguageSettings';
import AgentsSettings from './Settings/AgentsSettings';

const SettingsPage = () => {
  const { t } = useTranslation();
  const sectionsRef = useRef<HTMLUListElement>(null);
  const [sections, setSections] = useState<{ title: string; icon: string }[]>([]);
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    const list = sectionsRef.current;
    if (!list) return undefined;
    const read = () =>
      setSections(
        [...list.querySelectorAll(':scope > li')].map((li) => {
          const title = li.querySelector('.title-container');
          const icon = title?.querySelector('.ms-icon')?.textContent ?? 'settings';
          return { title: (title?.textContent ?? '').replace(icon, '').trim(), icon };
        })
      );
    read();
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const items = [...list.querySelectorAll(':scope > li')];
        setActiveSection(items.indexOf(visible[0].target));
      },
      { rootMargin: '0px 0px -70% 0px' }
    );
    list.querySelectorAll(':scope > li').forEach((li) => observer.observe(li));
    const timer = window.setTimeout(read, 500);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <MainContainer className="main-container settings-container !h-full overflow-y-auto !pb-0 text-ink [scrollbar-gutter:stable]">
      <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-8 pr-4 lg:grid-cols-[minmax(0,1fr)]">
        <nav
          className="sticky top-0 flex h-fit flex-col gap-0.5 self-start pt-1 lg:hidden"
          aria-label={t('settingsPage.settings')}
        >
          <h1 className="mb-4 text-page font-semibold text-ink">{t('settingsPage.settings')}</h1>
          {sections.map((section, index) => (
            <button
              type="button"
              key={section.title}
              className={`flex h-8 items-center gap-2.5 rounded-full px-3 text-left text-body outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-echo ${
                activeSection === index ? 'bg-surface-2 font-medium text-ink' : 'text-ink-dim'
              }`}
              onClick={() => {
                const sections = sectionsRef.current?.querySelectorAll(':scope > li');
                sections?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="ms-icon text-[18px]">{section.icon}</span>
              <span className="truncate">{section.title}</span>
            </button>
          ))}
        </nav>

        <ul
          ref={sectionsRef}
          className="settings-sections flex flex-col gap-5 pb-10 pt-1 [&>li]:!mb-0 [&>li]:scroll-mt-2 [&>li]:rounded-panel [&>li]:bg-surface-1 [&>li]:px-6 [&>li]:pb-3 [&>li]:pt-5 [&_.title-container]:!mb-2 [&_.title-container]:!mt-0 [&_.title-container]:!text-section [&_.title-container]:font-semibold [&_.title-container_.ms-icon]:!text-[18px] [&_.title-container_.ms-icon]:text-ink-dim [&_ul.list-disc]:list-none [&_ul.list-disc]:!pl-0 [&_ul.list-disc>li]:!mb-0 [&_ul.list-disc>li]:border-t [&_ul.list-disc>li]:border-line [&_ul.list-disc>li]:py-4 [&_ul.list-disc>li:first-child]:border-t-0 [&_.description]:text-body [&_.description]:text-ink-dim"
        >
          {/*  APPEARANCE SETTINGS */}
          <AppearanceSettings />

          {/*  LANGUAGE SETTINGS */}
          <LanguageSettings />

          {/* ? AUDIO PLAYBACK SETTINGS */}
          <AudioPlaybackSettings />

          {/* ? ACCOUNTS SETTINGS */}
          <AccountsSettings />

          {/* ? LYRICS SETTINGS */}
          <LyricsSettings />

          {/* ? EQUALIZER SETTINGS */}
          <EqualizerSettings />

          {/* DEFAULT PAGE SETTINGS */}
          <DefaultPageSettings />

          {/* ? PREFERENCES SETTINGS */}
          <PreferencesSettings />

          {/* ? ACCESSIBILITY SETTINGS */}
          <AccessibilitySettings />

          {/* PERFORMANCE SETTINGS */}
          <PerformanceSettings />

          {/* STARTUP SETTINGS */}
          <StartupSettings />

          {/* STORAGE SETTINGS */}
          <StorageSettings />

          {/* AI AGENTS (PLAN/22) */}
          <AgentsSettings />

          {/* ADVANCED SETTINGS */}
          <AdvancedSettings />

          {/* ABOUT SETTINGS */}
          <AboutSettings />
        </ul>
      </div>
    </MainContainer>
  );
};

export default SettingsPage;
