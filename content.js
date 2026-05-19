const syncDOMPowerState = (isEnabled) => {
  document.body.setAttribute(
    "data-engine-enabled",
    isEnabled ? "true" : "false",
  );
};

// Initial Sync & Boot Load Sequence
chrome.storage.local.get(["engineEnabled"], (result) => {
  const isEnabled = result.engineEnabled !== false;
  syncDOMPowerState(isEnabled);

  // Safely bridge and inject your core script directly into the Main Page Context
  const mainWorldScript = document.createElement("script");
  mainWorldScript.src = chrome.runtime.getURL("engine.js");
  (document.head || document.documentElement).appendChild(mainWorldScript);
});

// Watch for active adjustments coming live from your extension button clicks
chrome.storage.onChanged.addListener((changes) => {
  if (changes.engineEnabled) {
    syncDOMPowerState(changes.engineEnabled.newValue);
  }
});
