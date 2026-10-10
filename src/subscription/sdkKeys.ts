/**
 * RevenueCat public SDK keys are platform-specific and safe to ship in the app. Secret keys
 * (`sk_…`) grant server access and must never reach the client, so they are refused here.
 */

export type StorePlatform = 'ios' | 'android';

export type SdkKeyCheck =
  | { ok: true; apiKey: string }
  | { ok: false; reason: 'missing' | 'secretKey' | 'wrongPlatform' | 'testStoreKey' | 'malformed' | 'unsupportedPlatform' };

const PLATFORM_PREFIX: Record<StorePlatform, string> = { ios: 'appl_', android: 'goog_' };
const OTHER_PUBLIC_PREFIXES = ['appl_', 'goog_', 'amzn_'];
const TEST_STORE_PREFIX = 'test_';

/** `allowTestStore` admits RevenueCat Test Store keys, for development builds only. */
export function checkSdkKey(platform: string, key: string | undefined, { allowTestStore }: { allowTestStore: boolean }): SdkKeyCheck {
  if (platform !== 'ios' && platform !== 'android') return { ok: false, reason: 'unsupportedPlatform' };
  const value = key?.trim() ?? '';
  if (!value) return { ok: false, reason: 'missing' };
  if (value.startsWith('sk_')) return { ok: false, reason: 'secretKey' };
  if (!/^[A-Za-z0-9_]+$/.test(value)) return { ok: false, reason: 'malformed' };
  if (value.startsWith(TEST_STORE_PREFIX)) return allowTestStore ? { ok: true, apiKey: value } : { ok: false, reason: 'testStoreKey' };
  if (value.startsWith(PLATFORM_PREFIX[platform])) return { ok: true, apiKey: value };
  if (OTHER_PUBLIC_PREFIXES.some((prefix) => value.startsWith(prefix))) return { ok: false, reason: 'wrongPlatform' };
  return { ok: false, reason: 'malformed' };
}
