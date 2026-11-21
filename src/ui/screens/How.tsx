import { useMemo, useRef, useState } from 'preact/hooks';
import { act, chordMoves } from '../../core/game';
import { newGameV2 } from '../game/compat';
import { CellState, type MechanicId } from '../../core/types';
import { pn, t } from '../../i18n';
import { goBack } from '../../router';
import { buzz, sfx, unlockAudio } from '../../audio/sfx';
import { TopBar, useReducedMotion } from '../components/ui';
import { GameBoard, type BoardHandle, type Target } from '../game/Board';
import { layoutBoard } from '../game/geometry';
import { cellProps, newFx, precompute } from '../game/view';
import { buildSample } from '../../levels/samples';
import { MECH_ORDER, mechTitle } from '../mechanics';
import { MechIcon } from '../components/MechIcon';
import { loadSeen } from '../../storage';
import { Explainer } from '../game/Explainer';
import { IconCheck, IconGem, IconLock, IconRestart } from '../icons';
import { useSettings } from '../settings';

export const TUTORIAL = buildSample({
  id: 'tutorial',
  title: '',
  w: 4,
  h: 3,
  holes: ['0,2', '3,2'],
  gems: ['1,1', '3,0'],
  start: ['0,0'],
});

function TryBoard() {
  const reduced = useReducedMotion();
  const ref = useRef<BoardHandle>(null);
  const [round, setRound] = useState(0);
  const [, bump] = useState(0);
  const s = useMemo(() => {
    const g = newGameV2(TUTORIAL, 'gentle');
    const layout = layoutBoard(g.board);
    return { g, layout, pre: precompute(g.board, layout), fx: newFx(g.board.n) };
  }, [round]);
  const [press, setPress] = useState<{ cell: number; toGem: boolean; key: number } | null>(null);
  const won = !!s.g.finishedAt;
  const doAct = (i: number, a: 'reveal' | 'mark') => {
    unlockAudio();
    if (s.g.state[i] !== CellState.Hidden) return;
    const r = act(s.g, i, a);
    if (!r.ok) {
      if (r.illegal) return;
      sfx.mistake();
      buzz([25, 40, 25]);
      ref.current?.shake();
      ref.current?.cellEl(i)?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 380 });
      bump((n) => n + 1);
      return;
    }
    s.fx.enter[i] = a === 'mark' ? 'pop' : 'flip';
    if (a === 'mark') {
      sfx.gem();
      ref.current?.spawn('sparkle', i);
    } else sfx.open();
    if (r.won) {
      setTimeout(() => sfx.win(), 200);
      s.g.board.level.cells.forEach((c, j) => c.gem && ref.current?.spawn('bloom', j, 200 + j * 40));
    }
    bump((n) => n + 1);
  };
  const tap = (tg: Target) => {
    if (tg.t !== 'cell') return;
    if (s.g.state[tg.i] === CellState.Hidden) doAct(tg.i, 'reveal');
  };
  const alt = (tg: Target) => {
    if (tg.t !== 'cell') return;
    if (s.g.state[tg.i] === CellState.Hidden) doAct(tg.i, 'mark');
    else for (const m of chordMoves(s.g, tg.i)) doAct(m.cell, m.action);
  };
  const cells = cellProps(s.g, s.pre, s.layout, s.fx);
  const left = s.g.board.totalGems - s.g.marked;
  return (
    <div class={'try' + (won ? ' won' : '')}>
      <div class="try-top">
        <span class="pill">
          <IconGem />
          <b>{left}</b>
        </span>
        <span class="try-msg">{won ? t('howTryDone') : t('howTryMsg')}</span>
        <button class="icon-btn small" aria-label={t('restart')} onClick={() => { sfx.tick(); setRound((r) => r + 1); }}>
          {won ? <IconCheck /> : <IconRestart />}
        </button>
      </div>
      <div class="try-board">
        <GameBoard
          ref={ref}
          board={s.g.board}
          layout={s.layout}
          cells={cells}
          zoneValues={[]}
          zoneDone={[]}
          linkDone={[]}
          highlights={[]}
          hintCell={-1}
          hover={-1}
          press={press}
          staticWalls=""
          portals={[]}
          badges={[]}
          reducedMotion={reduced}
          maxCell={46}
          pad={10}
          onTap={tap}
          onDoubleTap={(tg) => (tg.t === 'cell' && s.g.state[tg.i] !== CellState.Hidden ? alt(tg) : tap(tg))}
          onLong={(tg) => {
            setPress(null);
            buzz(12);
            alt(tg);
          }}
          onAlt={alt}
          onPressStart={(tg) => tg.t === 'cell' && s.g.state[tg.i] === CellState.Hidden && setPress({ cell: tg.i, toGem: true, key: Date.now() })}
          onPressEnd={() => setPress(null)}
          onHover={() => {}}
        />
      </div>
    </div>
  );
}

export function HowScreen() {
  useSettings();
  const [mech, setMech] = useState<MechanicId | null>(null);
  const list = MECH_ORDER;
  // mechanics the player has not met yet stay locked (the basics are always open)
  const seen = new Set<string>([...loadSeen(), 'basic', 'counter', 'fog']);
  const locked = list.filter((m) => !seen.has(m));
  return (
    <div class="screen how">
      <div class="screen-inner">
        <TopBar title={t('howTitle')} onBack={() => goBack('/')} />
        <p class="lead">{t('howIntro')}</p>
        <TryBoard />
        <div class="steps">
          <div class="step">
            <span class="st-n">1</span>
            <span>{t('howStep1')}</span>
          </div>
          <div class="step">
            <span class="st-n">2</span>
            <span>{t('howStep2')}</span>
          </div>
          <div class="step">
            <span class="st-n">3</span>
            <span>{t('howStep3')}</span>
          </div>
        </div>
        <h3 class="sect">{t('howControls')}</h3>
        <ul class="controls">
          <li>{t('howTap')}</li>
          <li>{t('howHold')}</li>
          <li>{t('howPin')}</li>
          <li>{t('howDouble')}</li>
          <li class="keys">{t('howKeys')}</li>
        </ul>
        <h3 class="sect">{t('mechanicsTitle')}</h3>
        <div class="mlist">
          {list
            .filter((m) => seen.has(m))
            .map((m) => (
              <button
                key={m}
                class="mrow"
                onClick={() => {
                  sfx.tick();
                  setMech(m);
                }}
              >
                <MechIcon m={m} />
                <span class="mr-t">{t(mechTitle(m))}</span>
              </button>
            ))}
        </div>
        {locked.length > 0 && (
          <div class="mlocked" aria-label={t('mechLocked')}>
            <div class="ml-cap">
              <IconLock />
              <span>{t('mechLockedN', { n: pn(locked.length, 'pl_mech') })}</span>
            </div>
            <div class="ml-hexes" aria-hidden="true">
              {locked.map((m) => (
                <span key={m} class="ml-hex">
                  ?
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <Explainer mechs={mech ? [mech] : []} open={!!mech} onClose={() => setMech(null)} />
    </div>
  );
}
