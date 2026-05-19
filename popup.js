document.addEventListener("DOMContentLoaded", () => {
  const engineToggle = document.getElementById("engineToggle");

  chrome.storage.local.get(["engineEnabled"], (result) => {
    engineToggle.checked = result.engineEnabled !== false;
  });

  engineToggle.addEventListener("change", () => {
    chrome.storage.local.set({ engineEnabled: engineToggle.checked });
  });
});
