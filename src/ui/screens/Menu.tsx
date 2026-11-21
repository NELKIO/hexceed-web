import type { JSX } from 'preact';
import { getLang, t } from '../../i18n';
import { navigate } from '../../router';
import { sfx, unlockAudio } from '../../audio/sfx';
import { HexBackground } from '../components/HexBackground';
import { IconCalendar, IconGear, IconHelp, IconHexes, IconInfinity, IconPlay, IconUsers, LogoMark } from '../icons';
import { campaignStats, continueTarget } from '../progress';
import { WORLDS } from '../../levels';
import { loadDaily } from '../../storage';
import { todayISO } from '../engine';
import { useSettings } from '../settings';

function Card({ icon, title, sub, tone, onClick, badge }: { icon: JSX.Element; title: string; sub: string; tone: string; onClick: () => void; badge?: string }) {
  return (
    <button class={'mcard tone-' + tone} onClick={onClick}>
      <span class="mc-ic">{icon}</span>
      {badge && <span class="mc-badge">{badge}</span>}
      <span class="mc-t">{title}</span>
      <span class="mc-s">{sub}</span>
    </button>
  );
}

export function MenuScreen() {
  useSettings();
  const go = (p: string) => {
    unlockAudio();
    sfx.tick();
    navigate(p);
  };
  const st = campaignStats();
  const cont = continueTarget();
  const daily = loadDaily()[todayISO()];
  const lang = getLang();
  const contSub = cont ? t('playSub', { world: WORLDS[cont.world]?.title[lang] ?? '', n: cont.index + 1 }) : '';
  return (
    <div class="menu">
      <HexBackground />
      <div class="menu-shade" />
      <div class="menu-inner">
        <div class="brand">
          <LogoMark class="brand-mark" />
          <div class="brand-name">Hexlume</div>
          <div class="brand-tag">{t('tagline')}</div>
        </div>

        <div class="menu-actions">
          <button class="cta-big" onClick={() => cont && go('/play/' + cont.id)}>
            <span class="cb-text">
              <span class="cb-t">{cont && !cont.fresh ? t('continue') : t('play')}</span>
              <span class="cb-s">{contSub}</span>
            </span>
            <span class="cb-ic">
              <IconPlay />
            </span>
          </button>

          <div class="mgrid">
            <Card
              tone="violet"
              icon={<IconHexes />}
              title={t('campaign')}
              sub={t('campaignSub', { done: st.done, total: st.total })}
              badge={st.stars ? `★ ${st.stars}` : undefined}
              onClick={() => go('/worlds')}
            />
            <Card
              tone="amber"
              icon={<IconCalendar />}
              title={t('daily')}
              sub={daily ? t('dailyDone', { stars: '★'.repeat(daily.stars) }) : t('dailyNew')}
              badge={daily ? undefined : '•'}
              onClick={() => go('/daily')}
            />
            <Card tone="teal" icon={<IconInfinity />} title={t('endless')} sub={t('endlessSub')} onClick={() => go('/endless')} />
            <Card tone="pink" icon={<IconUsers />} title={t('together')} sub={t('togetherSub')} onClick={() => go('/together')} />
          </div>

          <div class="mlinks">
            <button onClick={() => go('/how')}>
              <IconHelp />
              <span>{t('how')}</span>
            </button>
            <button onClick={() => go('/settings')}>
              <IconGear />
              <span>{t('settings')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
