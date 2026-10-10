import { AppState, NativeModules, Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { PLANS, REVENUECAT_ENTITLEMENT_ID } from './config';
import { createRevenueCatService, PurchasesSdk, RevenueCatService } from './revenueCat';
import { checkSdkKey } from './sdkKeys';

let configured = false;

const purchasesSdk: PurchasesSdk = {
  configure(apiKey) {
    if (configured) return;
    void Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    // Anonymous RevenueCat user: no account or personal identifier is sent.
    Purchases.configure({
      apiKey,
      appUserID: null,
      entitlementVerificationMode: Purchases.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL,
    });
    configured = true;
  },
  getCustomerInfo: () => Purchases.getCustomerInfo(),
  restorePurchases: () => Purchases.restorePurchases(),
  addCustomerInfoUpdateListener: (listener) => Purchases.addCustomerInfoUpdateListener(listener),
  removeCustomerInfoUpdateListener: (listener) => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  },
  checkTrialEligibility: (productIds) => Purchases.checkTrialOrIntroductoryPriceEligibility(productIds),
};

/** Expo Go and the web have no native store module; only development and store builds do. */
const hasNativeStore = (Platform.OS === 'ios' || Platform.OS === 'android') && NativeModules.RNPurchases != null;

export function createAppEntitlementService(): RevenueCatService {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  // Read literally so Expo inlines the public EXPO_PUBLIC_ values at build time.
  const key = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
  return createRevenueCatService({
    sdk: hasNativeStore ? purchasesSdk : null,
    key: checkSdkKey(Platform.OS, key, { allowTestStore: __DEV__ }),
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    productIds: { annual: PLANS.annual.productIds[platform], monthly: PLANS.monthly.productIds[platform] },
    appState: {
      current: () => AppState.currentState,
      subscribe(listener) {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    },
  });
}
