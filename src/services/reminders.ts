import { Platform } from 'react-native';

const REMINDER_ID = 'puphii-daily-check-in';
const ANDROID_CHANNEL = 'reminders';

export type ReminderResult = 'scheduled' | 'denied' | 'unavailable';

// Loaded lazily so users who never enable reminders never touch the notifications module.
async function loadNotifications() {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return Notifications;
  } catch {
    return null;
  }
}

export async function scheduleDailyReminder(hour: number, minute: number): Promise<ReminderResult> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unavailable';
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return 'denied';

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'Daily check-in',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        // Shown on the lock screen, so it must not reveal smoking or vaping.
        title: 'Puphii',
        body: 'Your daily check-in is here.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL : undefined,
      },
    });
    return 'scheduled';
  } catch {
    return 'unavailable';
  }
}

export async function cancelDailyReminder(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
}
