// Lazy entry point of the online features (loaded with `import()` only when a room is opened).
// Keeps one active room per page: leaving the game screen for the room lobby keeps the connection.

import { clientId, loadRoomGame, saveRoomGame, type Profile } from './ids';
import { RoomSession, type SavedRoom } from './room';
import { connectRoom } from './transport';

export { RoomSession } from './room';
export { applyOp, contributions, CoopLog } from './coop';

let active: RoomSession | null = null;

/** `?net=relay` in the URL or `hexlume:net:force = relay` in storage: skip WebRTC (testing). */
function forceRelay(): boolean {
  try {
    if (/[?&]net=relay\b/.test(location.search) || /[?&]net=relay\b/.test(location.hash)) return true;
    return localStorage.getItem('hexlume:net:force') === 'relay';
  } catch {
    return false;
  }
}

export function openRoom(code: string, role: 'host' | 'guest', profile: Profile): RoomSession {
  if (active && active.code === code && active.role === role) return active;
  active?.close();
  const relayOnly = forceRelay();
  active = new RoomSession({
    code,
    role,
    selfId: clientId(),
    profile,
    connect: (c, h, s) => connectRoom(c, h, s, { forceRelay: relayOnly }),
    store: {
      load: () => loadRoomGame<SavedRoom>(code),
      save: (v) => saveRoomGame(code, v),
    },
  });
  if (import.meta.env.DEV) (window as unknown as { __room: unknown }).__room = active;
  return active;
}

export function activeRoom(): RoomSession | null {
  return active;
}

export function closeRoom(): void {
  active?.close();
  active = null;
}

if (typeof window !== 'undefined') {
  let closedByHide = false;
  window.addEventListener('pagehide', () => {
    if (active) closedByHide = true;
    active?.close(); // tells the partner at once instead of waiting for the silence timeout
  });
  // back/forward cache: the page comes back with a closed room — start fresh
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && closedByHide) location.reload();
  });
}
