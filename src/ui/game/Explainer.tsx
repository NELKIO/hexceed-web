import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MechanicId } from '../../core/types';
import { t } from '../../i18n';
import { mechDesc, mechTitle } from '../mechanics';
import { Sheet } from '../components/ui';
import { MiniBoard } from './MiniBoard';
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
  const k = Math.max(0, Math.min(i, list.length - 1));
  const m = list[k];
  if (!m) return null;
  const last = k >= list.length - 1;
  const many = list.length > 9;
  return (
    <Sheet open={open} onClose={close} class="explainer" label={t(mechTitle(m))}>
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
      {list.length > 1 &&
        (many ? (
          <div class="ex-count" aria-live="polite">
            {k + 1} / {list.length}
          </div>
        ) : (
          <div class="dots">
            {list.map((x, j) => (
              <button key={x} class={j === k ? 'on' : ''} aria-label={t(mechTitle(x))} aria-current={j === k} onClick={() => setI(j)} />
            ))}
          </div>
        ))}
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
