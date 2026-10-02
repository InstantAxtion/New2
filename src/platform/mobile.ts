// Native (Capacitor) integration: app lifecycle, local notifications, back button.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const isNative = Capacitor.isNativePlatform();

let notifId = 1;
let permitted: boolean | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (permitted !== null) return permitted;
  try {
    if (isNative) {
      const r = await LocalNotifications.requestPermissions();
      permitted = r.display === 'granted';
    } else if ('Notification' in globalThis) {
      permitted = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted';
    } else permitted = false;
  } catch {
    permitted = false;
  }
  return permitted;
}

/** Show (or schedule) a notification. `at` delays it. */
export async function notify(title: string, body: string, at?: Date) {
  if (!(await ensureNotificationPermission())) return;
  try {
    if (isNative) {
      await LocalNotifications.schedule({
        notifications: [{ id: notifId++, title, body, schedule: at ? { at, allowWhileIdle: true } : undefined }],
      });
    } else if (!at && 'Notification' in globalThis && document.hidden) {
      new Notification(title, { body });
    }
  } catch {
    /* notifications are best-effort */
  }
}

export async function cancelScheduled() {
  if (!isNative) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel(pending);
  } catch {
    /* ignore */
  }
}

/** Lifecycle hooks. Works for both native and browser (visibilitychange). */
export function onLifecycle(onPause: () => void, onResume: () => void, onBack: () => boolean) {
  if (isNative) {
    App.addListener('pause', onPause);
    App.addListener('resume', onResume);
    App.addListener('backButton', () => {
      if (!onBack()) App.minimizeApp();
    });
  } else {
    document.addEventListener('visibilitychange', () => (document.hidden ? onPause() : onResume()));
    window.addEventListener('pagehide', onPause);
  }
}
