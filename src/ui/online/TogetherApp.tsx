// "Вдвоём": the lobby (#/together) and a room (#/room/<CODE>) with the host's game setup,
// and the game itself (GameView with a co-op / race session). Loaded lazily with the networking code.

import '../../styles/online.css';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLang, t } from '../../i18n';
import { goBack, navigate } from '../../router';
import { sfx } from '../../audio/sfx';
import type { Level } from '../../core/types';
import { getLevel, levelPos, WORLDS, worldUnlocked } from '../../levels';
import { loadBest, saveProgress } from '../../storage';
import { continueTarget } from '../progress';
import { DIFFICULTIES, makeDaily, makeEndless, todayISO, type Difficulty } from '../engine';
import { GameView } from '../game/GameView';
import { Segmented, Sheet, Stars, TopBar, fmtTime } from '../components/ui';
import { IconArrow, IconCalendar, IconCopy, IconHexes, IconInfinity, IconPlay, IconShare, IconUsers, LogoMark } from '../icons';
import { useSettings } from '../settings';
import { formatRoomCode, inviteUrl, isRoomCode, lastRoom, loadProfile, loadRoomRecord, newRoomCode, parseRoomInput, saveProfile, saveRoomRecord, type Profile } from '../../net/ids';
import { closeRoom, openRoom } from '../../net/online';
import type { GameSetup, HostChoice, Mode, PuzzleSource, RoomSession, RoomSnapshot } from '../../net/room';
import { makeSession } from './bridge';
import { canShare, ConnBadge, copyText, partnerColor, PlayerChip, ProfileEditor, shareLink, useRoomSnap } from './parts';

function useProfile(): [Profile, (p: Profile) => void] {
  const [p, setP] = useState<Profile>(() => loadProfile(getLang()));
  return [
    p,
    (np: Profile) => {
      saveProfile(np);
      setP(np);
    },
  ];
}

// ------------------------------------------------------------------ lobby

export function Lobby() {
  useSettings();
  const [profile, setProfile] = useProfile();
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const last = lastRoom();
  const create = () => {
    sfx.tick();
    const c = newRoomCode();
    saveRoomRecord({ code: c, role: 'host', at: Date.now() });
    navigate('/room/' + c);
  };
  const join = (e?: Event) => {
    e?.preventDefault();
    const c = parseRoomInput(code);
    if (!c) {
      setBad(true);
      sfx.illegal();
      return;
    }
    sfx.tick();
    if (!loadRoomRecord(c)) saveRoomRecord({ code: c, role: 'guest', at: Date.now() });
    navigate('/room/' + c);
  };
  return (
    <div class="screen together">
      <div class="screen-inner">
        <TopBar title={t('togetherTitle')} onBack={() => goBack('/')} />
        <ProfileEditor profile={profile} onChange={setProfile} />
        <button class="cta-big" onClick={create}>
          <span class="cb-text">
            <span class="cb-t">{t('on_create')}</span>
            <span class="cb-s">{t('on_createSub')}</span>
          </span>
          <span class="cb-ic">
            <IconUsers />
          </span>
        </button>
        <form class="o-card join" onSubmit={join}>
          <label class="o-label" for="room-code">
            {t('on_haveCode')}
          </label>
          <div class="join-row">
            <input
              id="room-code"
              class={'code-input' + (bad ? ' bad' : '')}
              placeholder={t('on_codePh')}
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              spellcheck={false}
              onInput={(e) => {
                setCode((e.target as HTMLInputElement).value);
                setBad(false);
              }}
            />
            <button class="btn cta" type="submit">
              <span>{t('on_join')}</span>
            </button>
          </div>
          {bad && <p class="o-err">{t('on_badCode')}</p>}
        </form>
        {last && (
          <button class="o-link" onClick={() => { sfx.tick(); navigate('/room/' + last.code); }}>
            <IconArrow />
            <span>{t('on_backTo', { code: formatRoomCode(last.code) })}</span>
          </button>
        )}
        <p class="o-about">{t('on_about')}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ room

function titleOf(src: PuzzleSource, level: Level): { title: string; subtitle?: string } {
  const lang = getLang();
  if (src.k === 'campaign') {
    const p = levelPos(src.id);
    if (p) return { title: t('level', { n: p.index + 1 }), subtitle: WORLDS[p.world]?.title[lang] };
    return { title: level.title ?? t('campaign') };
  }
  if (src.k === 'daily') {
    const [y, m, d] = src.date.split('-');
    return { title: t('daily'), subtitle: `${d}.${m}.${y}` };
  }
  return { title: t('endless'), subtitle: DIFFICULTIES.includes(src.diff as Difficulty) ? t(`diff_${src.diff as Difficulty}`) : undefined };
}

function choiceLabel(c: HostChoice): string {
  const lang = getLang();
  if (c.src.k === 'campaign') {
    const p = levelPos(c.src.id);
    return p ? t('on_campaignLevel', { world: WORLDS[p.world]?.title[lang] ?? '', n: p.index + 1 }) : t('campaign');
  }
  if (c.src.k === 'daily') return t('daily');
  return `${t('endless')} · ${DIFFICULTIES.includes(c.src.diff as Difficulty) ? t(`diff_${c.src.diff as Difficulty}`) : c.src.diff}`;
}

function defaultChoice(): HostChoice {
  const cont = continueTarget();
  return { mode: 'coop', src: cont ? { k: 'campaign', id: cont.id } : { k: 'daily' } };
}

async function buildLevel(c: HostChoice): Promise<{ level: Level; src: PuzzleSource } | null> {
  if (c.src.k === 'campaign') {
    const level = getLevel(c.src.id);
    return level ? { level, src: { k: 'campaign', id: c.src.id } } : null;
  }
  if (c.src.k === 'daily') {
    const date = todayISO();
    return { level: await makeDaily(date), src: { k: 'daily', date } };
  }
  const diff = (DIFFICULTIES.includes(c.src.diff as Difficulty) ? c.src.diff : 'medium') as Difficulty;
  const seed = Math.floor(Math.random() * 1e9).toString(36);
  return { level: await makeEndless(seed, diff), src: { k: 'endless', diff, seed } };
}

export function RoomScreen({ code }: { code: string }) {
  useSettings();
  const [profile, setProfile] = useProfile();
  const role = loadRoomRecord(code)?.role ?? 'guest';
  const room = useMemo(() => {
    if (!loadRoomRecord(code)) saveRoomRecord({ code, role, at: Date.now() });
    else saveRoomRecord({ code, role, at: Date.now() });
    return openRoom(code, role, profile);
  }, [code]);
  useEffect(() => () => closeRoom(), [room]);
  const snap = useRoomSnap(room);
  const [inGame, setInGame] = useState(false);
  const [busy, setBusy] = useState(false);

  // a new game (started here or by the host) opens the board; an unfinished race board of the
  // previous game is not needed any more
  useEffect(() => {
    let prev = room.snapshot().game?.gid;
    return room.onGame((g) => {
      if (prev) saveProgress(`race-${code}-${prev}`, null);
      prev = g.gid;
      setInGame(true);
    });
  }, [room]);

  const busyRef = useRef(false);
  const start = async (c: HostChoice) => {
    if (busyRef.current) return; // a double tap must not start two games
    busyRef.current = true;
    setBusy(true);
    try {
      const b = await buildLevel(c);
      if (b) room.start({ mode: c.mode, level: b.level, src: b.src });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const rematch = () => {
    const g = room.snapshot().game;
    const diff = g?.src.k === 'endless' ? g.src.diff : 'medium';
    void start({ mode: g?.mode ?? 'race', src: { k: 'endless', diff } });
  };
  const rematchRef = useRef(rematch);
  rematchRef.current = rematch;
  useEffect(() => room.onRematch(() => rematchRef.current()), [room]);

  const game = snap.game;
  const session = useMemo(
    () => (game ? makeSession(room, game, { exit: () => setInGame(false), rematch: () => (room.role === 'host' ? rematchRef.current() : room.requestRematch()) }) : null),
    [game?.gid],
  );

  if (inGame && game && session) {
    const { title, subtitle } = titleOf(game.src, game.level);
    return (
      <GameView
        key={game.gid}
        level={game.level}
        storeKey={`race-${code}-${game.gid}`}
        saveLevel
        title={title}
        subtitle={subtitle}
        backTo={'/room/' + code}
        session={session}
      />
    );
  }

  return (
    <div class="screen together room">
      <div class="screen-inner">
        <TopBar title={t('room', { code: formatRoomCode(code) })} onBack={() => goBack('/together')} />
        {busy && (
          <div class="o-busy">
            <LogoMark class="spinner" />
            <p>{t('on_generating')}</p>
          </div>
        )}
        {!busy && (
          <>
            <Players snap={snap} />
            {snap.full && <p class="o-err center">{t('on_full')}</p>}
            {!snap.partner?.online && role === 'host' && <Invite code={code} />}
            {game && <CurrentGame snap={snap} game={game} onResume={() => { sfx.tick(); setInGame(true); }} />}
            {role === 'host' ? <HostSetup room={room} snap={snap} onStart={start} /> : <GuestWait snap={snap} />}
            <details class="o-me">
              <summary>
                {t('on_name')} · {t('on_color')}
              </summary>
              <ProfileEditor
                profile={profile}
                onChange={(p) => {
                  setProfile(p);
                  room.setProfile(p);
                }}
              />
            </details>
            <button class="o-link subtle" onClick={() => { sfx.tick(); closeRoom(); navigate('/together', true); }}>
              <span>{t('on_leave')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Players({ snap }: { snap: RoomSnapshot }) {
  // the cards below say who we are waiting for; the chip only pulses
  const waitingText = '…';
  return (
    <div class="o-players">
      <PlayerChip name={snap.self.name} color={snap.self.color} you />
      <span class="o-amp">+</span>
      {snap.partner && (snap.partner.online || snap.conn === 'reconnecting') ? (
        <PlayerChip name={snap.partner.name} color={partnerColor(snap)} away={!snap.partner.online} />
      ) : (
        <PlayerChip name={waitingText} color="" waiting />
      )}
      <ConnBadge conn={snap.conn} compact={snap.conn === 'waiting' || snap.conn === 'connecting'} />
    </div>
  );
}

function Invite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(code);
  return (
    <div class="o-card invite">
      <div class="o-label">{t('on_invite')}</div>
      <div class="big-code" aria-label={code}>
        {formatRoomCode(code)}
      </div>
      <div class="o-sub">{t('on_inviteText')}</div>
      <div class="row">
        <button
          class="btn ghost"
          onClick={async () => {
            sfx.tick();
            if (await copyText(url)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          <IconCopy />
          <span>{copied ? t('on_copied') : t('on_copy')}</span>
        </button>
        {canShare() && (
          <button class="btn ghost" onClick={() => { sfx.tick(); void shareLink(url, t('on_shareText', { code: formatRoomCode(code) })); }}>
            <IconShare />
            <span>{t('share')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function CurrentGame({ snap, game, onResume }: { snap: RoomSnapshot; game: GameSetup; onResume: () => void }) {
  const { title, subtitle } = titleOf(game.src, game.level);
  const me = snap.race.mine, th = snap.race.theirs;
  const raceDone = game.mode === 'race' && !!me?.fin;
  return (
    <div class="o-card current">
      <div class="cur-top">
        <span class={'mode-tag ' + game.mode}>{game.mode === 'coop' ? t('on_coop') : t('on_race')}</span>
        <span class="cur-title">
          {title}
          {subtitle ? ` · ${subtitle}` : ''}
        </span>
      </div>
      {raceDone ? (
        <div class="race-mini">
          <span>
            {snap.self.name}: <b>{fmtTime(me!.fin)}</b>
          </span>
          <span>
            {snap.partner?.name ?? '?'}: <b>{th?.fin ? fmtTime(th.fin) : `${th ? Math.round((th.done / Math.max(1, th.total)) * 100) : 0}%`}</b>
          </span>
        </div>
      ) : (
        <button class="btn cta wide" onClick={onResume}>
          <IconPlay />
          <span>{t('on_resume')}</span>
        </button>
      )}
    </div>
  );
}

const DIFF_OPTS = () => DIFFICULTIES.map((d) => ({ v: d, label: t(`diff_${d}`) }));

function HostSetup({ room, snap, onStart }: { room: RoomSession; snap: RoomSnapshot; onStart: (c: HostChoice) => void }) {
  const choice = snap.choice ?? defaultChoice();
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    if (!snap.choice) room.setChoice(choice);
  }, []);
  const set = (c: HostChoice) => room.setChoice(c);
  const kind = choice.src.k;
  const lastCampaign = useRef<string>(choice.src.k === 'campaign' ? choice.src.id : continueTarget()?.id ?? '');
  const lastDiff = useRef<string>(choice.src.k === 'endless' ? choice.src.diff : 'medium');
  if (choice.src.k === 'campaign') lastCampaign.current = choice.src.id;
  if (choice.src.k === 'endless') lastDiff.current = choice.src.diff;
  const opt = (k: 'campaign' | 'daily' | 'endless', icon: JSX.Element, title: string, sub: string, tone: string) => (
    <button
      class={'pz tone-' + tone + (kind === k ? ' on' : '')}
      aria-pressed={kind === k}
      onClick={() => {
        sfx.toggle();
        if (k === 'campaign') {
          if (kind === 'campaign' || !lastCampaign.current) setPicker(true);
          else set({ ...choice, src: { k: 'campaign', id: lastCampaign.current } });
        } else if (k === 'daily') set({ ...choice, src: { k: 'daily' } });
        else set({ ...choice, src: { k: 'endless', diff: lastDiff.current } });
      }}
    >
      <span class="pz-ic">{icon}</span>
      <span class="pz-t">{title}</span>
      <span class="pz-s">{sub}</span>
    </button>
  );
  const campaignSub = choice.src.k === 'campaign' ? choiceLabel(choice) : t('on_pickLevel');
  return (
    <div class="o-card setup">
      <div class="o-label">{t('on_mode')}</div>
      <Segmented<Mode>
        value={choice.mode}
        onChange={(mode) => set({ ...choice, mode })}
        options={[
          { v: 'coop', label: t('on_coop') },
          { v: 'race', label: t('on_race') },
        ]}
      />
      <p class="o-sub">{choice.mode === 'coop' ? t('on_coopSub') : t('on_raceSub')}</p>
      <div class="o-label">{t('on_puzzle')}</div>
      <div class="pz-grid">
        {opt('campaign', <IconHexes />, t('campaign'), campaignSub, 'violet')}
        {opt('daily', <IconCalendar />, t('daily'), todayISO().split('-').reverse().slice(0, 2).join('.'), 'amber')}
        {opt('endless', <IconInfinity />, t('endless'), choice.src.k === 'endless' ? t(`diff_${choice.src.diff as Difficulty}`) : t('endlessSub'), 'teal')}
      </div>
      {choice.src.k === 'endless' && (
        <Segmented<Difficulty> value={choice.src.diff as Difficulty} onChange={(diff) => set({ ...choice, src: { k: 'endless', diff } })} options={DIFF_OPTS()} />
      )}
      <button class="btn cta wide big" onClick={() => { sfx.tick(); onStart(choice); }}>
        <IconPlay />
        <span>{snap.game ? t('on_newGame') : t('on_start')}</span>
      </button>
      <LevelPicker
        open={picker}
        current={choice.src.k === 'campaign' ? choice.src.id : ''}
        onClose={() => setPicker(false)}
        onPick={(id) => {
          setPicker(false);
          set({ ...choice, src: { k: 'campaign', id } });
        }}
      />
    </div>
  );
}

function LevelPicker({ open, current, onClose, onPick }: { open: boolean; current: string; onClose: () => void; onPick: (id: string) => void }) {
  const lang = getLang();
  const best = loadBest();
  const isDone = (id: string) => !!best[id];
  return (
    <Sheet open={open} onClose={onClose} class="lpick" label={t('on_pickLevel')}>
      <h2>{t('on_pickLevel')}</h2>
      <div class="lp-list">
        {WORLDS.map((w, wi) =>
          worldUnlocked(wi, isDone) ? (
            <section key={w.id} class="lp-world" style={{ '--wc': w.accent } as JSX.CSSProperties}>
              <div class="lp-title">
                <span class="lp-n">{wi + 1}</span>
                {w.title[lang]}
              </div>
              <div class="lp-grid">
                {w.levels.map((id, li) => (
                  <button key={id} class={'lp-lvl' + (isDone(id) ? ' done' : '') + (id === current ? ' on' : '')} onClick={() => { sfx.tick(); onPick(id); }} aria-label={t('level', { n: li + 1 })}>
                    <span>{li + 1}</span>
                    {isDone(id) && <Stars n={best[id].stars} size={8} />}
                  </button>
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </Sheet>
  );
}

function GuestWait({ snap }: { snap: RoomSnapshot }) {
  const host = snap.partner?.name ?? '…';
  return (
    <div class="o-card guest">
      {snap.partner ? <p class="o-wait">{t('on_hostPicks', { name: host })}</p> : <p class="o-wait">{t('on_waitingHost')}</p>}
      {snap.choice && (
        <div class="choice-preview">
          <span class={'mode-tag ' + snap.choice.mode}>{snap.choice.mode === 'coop' ? t('on_coop') : t('on_race')}</span>
          <span>{choiceLabel(snap.choice)}</span>
        </div>
      )}
    </div>
  );
}

/** Route component for both `#/together` and `#/room/<CODE>`. */
export function TogetherRoute({ params }: { params: string[] }) {
  const code = params[0] ? parseRoomInput(params[0]) : null;
  if (params[0] && (!code || !isRoomCode(code))) return <Lobby />;
  return code ? <RoomScreen key={code} code={code} /> : <Lobby />;
}
