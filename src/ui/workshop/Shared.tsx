// Playing editor levels: the test run from the editor and a level opened from a share link.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { decodeLevel, type SharedLevel } from '../../core/editor-utils';
import { validateLevel } from '../../core/validate';
import { goBack, navigate } from '../../router';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { getBest, loadProgress, saveProgress } from '../../storage';
import { GameView } from '../game/GameView';
import { fmtTime, TopBar } from '../components/ui';
import { IconArrow, IconGem, IconPlay, LogoMark } from '../icons';
import { useSettings } from '../settings';
import { wt } from './i18n';
import { gemCount, hexCount, playable } from './ops';
import { loadDraft } from './store';
import { createDraft } from './Workshop';
import { IcPencil } from './icons';

/** `#/workshop/test/<id>`: the draft in the normal game, back returns to the editor. */
export function TestScreen({ params }: { params: string[] }) {
  useSettings();
  const id = params[0];
  const back = '/workshop/edit/' + id;
  const store = 'ws-test-' + id;
  const level = useMemo(() => {
    const d = loadDraft(id);
    if (!d) return null;
    // every test starts from the beginning
    saveProgress(store, null);
    return validateLevel(playable(d.level, store, d.title.trim() || undefined));
  }, [id]);
  const title = useMemo(() => loadDraft(id)?.title.trim() || wt('ws_untitled'), [id]);
  if (!level) {
    return (
      <div class="screen">
        <div class="screen-inner">
          <TopBar title={wt('test_invalid')} onBack={() => goBack(back)} />
        </div>
      </div>
    );
  }
  return (
    <GameView
      key={store}
      level={level}
      storeKey={store}
      noRecord
      title={title}
      subtitle={wt('test_sub')}
      backTo={back}
      next={{ label: wt('backToEditor'), go: () => goBack(back) }}
    />
  );
}

/** Make an editable copy of a shared level and open it in the editor. */
function remix(s: SharedLevel, code: string): void {
  const base = s.title || wt('l_anon');
  const d = createDraft({ title: wt('l_remixName', { name: base }).slice(0, 60), level: playable(s.level, 'draft'), remixOf: code });
  navigate('/workshop/edit/' + d.id);
}

/** `#/l/<code>`: a level from a share link. */
export function SharedScreen({ params }: { params: string[] }) {
  useSettings();
  const code = params[0] ?? '';
  const [res, setRes] = useState<SharedLevel | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let alive = true;
    setRes(undefined);
    setPlaying(false);
    void decodeLevel(code).then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, [code]);

  if (res === undefined) {
    return (
      <div class="screen center">
        <div class="screen-inner">
          <TopBar onBack={() => goBack('/')} />
          <div class="loading">
            <LogoMark class="spinner" />
            <p>{wt('l_loading')}</p>
          </div>
        </div>
      </div>
    );
  }
  if (res === null) {
    return (
      <div class="screen center">
        <div class="screen-inner">
          <TopBar onBack={() => goBack('/')} />
          <div class="l-card">
            <h2>{wt('l_bad')}</h2>
            <p class="lead">{wt('l_badSub')}</p>
            <button class="btn cta big" onClick={() => navigate('/', true)}>{t('toMenu')}</button>
          </div>
        </div>
      </div>
    );
  }
  const level = res.level;
  const title = res.title || wt('l_anon');
  const sub = [res.author ? wt('l_by', { name: res.author }) : '', res.diff ? wt('st_diff', { d: res.diff }) : ''].filter(Boolean).join(' · ');
  if (playing) {
    return (
      <GameView
        key={level.id}
        level={level}
        storeKey={level.id}
        title={title}
        subtitle={sub || undefined}
        backTo="/"
        next={{ label: wt('l_remix'), go: () => remix(res, code) }}
      />
    );
  }
  const best = getBest(level.id);
  const saved = loadProgress(level.id);
  return (
    <div class="screen center">
      <div class="screen-inner">
        <TopBar onBack={() => goBack('/')} />
        <div class="l-card">
          <span class="l-kicker">{wt('l_anon')}</span>
          <h2 class="l-title">{title}</h2>
          {res.author && <p class="l-by">{wt('l_by', { name: res.author })}</p>}
          <dl class="l-stats">
            <div>
              <dt>{wt('l_diff')}</dt>
              <dd class="mono">{res.diff ? `${res.diff}/10` : '—'}</dd>
            </div>
            <div>
              <dt>{wt('l_size')}</dt>
              <dd class="mono">{hexCount(level)}</dd>
            </div>
            <div>
              <dt>{wt('l_lights')}</dt>
              <dd class="mono lume">
                <IconGem />
                {gemCount(level)}
              </dd>
            </div>
          </dl>
          {best && <p class="l-best">{wt('l_best', { time: fmtTime(best.time) })}</p>}
          <button class="cta-big slim" onClick={() => { sfx.tick(); setPlaying(true); }} autoFocus>
            <span class="cb-text">
              <span class="cb-t">{saved ? wt('l_resume') : wt('l_play')}</span>
              <span class="cb-s">{wt('l_playSub')}</span>
            </span>
            <span class="cb-ic">{saved ? <IconArrow /> : <IconPlay />}</span>
          </button>
          <button class="btn ghost" onClick={() => { sfx.tick(); remix(res, code); }}>
            <IcPencil />
            <span>{wt('l_remix')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
