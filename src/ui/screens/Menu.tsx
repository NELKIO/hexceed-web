import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getLang, t } from '../../i18n';
import { navigate } from '../../router';
import { sfx, unlockAudio } from '../../audio/sfx';
import { HexBackground } from '../components/HexBackground';
import { IconArrow, IconCalendar, IconGear, IconHelp, IconHexes, IconInfinity, IconStar, IconTrophy, IconUsers, LogoMark } from '../icons';
import { HeroBoard } from '../components/HeroBoard';
import { StatsSheet } from './Stats';
import { campaignStats, continueTarget } from '../progress';
import { applyUpdate, useUpdateReady } from '../pwa';
import { loadBest } from '../../storage';
import { WORLDS } from '../../levels';
import { dailyNumber, dailyStreak, loadDaily } from '../../storage';
import { pregenDaily, todayISO } from '../engine';
import { useSettings } from '../settings';
import { wt } from '../workshop/i18n';
import { IcPencil } from '../workshop/icons';


/** A mode card: line icon, title, a mono meta line; an optional mono badge top-right. */
function Card({ icon, title, meta, onClick, badge }: { icon: JSX.Element; title: string; meta: ComponentChildren; onClick: () => void; badge?: ComponentChildren }) {
  return (
    <button class="mcard" onClick={onClick}>
      <span class="mc-top">
        <span class="mc-ic">{icon}</span>
        {badge && <span class="mc-badge">{badge}</span>}
      </span>
      <span class="mc-t">{title}</span>
      <span class="mc-s">{meta}</span>
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
  const lang = getLang();
  const update = useUpdateReady();
  // today's puzzle is generated while the player looks at the menu, so it opens instantly
  useEffect(() => pregenDaily(), []);
  // campaign card: the world in progress, "Мир 01 · 3/12"
  const cwi = cont?.world ?? 0;
  const cw = WORLDS[cwi];
  const best = loadBest();
  const cwDone = cw ? cw.levels.filter((id) => best[id]).length : 0;
  const campMeta = cw ? `${t('world', { n: cwi + 1 })} · ${cwDone}/${cw.levels.length}` : '';
  const contSub = cont ? t('playSub', { world: WORLDS[cont.world]?.title[lang] ?? '', n: cont.index + 1 }) : '';
  return (
    <div class="menu">
      <HexBackground />
      {update && (
        <button class="update-bar" onClick={() => applyUpdate()}>
          <span>{t('updateReady')}</span>
          <b>{t('updateApply')}</b>
        </button>
      )}
      <div class="menu-inner">
        <div class="menu-main">
          <header class="brand">
            <LogoMark class="brand-mark" />
            <h1 class="brand-name">Hexlume</h1>
            <p class="brand-tag">{t('tagline')}</p>
          </header>

          <div class="menu-hero">
            <HeroBoard />
          </div>

          <nav class="menu-actions">
            <button class="cta-big" onClick={() => cont && go('/play/' + cont.id)}>
              <span class="cb-text">
                <span class="cb-t">{cont && !cont.fresh ? t('continue') : t('play')}</span>
                <span class="cb-s">{contSub}</span>
              </span>
              <span class="cb-ic">
                <IconArrow />
              </span>
            </button>

            <div class="mgrid">
              <Card
                icon={<IconHexes />}
                title={t('campaign')}
                meta={campMeta}
                badge={
                  st.stars ? (
                    <span class="mc-stars" title={t('mf_st_stars')} aria-label={`${t('mf_st_stars')}: ${st.stars}`}>
                      <IconStar />
                      {st.stars}
                    </span>
                  ) : undefined
                }
                onClick={() => go('/worlds')}
              />
              <Card
                icon={<IconCalendar />}
                title={t('daily')}
                meta={`№${dailyNumber(today)} · ${daily ? t('dailyDoneShort') : t('dailyNewShort')}`}
                badge={
                  streak.current > 0 ? (
                    <span class="mc-streak" title={t('mf_st_streak')}>{t('mf_streak', { n: streak.current })}</span>
                  ) : daily ? undefined : (
                    <span class="mc-dot" aria-hidden="true" />
                  )
                }
                onClick={() => go('/daily')}
              />
              <Card icon={<IconInfinity />} title={t('endless')} meta={t('endlessSub')} onClick={() => go('/endless')} />
              <Card icon={<IconUsers />} title={t('together')} meta={t('togetherSub')} onClick={() => go('/together')} />
              {/* wide screens: the workshop is one more row of the list (on phones it is a small link below) */}
              <button class="mcard mc-wide ml-ws-card" onClick={() => go('/workshop')}>
                <span class="mc-ic">
                  <IcPencil />
                </span>
                <span class="mc-t">{wt('ws_title')}</span>
                <span class="mc-s">{wt('ws_menuSub')}</span>
              </button>
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
              <button class="ml-ws" onClick={() => go('/workshop')}>
                <IcPencil />
                <span>{wt('ws_title')}</span>
              </button>
            </div>
          </nav>
        </div>
      </div>
      <StatsSheet open={stats} onClose={() => setStats(false)} />
    </div>
  );
}
