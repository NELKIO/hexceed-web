import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getLang, plural, t } from '../../i18n';
import { navigate } from '../../router';
import { sfx, unlockAudio } from '../../audio/sfx';
import { HexBackground } from '../components/HexBackground';
import { IconCalendar, IconGear, IconHelp, IconHexes, IconInfinity, IconPlay, IconStar, IconTrophy, IconUsers, LogoMark } from '../icons';
import { HeroBoard } from '../components/HeroBoard';
import { StatsSheet } from './Stats';
import { campaignStats, continueTarget } from '../progress';
import { WORLDS } from '../../levels';
import { dailyNumber, dailyStreak, loadDaily } from '../../storage';
import { todayISO } from '../engine';
import { useSettings } from '../settings';

function Card({ icon, title, sub, tone, onClick, badge }: { icon: JSX.Element; title: string; sub: string; tone: string; onClick: () => void; badge?: ComponentChildren }) {
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
  const [stats, setStats] = useState(false);
  const st = campaignStats();
  const cont = continueTarget();
  const today = todayISO();
  const daily = loadDaily()[today];
  const streak = dailyStreak(today);
  const dailyNo = t('mf_dailyNoShort', { n: dailyNumber(today) });
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
        <HeroBoard />

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
              sub={t('mf_campaignSub', { done: st.done, total: st.total, levels: plural(st.total, 'mf_lvlOf1', 'mf_lvlOf5', 'mf_lvlOf5') })}
              badge={
                st.stars ? (
                  <span class="mc-stars" aria-label={t('mf_starsBadge', { n: st.stars, stars: plural(st.stars, 'mf_star1', 'mf_star2', 'mf_star5') })}>
                    <IconStar />
                    {t('mf_starsBadge', { n: st.stars, stars: plural(st.stars, 'mf_star1', 'mf_star2', 'mf_star5') })}
                  </span>
                ) : undefined
              }
              onClick={() => go('/worlds')}
            />
            <Card
              tone="amber"
              icon={<IconCalendar />}
              title={t('daily')}
              sub={`${dailyNo} · ${daily ? t('dailyDone', { stars: '★'.repeat(daily.stars) }) : t('dailyNew')}`}
              badge={
                streak.current > 0 ? (
                  <span class="mc-streak">{t('mf_streak', { n: streak.current, days: plural(streak.current, 'mf_day1', 'mf_day2', 'mf_day5') })}</span>
                ) : daily ? undefined : (
                  <span class="mc-dot" />
                )
              }
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
            <button
              onClick={() => {
                unlockAudio();
                sfx.tick();
                setStats(true);
              }}
            >
              <IconTrophy />
              <span>{t('mf_stats')}</span>
            </button>
            <button onClick={() => go('/settings')}>
              <IconGear />
              <span>{t('settings')}</span>
            </button>
          </div>
        </div>
      </div>
      <StatsSheet open={stats} onClose={() => setStats(false)} />
    </div>
  );
}
