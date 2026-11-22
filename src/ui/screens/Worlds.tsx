import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getLang, plural, t } from '../../i18n';
import { goBack, navigate } from '../../router';
import { sfx } from '../../audio/sfx';
import { TopBar, Stars } from '../components/ui';
import { IconChevron, IconLock, IconStar } from '../icons';
import { useCampaign, WORLDS, worldNeeded, worldUnlocked } from '../../levels';
import { loadBest, loadProgress } from '../../storage';
import { campaignStats, continueTarget } from '../progress';
import { mechTitle } from '../mechanics';
import { useSettings } from '../settings';

// flat-top, like the board
const HEX = 'M14.2 3.6 H35.8 L46.6 22.3 L35.8 41 H14.2 L3.4 22.3 Z';

function LevelHex({ n, stars, done, current, started, onClick }: { n: number; stars: number; done: boolean; current: boolean; started: boolean; onClick: () => void }) {
  return (
    <button class={'lvl' + (done ? ' done' : '') + (current ? ' current' : '') + (started ? ' started' : '')} onClick={onClick} aria-label={t('level', { n })}>
      <svg viewBox="0 0 50 44.6" class="lvl-hex" aria-hidden="true">
        <path class="lh-face" d={HEX} />
      </svg>
      <span class="lvl-n">{n}</span>
      <Stars n={done ? stars : 0} size={9} />
    </button>
  );
}

export function WorldsScreen() {
  useSettings();
  useCampaign();
  const lang = getLang();
  const best = loadBest();
  const isDone = (id: string) => !!best[id];
  const cont = continueTarget();
  const [open, setOpen] = useState<number>(cont?.world ?? 0);
  const st = campaignStats();

  return (
    <div class="screen worlds">
      <div class="screen-inner">
        <TopBar
          title={t('campaign')}
          onBack={() => goBack('/')}
          right={
            <div class="pill stars-pill" title={`${st.stars} / ${st.maxStars}`}>
              <IconStar />
              <b>{st.stars}</b>
              <small>{plural(st.stars, 'mf_star1', 'mf_star2', 'mf_star5')}</small>
            </div>
          }
        />
        <p class="w-summary">{t('mf_worldsSummary', { done: st.done, total: st.total, levels: plural(st.total, 'mf_lvlOf1', 'mf_lvlOf5', 'mf_lvlOf5') })}</p>
        <div class="wlist">
          {WORLDS.map((w, wi) => {
            const unlocked = worldUnlocked(wi, isDone);
            const done = w.levels.filter(isDone).length;
            const stars = w.levels.reduce((s, id) => s + (best[id]?.stars ?? 0), 0);
            const expanded = open === wi && unlocked;
            const pct = Math.round((done / w.levels.length) * 100);
            return (
              <section
                key={w.id}
                class={'world' + (unlocked ? '' : ' locked') + (expanded ? ' open' : '')}
                style={{ '--wc': w.accent, '--wd': wi } as JSX.CSSProperties}
              >
                <button
                  class="w-head"
                  onClick={() => {
                    sfx.tick();
                    if (unlocked) setOpen(expanded ? -1 : wi);
                  }}
                  aria-expanded={expanded}
                >
                  <span class="w-num">{String(wi + 1).padStart(2, '0')}</span>
                  <span class="w-info">
                    <span class="w-title">{w.title[lang]}</span>
                    <span class="w-mech">
                      {unlocked
                        ? w.mechanics
                            .slice(0, 4)
                            .map((m) => t(mechTitle(m)))
                            .join(' · ')
                        : t('unlockHint', {
                            n: worldNeeded(wi),
                            levels: `${worldNeeded(wi)} ${plural(worldNeeded(wi), 'mf_lvl1', 'mf_lvl2', 'mf_lvl5')}`,
                            world: WORLDS[wi - 1]?.title[lang] ?? '',
                          })}
                    </span>
                  </span>
                  <span class="w-side">
                    {unlocked ? (
                      <>
                        <span class="w-stars">
                          <IconStar />
                          {stars}
                        </span>
                        <IconChevron class="w-chev" />
                      </>
                    ) : (
                      <IconLock class="w-lock" />
                    )}
                  </span>
                </button>
                <div class="w-bar">
                  <i style={{ width: pct + '%' }} />
                </div>
                {expanded && (
                  <div class="lgrid">
                    {w.levels.map((id, li) => (
                      <LevelHex
                        key={id}
                        n={li + 1}
                        stars={best[id]?.stars ?? 0}
                        done={isDone(id)}
                        current={cont?.id === id}
                        started={!isDone(id) && !!loadProgress(id)}
                        onClick={() => {
                          sfx.tick();
                          navigate('/play/' + id);
                        }}
                      />
                    ))}
                  </div>
                )}
                <div class="w-count">{t('levelsDone', { done, total: w.levels.length })}</div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
