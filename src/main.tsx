import { render } from 'preact';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './styles/base.css';
import './styles/menu.css';
import './styles/screens.css';
import './styles/game.css';
import { initSettings } from './ui/settings';
import { registerBuiltinRoutes } from './ui/routes';
import { registerOnlineRoutes, startSyncIfLinked } from './ui/online/entry';
import { App } from './ui/App';
import { unlockAudio } from './audio/sfx';

initSettings();
registerBuiltinRoutes();
registerOnlineRoutes();
startSyncIfLinked();

// iOS/Chrome need a user gesture before audio can start
const unlock = () => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

render(<App />, document.getElementById('app')!);
