const { withAndroidManifest } = require("expo/config-plugins");

// Foldables change smallestScreenWidth across fold states (Find N2: 384dp folded,
// 751dp unfolded). Without smallestScreenSize in configChanges, fold/unfold destroys
// and recreates MainActivity, remounting the RN tree and losing scroll position.
// android/ is a gitignored prebuild artifact — this plugin is the source of truth;
// never edit the generated AndroidManifest.xml by hand.
function withAndroidFoldableConfigChanges(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    const mainActivity = application?.activity?.find(
      (activity) => activity.$?.["android:name"] === ".MainActivity",
    );
    if (!mainActivity) {
      throw new Error("Could not find MainActivity to set foldable configChanges");
    }

    const current = mainActivity.$["android:configChanges"] ?? "";
    const flags = current.split("|").filter(Boolean);
    if (!flags.includes("smallestScreenSize")) {
      flags.push("smallestScreenSize");
    }
    mainActivity.$["android:configChanges"] = flags.join("|");
    return modConfig;
  });
}

module.exports = withAndroidFoldableConfigChanges;
