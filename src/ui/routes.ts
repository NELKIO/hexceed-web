// Built-in screens. Other modules can call registerRoute() to add or replace routes
// (e.g. the online mode: registerRoute({ name: 'room', pattern: /^\/room\/([A-Za-z0-9-]+)$/, component })).

import { registerRoute } from '../router';
import { MenuScreen } from './screens/Menu';
import { WorldsScreen } from './screens/Worlds';
import { DailyScreen, EndlessScreen, PlayScreen } from './screens/Play';
import { SettingsScreen } from './screens/Settings';
import { HowScreen } from './screens/How';
import { TogetherScreen } from './screens/Together';

export function registerBuiltinRoutes(): void {
  // registered from the most generic to the most specific: later registrations are matched first
  registerRoute({ name: 'menu', pattern: /^\/?$/, component: MenuScreen });
  registerRoute({ name: 'worlds', pattern: /^\/worlds\/?$/, component: WorldsScreen });
  registerRoute({ name: 'play', pattern: /^\/play\/([^/]+)\/?$/, component: PlayScreen });
  registerRoute({ name: 'daily', pattern: /^\/daily\/?$/, component: DailyScreen });
  registerRoute({ name: 'endless', pattern: /^\/endless(?:\/([a-z]+)\/([^/]+))?\/?$/, component: EndlessScreen });
  registerRoute({ name: 'settings', pattern: /^\/settings\/?$/, component: SettingsScreen });
  registerRoute({ name: 'how', pattern: /^\/how\/?$/, component: HowScreen });
  registerRoute({ name: 'together', pattern: /^\/together\/?$/, component: TogetherScreen });
  registerRoute({ name: 'room', pattern: /^\/room\/([A-Za-z0-9_-]+)\/?$/, component: TogetherScreen });
}
