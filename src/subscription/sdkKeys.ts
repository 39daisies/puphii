/**
 * RevenueCat public SDK keys are platform-specific and safe to ship in the app. Secret keys
 * (`sk_…`) grant server access and must never reach the client, so they are refused here.
 * Test Store keys (`test_…`) simulate purchases and are only ever accepted in development builds.
 */

export type StorePlatform = 'ios' | 'android';

/** `testStore`: RevenueCat's simulated store. `platform`: the App Store or Google Play. */
export type KeySource = 'platform' | 'testStore';

export type SdkKeyProblem =
  | 'missing'
  | 'secretKey'
  | 'wrongPlatform'
  | 'testStoreKey'
  | 'notTestStoreKey'
  | 'malformed'
  | 'unsupportedPlatform';

export type SdkKeyCheck = { ok: true; apiKey: string; source: KeySource } | { ok: false; reason: SdkKeyProblem };

const PLATFORM_PREFIX: Record<StorePlatform, string> = { ios: 'appl_', android: 'goog_' };
const OTHER_PUBLIC_PREFIXES = ['appl_', 'goog_', 'amzn_'];
const TEST_STORE_PREFIX = 'test_';

function basicCheck(key: string | undefined): { value: string } | { problem: SdkKeyProblem } {
  const value = key?.trim() ?? '';
  if (!value) return { problem: 'missing' };
  if (value.startsWith('sk_')) return { problem: 'secretKey' };
  if (!/^[A-Za-z0-9_]+$/.test(value)) return { problem: 'malformed' };
  return { value };
}

/** The App Store or Google Play key for this platform. Test Store keys are refused here. */
export function checkSdkKey(platform: string, key: string | undefined): SdkKeyCheck {
  if (platform !== 'ios' && platform !== 'android') return { ok: false, reason: 'unsupportedPlatform' };
  const basic = basicCheck(key);
  if ('problem' in basic) return { ok: false, reason: basic.problem };
  const { value } = basic;
  if (value.startsWith(TEST_STORE_PREFIX)) return { ok: false, reason: 'testStoreKey' };
  if (value.startsWith(PLATFORM_PREFIX[platform])) return { ok: true, apiKey: value, source: 'platform' };
  if (OTHER_PUBLIC_PREFIXES.some((prefix) => value.startsWith(prefix))) return { ok: false, reason: 'wrongPlatform' };
  return { ok: false, reason: 'malformed' };
}

export function checkTestStoreKey(platform: string, key: string | undefined): SdkKeyCheck {
  if (platform !== 'ios' && platform !== 'android') return { ok: false, reason: 'unsupportedPlatform' };
  const basic = basicCheck(key);
  if ('problem' in basic) return { ok: false, reason: basic.problem };
  if (!basic.value.startsWith(TEST_STORE_PREFIX)) return { ok: false, reason: 'notTestStoreKey' };
  return { ok: true, apiKey: basic.value, source: 'testStore' };
}

export type KeyInputs = {
  platform: string;
  platformKey: string | undefined;
  testStoreKey: string | undefined;
  /** `__DEV__` in the app. Outside development builds the Test Store key is ignored entirely. */
  isDevelopmentBuild: boolean;
};

/**
 * A development build with a Test Store key set uses the Test Store; a bad Test Store key is
 * reported rather than silently replaced by the real store's key. Everything else uses the
 * platform key.
 */
export function selectSdkKey({ platform, platformKey, testStoreKey, isDevelopmentBuild }: KeyInputs): SdkKeyCheck {
  if (isDevelopmentBuild && testStoreKey?.trim()) return checkTestStoreKey(platform, testStoreKey);
  return checkSdkKey(platform, platformKey);
}
