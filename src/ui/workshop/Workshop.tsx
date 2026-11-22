// «Мастерская» home: new level, the author's levels (rename / duplicate / copy link / delete).

import { useState } from 'preact/hooks';
import { shareUrl } from '../../core/editor-utils';
import { goBack, navigate } from '../../router';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { Sheet, TopBar } from '../components/ui';
import { IconCheck, IconChevron, IconCopy, IconTrash } from '../icons';
import { showNotice } from '../notice';
import { useSettings } from '../settings';
import { analysisKey } from './analyze';
import { IcDup, IcMore, IcPencil, IcPlus } from './icons';
import { wpn, wt } from './i18n';
import { cloneLevel, gemCount, hexagonLevel, hexCount } from './ops';
import { deleteDraft, loadDrafts, newId, saveDraft, type Draft } from './store';

export function createDraft(from?: Partial<Draft>): Draft {
  const now = Date.now();
  const d: Draft = { id: newId(), title: '', level: hexagonLevel(5), created: now, updated: now, ...from };
  saveDraft(d);
  return d;
}

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}`;
};

function verdict(d: Draft): { text: string; ok: boolean } {
  const fresh = d.check && d.check.hash === analysisKey(d.level);
  if (!fresh) return { text: wt('ws_unchecked'), ok: false };
  return d.check!.solved ? { text: `${d.check!.diff}/10`, ok: true } : { text: wt('ws_unsolvable'), ok: false };
}

/** Open the next sheet once the current one has closed (each sheet owns a history entry). */
const later = (f: () => void) => setTimeout(f, 260);

export function WorkshopScreen() {
  useSettings();
  const [drafts, setDrafts] = useState(loadDrafts);
  const [menu, setMenu] = useState<Draft | null>(null);
  const [rename, setRename] = useState<{ d: Draft; v: string } | null>(null);
  const [del, setDel] = useState<Draft | null>(null);
  const reload = () => setDrafts(loadDrafts());
  const name = (d: Draft) => d.title.trim() || wt('ws_untitled');
  const open = (d: Draft) => {
    sfx.tick();
    navigate('/workshop/edit/' + d.id);
  };
  return (
    <div class="screen ws">
      <div class="screen-inner">
        <TopBar title={wt('ws_title')} onBack={() => goBack('/')} />
        <p class="lead">{wt('ws_lead')}</p>
        <button
          class="cta-big slim"
          onClick={() => {
            const d = createDraft();
            open(d);
          }}
        >
          <span class="cb-text">
            <span class="cb-t">{wt('ws_new')}</span>
            <span class="cb-s">{wt('ws_newSub')}</span>
          </span>
          <span class="cb-ic">
            <IcPlus />
          </span>
        </button>

        <h2 class="ws-h">{wt('ws_mine')}</h2>
        {!drafts.length && <p class="ws-empty">{wt('ws_empty')}</p>}
        <div class="ws-list">
          {drafts.map((d) => {
            const v = verdict(d);
            const shared = !!d.code && d.codeHash === analysisKey(d.level);
            return (
              <div class="ws-row" key={d.id}>
                <button class="ws-main" onClick={() => open(d)}>
                  <span class="ws-t">{name(d)}</span>
                  <span class="ws-s">
                    <span>{wpn(hexCount(d.level), 'pl_cell')}</span>
                    <span class="ws-dot">·</span>
                    <span>{wpn(gemCount(d.level), 'pl_light')}</span>
                    <span class="ws-dot">·</span>
                    <span class={'ws-v' + (v.ok ? ' ok' : '')}>
                      {v.ok && <IconCheck />}
                      {v.text}
                    </span>
                    {shared && <span class="ws-tag">{wt('ws_shared')}</span>}
                  </span>
                </button>
                <span class="ws-date">{fmtDate(d.updated)}</span>
                <button class="icon-btn" aria-label={wt('ws_more')} onClick={() => { sfx.tick(); setMenu(d); }}>
                  <IcMore />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Sheet open={!!menu} onClose={() => setMenu(null)} class="ed-sheet" label={menu ? name(menu) : ''}>
        {menu && (
          <>
            <h2>{name(menu)}</h2>
            <div class="sgroup ws-menu">
              <button class="srow srow-btn" onClick={() => { const d = menu; setMenu(null); open(d); }}>
                <span class="s-text"><span class="s-t">{wt('ws_open')}</span></span>
                <IconChevron class="s-chev" />
              </button>
              <button class="srow srow-btn" onClick={() => { const d = menu; setMenu(null); later(() => setRename({ d, v: d.title })); }}>
                <span class="s-ic"><IcPencil /></span>
                <span class="s-text"><span class="s-t">{wt('ws_rename')}</span></span>
              </button>
              <button
                class="srow srow-btn"
                onClick={() => {
                  sfx.tick();
                  createDraft({ title: wt('ws_copyName', { name: name(menu) }).slice(0, 60), level: cloneLevel(menu.level), check: menu.check, remixOf: menu.remixOf });
                  setMenu(null);
                  reload();
                }}
              >
                <span class="s-ic"><IcDup /></span>
                <span class="s-text"><span class="s-t">{wt('ws_duplicate')}</span></span>
              </button>
              {menu.code && (
                <button
                  class="srow srow-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareUrl(menu.code!));
                      showNotice(wt('share_copied'), { ms: 1800 });
                    } catch {
                      /* ignore */
                    }
                    setMenu(null);
                  }}
                >
                  <span class="s-ic"><IconCopy /></span>
                  <span class="s-text"><span class="s-t">{wt('ws_copyLink')}</span></span>
                </button>
              )}
              <button class="srow srow-btn ws-danger" onClick={() => { const d = menu; setMenu(null); later(() => setDel(d)); }}>
                <span class="s-ic"><IconTrash /></span>
                <span class="s-text"><span class="s-t">{wt('ws_delete')}</span></span>
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={!!rename} onClose={() => setRename(null)} class="ed-sheet" label={wt('ws_rename')}>
        {rename && (
          <form
            class="ws-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveDraft({ ...rename.d, title: rename.v.trim().slice(0, 60), updated: Date.now() });
              setRename(null);
              reload();
            }}
          >
            <h2>{wt('ws_rename')}</h2>
            <label class="ed-field">
              <span class="label">{wt('ws_name')}</span>
              <input class="ed-input" autoFocus value={rename.v} maxLength={60} placeholder={wt('ws_namePh')} onInput={(e) => setRename({ ...rename, v: (e.target as HTMLInputElement).value })} />
            </label>
            <div class="row">
              <button type="button" class="btn ghost" onClick={() => setRename(null)}>{t('cancel')}</button>
              <button type="submit" class="btn cta">{wt('ws_save')}</button>
            </div>
          </form>
        )}
      </Sheet>

      <Sheet open={!!del} onClose={() => setDel(null)} class="confirm" label={del ? wt('ws_deleteQ', { name: name(del) }) : ''}>
        {del && (
          <>
            <h2>{wt('ws_deleteQ', { name: name(del) })}</h2>
            <p class="lead">{wt('ws_deleteSub')}</p>
            <div class="row">
              <button class="btn ghost" onClick={() => setDel(null)}>{t('cancel')}</button>
              <button
                class="btn danger-fill"
                onClick={() => {
                  deleteDraft(del.id);
                  setDel(null);
                  reload();
                }}
              >
                <IconTrash />
                <span>{wt('ws_delete')}</span>
              </button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
