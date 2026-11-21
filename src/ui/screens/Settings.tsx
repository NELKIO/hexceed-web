import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { t } from '../../i18n';
import { goBack } from '../../router';
import { Segmented, Sheet, Slider, Toggle, TopBar } from '../components/ui';
import { updateSettings, useSettings } from '../settings';
import { resetAll } from '../../storage';
import { IconAuto, IconEye, IconGlobe, IconHand, IconMoon, IconPalette, IconRotate, IconShield, IconSun, IconTrash, IconVibrate, IconVolume, LogoMark } from '../icons';
import { sfx } from '../../audio/sfx';
import { SyncRow } from '../online/entry';

function Row({ icon, title, sub, children, stack }: { icon: JSX.Element; title: string; sub?: string; children: ComponentChildren; stack?: boolean }) {
  return (
    <div class={'srow' + (stack ? ' stack' : '')}>
      <span class="s-ic">{icon}</span>
      <span class="s-text">
        <span class="s-t">{title}</span>
        {sub && <span class="s-s">{sub}</span>}
      </span>
      <span class="s-ctl">{children}</span>
    </div>
  );
}

export function SettingsScreen() {
  const s = useSettings();
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div class="screen settings">
      <div class="screen-inner">
        <TopBar title={t('settings')} onBack={() => goBack('/')} />
        <div class="sgroup">
          <Row icon={<IconGlobe />} title={t('language')} stack>
            <Segmented
              value={s.lang}
              onChange={(lang) => updateSettings({ lang })}
              options={[
                { v: 'auto', label: t('langAuto') },
                { v: 'ru', label: 'Русский' },
                { v: 'en', label: 'English' },
              ]}
            />
          </Row>
          <Row icon={<IconPalette />} title={t('theme')} stack>
            <Segmented
              value={s.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { v: 'auto', label: t('themeAuto'), icon: <IconAuto /> },
                { v: 'light', label: t('themeLight'), icon: <IconSun /> },
                { v: 'dark', label: t('themeDark'), icon: <IconMoon /> },
              ]}
            />
          </Row>
        </div>
        <div class="sgroup">
          <Row
            icon={<IconShield />}
            title={t('mistakeMode')}
            sub={t(s.mistakeMode === 'classic' ? 'mistakeClassicSub' : s.mistakeMode === 'hardcore' ? 'mistakeHardSub' : 'mistakeGentleSub')}
            stack
          >
            <Segmented
              value={s.mistakeMode}
              onChange={(mistakeMode) => updateSettings({ mistakeMode })}
              options={[
                { v: 'gentle', label: t('mistakeGentle') },
                { v: 'classic', label: t('mistakeClassic') },
                { v: 'hardcore', label: t('mistakeHard') },
              ]}
            />
          </Row>
          <Row icon={<IconRotate />} title={t('autoRotate')} sub={t('autoRotateSub')} stack>
            <Segmented
              value={String(s.autoRotate) as '0' | '15' | '30'}
              onChange={(v) => updateSettings({ autoRotate: Number(v) })}
              options={[
                { v: '0', label: t('autoOff') },
                { v: '15', label: '15 s' },
                { v: '30', label: '30 s' },
              ]}
            />
          </Row>
        </div>
        <div class="sgroup">
          <Row icon={<IconVolume />} title={t('sound')} stack>
            <Slider value={s.volume} label={t('sound')} onChange={(volume) => updateSettings({ volume })} />
          </Row>
          <Row icon={<IconVibrate />} title={t('vibration')}>
            <Toggle on={s.vibration} label={t('vibration')} onChange={(vibration) => updateSettings({ vibration })} />
          </Row>
          <Row icon={<IconHand />} title={t('leftHanded')} sub={t('leftHandedSub')}>
            <Toggle on={s.leftHanded} label={t('leftHanded')} onChange={(leftHanded) => updateSettings({ leftHanded })} />
          </Row>
          <Row icon={<IconEye />} title={t('colorBlind')} sub={t('colorBlindSub')}>
            <Toggle on={s.colorBlind} label={t('colorBlind')} onChange={(colorBlind) => updateSettings({ colorBlind })} />
          </Row>
        </div>
        <div class="sgroup">
          <SyncRow />
        </div>
        <button class="btn danger" onClick={() => { sfx.tick(); setAsk(true); }}>
          <IconTrash />
          <span>{done ? t('resetDone') : t('resetProgress')}</span>
        </button>
        <div class="about">
          <LogoMark />
          <span>Hexlume · {t('about')}</span>
        </div>
      </div>
      <Sheet open={ask} onClose={() => setAsk(false)} class="confirm" label={t('resetQ')}>
        <h2>{t('resetQ')}</h2>
        <div class="row">
          <button class="btn ghost" onClick={() => setAsk(false)}>{t('cancel')}</button>
          <button
            class="btn danger-fill"
            onClick={() => {
              resetAll();
              setAsk(false);
              setDone(true);
              sfx.mistake();
            }}
          >
            <IconTrash />
            <span>{t('resetYes')}</span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}
