import { render } from 'preact';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/cyrillic-500.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/menu.css';
import './styles/screens.css';
import './styles/game.css';
import { initSettings } from './ui/settings';
import { registerBuiltinRoutes } from './ui/routes';
import { registerOnlineRoutes, startSyncIfLinked } from './ui/online/entry';
import { App } from './ui/App';
import { unlockAudio } from './audio/sfx';
import { registerSW } from './ui/pwa';

initSettings();
registerBuiltinRoutes();
registerOnlineRoutes();
startSyncIfLinked();
registerSW();

// iOS/Chrome need a user gesture before audio can start
const unlock = () => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

render(<App />, document.getElementById('app')!);
