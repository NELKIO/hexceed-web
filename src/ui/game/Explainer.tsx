import { useEffect, useState } from 'preact/hooks';
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

/** Bottom sheet that walks through one or more mechanic cards. */
export function Explainer({ mechs, open, onClose }: { mechs: MechanicId[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
  }, [open, mechs.join()]);
  const m = mechs[Math.min(i, mechs.length - 1)];
  if (!m) return null;
  const last = i >= mechs.length - 1;
  return (
    <Sheet open={open} onClose={onClose} class="explainer" label={t(mechTitle(m))}>
      <div class="ex-card" key={m}>
        <div class="ex-art">
          <MiniBoard mech={m === 'basic' ? 'basic' : m} />
        </div>
        <div class="ex-text">
          <h2>{t(mechTitle(m))}</h2>
          <p>{t(mechDesc(m))}</p>
          {m === 'basic' && <p class="ex-sub">{t(coarse() ? 'exMarkTouch' : 'exMarkMouse')}</p>}
        </div>
      </div>
      {mechs.length > 1 && (
        <div class="dots">
          {mechs.map((x, k) => (
            <button key={x} class={k === i ? 'on' : ''} aria-label={t(mechTitle(x))} onClick={() => setI(k)} />
          ))}
        </div>
      )}
      <button
        class="btn cta wide"
        onClick={() => {
          sfx.tick();
          if (last) onClose();
          else setI(i + 1);
        }}
      >
        {last ? <IconCheck /> : <IconArrow />}
        <span>{last ? t('gotIt') : t('next')}</span>
      </button>
    </Sheet>
  );
}
