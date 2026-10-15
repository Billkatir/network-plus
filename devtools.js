// Registers our custom panel inside Chrome DevTools.
// Shows up as a tab named "Network+" next to Elements, Console, Network, etc.
chrome.devtools.panels.create(
  "Network+",
  null,          // optional icon path
  "panel.html",  // the panel UI
  function (panel) {
    // panel created; nothing needed here for now
  }
);
