import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MechanicId } from '../../core/types';
import { t } from '../../i18n';
import { mechDesc, mechTitle } from '../mechanics';
import { Sheet } from '../components/ui';
import { MiniBoard } from './MiniBoard';
import { MechIcon } from '../components/MechIcon';
import { sfx } from '../../audio/sfx';
import { IconArrow, IconCheck } from '../icons';

const coarse = () => {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
};

/**
 * Bottom sheet that walks through one or more mechanic cards (all new mechanics of a level, in
 * teaching order). One sheet only; "Понятно, всё" skips the rest; closing is idempotent.
 */
export function Explainer({ mechs, open, onClose }: { mechs: MechanicId[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const closing = useRef(false);
  const list = useMemo(() => [...new Set(mechs)], [mechs.join()]);
  useEffect(() => {
    if (open) {
      setI(0);
      closing.current = false;
    }
  }, [open, list.join()]);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  };
  // many new mechanics at once (a fresh player opening the daily): an overview card comes first
  const overview = list.length > 4;
  const total = list.length + (overview ? 1 : 0);
  const k = Math.max(0, Math.min(i, total - 1));
  const m = overview ? (k === 0 ? undefined : list[k - 1]) : list[k];
  if (!list.length) return null;
  const last = k >= total - 1;
  return (
    <Sheet open={open} onClose={close} class="explainer" label={m ? t(mechTitle(m)) : t('exOverview', { n: list.length })}>
      {m ? (
        <div class="ex-card" key={m}>
          <div class="ex-art">
            <MiniBoard mech={m} />
          </div>
          <div class="ex-text">
            <h2>{t(mechTitle(m))}</h2>
            <p>{t(mechDesc(m))}</p>
            {m === 'basic' && <p class="ex-sub">{t(coarse() ? 'exMarkTouch' : 'exMarkMouse')}</p>}
          </div>
        </div>
      ) : (
        <div class="ex-card ex-overview" key="overview">
          <div class="ex-text">
            <h2>{t('exOverview', { n: list.length })}</h2>
            <p>{t('exOverviewSub')}</p>
          </div>
          <ul class="ex-list">
            {list.map((x) => (
              <li key={x}>
                <MechIcon m={x} />
                <span>{t(mechTitle(x))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {total > 1 && (
        <div class="ex-count" aria-live="polite">
          {k + 1} / {total}
        </div>
      )}
      <div class={'ex-actions' + (last ? ' single' : '')}>
        {!last && (
          <button
            class="btn ghost"
            onClick={() => {
              sfx.tick();
              close();
            }}
          >
            <span>{t('gotItAll')}</span>
          </button>
        )}
        <button
          class="btn cta"
          onClick={() => {
            sfx.tick();
            if (last) close();
            else setI(k + 1);
          }}
        >
          {last ? <IconCheck /> : <IconArrow />}
          <span>{last ? t('gotIt') : t('next')}</span>
        </button>
      </div>
    </Sheet>
  );
}
