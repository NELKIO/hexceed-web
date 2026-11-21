// Statistics sheet (from the menu): campaign progress, totals, daily streaks, per-world bars.

import type { ComponentChildren, JSX } from 'preact';
import { getLang, plural, t } from '../../i18n';
import { getLevel, useCampaign, WORLDS } from '../../levels';
import { dailyStreak, loadBest, loadDaily, loadEndlessStats, loadEndlessTotals } from '../../storage';
import { todayISO } from '../engine';
import { fmtTime, Sheet } from '../components/ui';
import { IconCalendar, IconClock, IconGem, IconHexes, IconInfinity, IconStar, IconTrophy, IconX } from '../icons';
import { sfx } from '../../audio/sfx';

function Tile({ icon, label, value, sub, tone }: { icon: JSX.Element; label: string; value: ComponentChildren; sub?: string; tone: string }) {
  return (
    <div class={'st-tile tone-' + tone}>
      <span class="st-ic">{icon}</span>
      <span class="st-v">{value}</span>
      <span class="st-l">{label}</span>
      {sub && <span class="st-s">{sub}</span>}
    </div>
  );
}

const days = (n: number) => `${n} ${plural(n, 'mf_day1', 'mf_day2', 'mf_day5')}`;

function StatsBody() {
  const loaded = useCampaign();
  const lang = getLang();
  const best = loadBest();
  const daily = loadDaily();
  const endless = loadEndlessTotals();
  const endlessWins = Object.values(loadEndlessStats()).reduce((s, n) => s + (n | 0), 0);
  const streak = dailyStreak(todayISO());

  let done = 0, total = 0, stars = 0, perfect = 0, time = 0, mistakes = 0, gems = 0;
  for (const w of WORLDS)
    for (const id of w.levels) {
      total++;
      const b = best[id];
      if (!b) continue;
      done++;
      stars += b.stars;
      if (b.stars >= 3) perfect++;
      time += b.time || 0;
      mistakes += b.mistakes || 0;
      const l = getLevel(id);
      if (l) gems += l.cells.reduce((s, c) => s + (c.gem ? 1 : 0), 0);
    }
  const dailyList = Object.values(daily);
  for (const d of dailyList) {
    time += d.time || 0;
    mistakes += d.mistakes || 0;
    gems += d.gems || 0;
  }
  time += endless.time;
  mistakes += endless.mistakes;
  gems += endless.gems;

  return (
    <div class="stats">
      <h2>{t('mf_stats')}</h2>
      <h3 class="st-h">{t('mf_st_campaign')}</h3>
      <div class="st-grid">
        <Tile tone="violet" icon={<IconHexes />} label={t('mf_st_levels')} value={<>{done}<small>/{total}</small></>} />
        <Tile tone="amber" icon={<IconStar />} label={t('mf_st_stars')} value={<>{stars}<small>/{total * 3}</small></>} />
        <Tile tone="teal" icon={<IconTrophy />} label={t('mf_st_perfect')} value={perfect} sub={t('mf_st_perfectSub')} />
        <Tile tone="violet" icon={<IconGem />} label={t('mf_st_gems')} value={loaded ? gems : '…'} />
        <Tile tone="pink" icon={<IconClock />} label={t('mf_st_time')} value={fmtTime(time)} />
        <Tile tone="pink" icon={<IconX />} label={t('mf_st_mistakes')} value={mistakes} />
      </div>
      <h3 class="st-h">{t('mf_st_daily')}</h3>
      <div class="st-grid st-grid4">
        <Tile tone="amber" icon={<span class="st-fire">🔥</span>} label={t('mf_st_streak')} value={days(streak.current)} />
        <Tile tone="amber" icon={<IconTrophy />} label={t('mf_st_bestStreak')} value={days(streak.best)} />
        <Tile tone="amber" icon={<IconCalendar />} label={t('mf_st_dailySolved')} value={dailyList.length} />
        <Tile tone="teal" icon={<IconInfinity />} label={t('mf_st_endless')} value={endlessWins} />
      </div>
      <h3 class="st-h">{t('mf_st_worlds')}</h3>
      <div class="st-worlds">
        {WORLDS.map((w, wi) => {
          const n = w.levels.filter((id) => best[id]).length;
          const pct = w.levels.length ? (n / w.levels.length) * 100 : 0;
          return (
            <div key={w.id} class="st-world" style={{ '--wc': w.accent } as JSX.CSSProperties}>
              <span class="st-wn">{wi + 1}</span>
              <span class="st-wt">{w.title[lang]}</span>
              <span class="st-wc">
                {n}/{w.levels.length}
              </span>
              <span class="st-bar">
                <i style={{ width: pct + '%' }} />
              </span>
            </div>
          );
        })}
      </div>
      <p class="st-note">{t('mf_st_note')}</p>
    </div>
  );
}

export function StatsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} class="stats-sheet" label={t('mf_stats')}>
      {open && <StatsBody />}
      <div class="sheet-foot">
        <button
          class="btn cta wide"
          onClick={() => {
            sfx.tick();
            onClose();
          }}
        >
          <span>{t('mf_close')}</span>
        </button>
      </div>
    </Sheet>
  );
}
