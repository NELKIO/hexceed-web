import { useEffect, useState } from 'preact/hooks';
import type { Level } from '../../core/types';
import { getLang, plural, t } from '../../i18n';
import { goBack, navigate } from '../../router';
import { getLevel, isKnownLevel, levelPos, nextLevelId, useCampaign, WORLDS, worldUnlocked } from '../../levels';
import { GameView } from '../game/GameView';
import { addEndlessTotals, bumpEndless, dailyNumber, dailyStreak, findProgress, loadBest, loadEndlessStats, loadProgress, saveDaily, saveLast } from '../../storage';
import { checkLevel, DIFFICULTIES, makeDaily, makeEndless, todayISO, type Difficulty } from '../engine';
import { showNotice } from '../notice';
import { IconRestart } from '../icons';
import { TopBar, fmtTime } from '../components/ui';
import { LogoMark, IconArrow, IconPlay } from '../icons';
import { sfx } from '../../audio/sfx';
import { useSettings } from '../settings';

const gemCount = (l: Level) => l.cells.reduce((s, c) => s + (c.gem ? 1 : 0), 0);

function Loading({ back, text, retry }: { back: string; text?: string; retry?: () => void }) {
  return (
    <div class="screen center">
      <div class="screen-inner">
        <TopBar onBack={() => goBack(back)} />
        <div class="loading">
          <LogoMark class={retry ? 'spinner stopped' : 'spinner'} />
          <p>{retry ? t('genFailed') : text ?? t('loading')}</p>
          {retry && (
            <button class="btn cta" onClick={() => { sfx.tick(); retry(); }}>
              <IconRestart />
              <span>{t('retry')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A generated level: the saved run's own level when there is one (validated), else generated.
 * A worker timeout ends in a "try again" state instead of blocking the main thread.
 */
function useGenerated(storeId: string, deps: unknown[], make: () => Promise<Level>): { level: Level | null; failed: boolean; retry: () => void } {
  const [level, setLevel] = useState<Level | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setLevel(null);
    setFailed(false);
    const saved = checkLevel(loadProgress(storeId)?.level);
    if (saved) setLevel({ ...saved, id: storeId });
    else
      make().then(
        (l) => alive && setLevel(l),
        (e) => {
          console.error('[hexlume] generation failed', e);
          if (alive) setFailed(true);
        },
      );
    return () => {
      alive = false;
    };
  }, [...deps, round]);
  return { level, failed, retry: () => setRound((r) => r + 1) };
}

export function PlayScreen({ params }: { params: string[] }) {
  useSettings();
  const loaded = useCampaign();
  const id = params[0];
  const level = getLevel(id);
  useEffect(() => {
    if (level) saveLast(id);
  }, [id, !!level]);
  if (!level && !loaded && isKnownLevel(id)) return <Loading back="/worlds" text={t('mf_loadingLevels')} />;
  const lockedPos = level ? levelPos(id) : undefined;
  if (lockedPos && !worldUnlocked(lockedPos.world, (x) => !!loadBest()[x])) return <LockedRedirect />;
  if (!level) {
    return (
      <div class="screen">
        <div class="screen-inner">
          <TopBar title={t('levelNotFound')} onBack={() => goBack('/worlds')} />
        </div>
      </div>
    );
  }
  const pos = levelPos(id);
  const lang = getLang();
  const world = pos ? WORLDS[pos.world] : undefined;
  const nextId = nextLevelId(id);
  const nextOk = (() => {
    if (!nextId) return false;
    const np = levelPos(nextId);
    if (!np) return false;
    const best = loadBest();
    return worldUnlocked(np.world, (x) => !!best[x] || x === id);
  })();
  return (
    <GameView
      key={id}
      level={level}
      storeKey={id}
      title={pos ? t('level', { n: pos.index + 1 }) : (level.title ?? id)}
      subtitle={world && pos ? `${t('world', { n: String(pos.world + 1).padStart(2, '0') })} · ${world.title[lang]}` : undefined}
      backTo="/worlds"
      next={nextOk && nextId ? { label: t('next'), go: () => navigate('/play/' + nextId, true) } : null}
    />
  );
}

/** A deep link to a level of a world that is still locked: back to the map, with a word why. */
function LockedRedirect() {
  useEffect(() => {
    showNotice(t('levelLocked'));
    navigate('/worlds', true);
  }, []);
  return null;
}

export function DailyScreen() {
  useSettings();
  const date = todayISO();
  const { level, failed, retry } = useGenerated(`daily-${date}`, [date], () => makeDaily(date));
  if (!level) return <Loading back="/" retry={failed ? retry : undefined} />;
  const [y, m, d] = date.split('-');
  const no = dailyNumber(date);
  return (
    <GameView
      key={level.id}
      level={level}
      storeKey={level.id}
      saveLevel
      title={t('mf_dailyNo', { n: no })}
      subtitle={`${d}.${m}.${y}`}
      backTo="/"
      onWin={(w) => saveDaily(date, { levelId: level.id, stars: w.stars, time: w.time, mistakes: w.mistakes, hints: w.hints, gems: gemCount(level) })}
      shareText={(w) => {
        const sk = dailyStreak(date).current;
        const streak = sk > 0 ? `\n${t('mf_shareStreak', { n: sk, days: plural(sk, 'mf_day1', 'mf_day2', 'mf_day5') })}` : '';
        return `${t('mf_share', { n: no })}\n${'★'.repeat(w.stars)}${'☆'.repeat(3 - w.stars)} · ${fmtTime(w.time)}${streak}\nhttps://nelkio.github.io/hexceed-web/#/daily`;
      }}
    />
  );
}

const DIFF_TONE: Record<Difficulty, string> = { easy: 'teal', medium: 'violet', hard: 'amber', expert: 'pink' };

export function EndlessScreen({ params }: { params: string[] }) {
  useSettings();
  const diff = params[0] as Difficulty | undefined;
  const seed = params[1];
  if (diff && seed && DIFFICULTIES.includes(diff)) return <EndlessPlay diff={diff} seed={seed} />;
  const stats = loadEndlessStats();
  const resume = findProgress('endless-');
  return (
    <div class="screen">
      <div class="screen-inner">
        <TopBar title={t('endless')} onBack={() => goBack('/')} />
        <p class="lead">{t('endlessPick')}</p>
        {resume && (
          <button
            class="cta-big slim"
            onClick={() => {
              sfx.tick();
              const [, d, ...s] = resume.id.split('-');
              navigate(`/endless/${d}/${s.join('-')}`);
            }}
          >
            <span class="cb-text">
              <span class="cb-t">{t('resume')}</span>
              <span class="cb-s">{t(`diff_${resume.id.split('-')[1]}` as 'diff_easy')}</span>
            </span>
            <span class="cb-ic">
              <IconPlay />
            </span>
          </button>
        )}
        <div class="diffs">
          {DIFFICULTIES.map((d, k) => (
            <button
              key={d}
              class={'diff tone-' + DIFF_TONE[d]}
              onClick={() => {
                sfx.tick();
                navigate(`/endless/${d}/${Math.floor(Math.random() * 1e9).toString(36)}`);
              }}
            >
              <span class="d-pips">
                {[0, 1, 2, 3].map((p) => (
                  <i key={p} class={p <= k ? 'on' : ''} />
                ))}
              </span>
              <span class="d-text">
                <span class="d-t">{t(`diff_${d}`)}</span>
                <span class="d-s">{t(`diffDesc_${d}`)}</span>
              </span>
              <span class="d-n">{stats[d] ? t('solvedCount', { n: stats[d] }) : ''}</span>
              <IconArrow class="d-go" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EndlessPlay({ diff, seed }: { diff: Difficulty; seed: string }) {
  const { level, failed, retry } = useGenerated(`endless-${diff}-${seed}`, [diff, seed], () => makeEndless(seed, diff));
  if (!level) return <Loading back="/endless" retry={failed ? retry : undefined} />;
  return (
    <GameView
      key={level.id}
      level={level}
      storeKey={level.id}
      saveLevel
      title={t('endless')}
      subtitle={t(`diff_${diff}`)}
      backTo="/endless"
      onWin={(w) => {
        bumpEndless(diff);
        addEndlessTotals({ time: w.time, gems: gemCount(level), mistakes: w.mistakes });
      }}
      next={{ label: t('newBoard'), go: () => navigate(`/endless/${diff}/${Math.floor(Math.random() * 1e9).toString(36)}`, true) }}
    />
  );
}
