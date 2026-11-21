import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getLang, t } from '../../i18n';
import { goBack, navigate } from '../../router';
import { sfx } from '../../audio/sfx';
import { TopBar, Stars } from '../components/ui';
import { IconChevron, IconLock, IconStar } from '../icons';
import { WORLDS, worldNeeded, worldUnlocked } from '../../levels';
import { loadBest, loadProgress } from '../../storage';
import { campaignStats, continueTarget } from '../progress';
import { mechTitle } from '../mechanics';
import { useSettings } from '../settings';

const HEX = 'M25 2.5 L46.5 15 L46.5 40 L25 52.5 L3.5 40 L3.5 15 Z';

function LevelHex({ n, stars, done, current, started, onClick }: { n: number; stars: number; done: boolean; current: boolean; started: boolean; onClick: () => void }) {
  return (
    <button class={'lvl' + (done ? ' done' : '') + (current ? ' current' : '') + (started ? ' started' : '')} onClick={onClick} aria-label={t('level', { n })}>
      <svg viewBox="0 0 50 55" class="lvl-hex" aria-hidden="true">
        <path class="lh-base" d={HEX} transform="translate(0 2.5)" />
        <path class="lh-face" d={HEX} />
      </svg>
      <span class="lvl-n">{n}</span>
      <Stars n={done ? stars : 0} size={11} />
    </button>
  );
}

export function WorldsScreen() {
  useSettings();
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
            <div class="pill stars-pill">
              <IconStar />
              <b>{st.stars}</b>
              <small>/{st.maxStars}</small>
            </div>
          }
        />
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
                  <span class="w-num">{wi + 1}</span>
                  <span class="w-info">
                    <span class="w-title">{w.title[lang]}</span>
                    <span class="w-mech">
                      {unlocked
                        ? w.mechanics
                            .slice(0, 4)
                            .map((m) => t(mechTitle(m)).replace(/ \{n\}| -n-/, ''))
                            .join(' · ')
                        : t('unlockHint', { n: worldNeeded(wi), world: WORLDS[wi - 1]?.title[lang] ?? '' })}
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
