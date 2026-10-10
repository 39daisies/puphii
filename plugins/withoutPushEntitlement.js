const { withEntitlementsPlist } = require('expo/config-plugins');

// Reminders are local notifications only. expo-notifications' auto-applied plugin
// still adds the APNs entitlement, which would enable remote push for no reason.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
