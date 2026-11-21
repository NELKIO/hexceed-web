import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { goBack } from '../../router';
import { TopBar } from '../components/ui';
import { LogoMark } from '../icons';
import { useSettings } from '../settings';

type RouteComp = ComponentType<{ params: string[] }>;
let loaded: RouteComp | null = null;
let loading: Promise<RouteComp> | null = null;

/** The online screens and the networking code are a separate chunk, loaded on first visit. */
export function loadTogether(): Promise<RouteComp> {
  loading ??= import('../online/TogetherApp').then((m) => (loaded = m.TogetherRoute));
  return loading;
}

/** `#/together` (lobby) and `#/room/<CODE>` (a room). */
export function TogetherScreen({ params }: { params: string[] }) {
  useSettings();
  const [Comp, setComp] = useState<RouteComp | null>(() => loaded);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Comp) return;
    let alive = true;
    loadTogether().then(
      (c) => alive && setComp(() => c),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (Comp) return <Comp params={params} />;
  return (
    <div class="screen center">
      <div class="screen-inner">
        <TopBar title={t('togetherTitle')} onBack={() => goBack('/')} />
        <div class="loading">
          <LogoMark class={failed ? '' : 'spinner'} />
          <p>{failed ? t('on_st_offline') : t('on_loading')}</p>
        </div>
      </div>
    </div>
  );
}
