// Sets the theme on <html> before the first paint, so a dark-mode reload does not flash light.
// Loaded as a plain script because the CSP allows only same-origin scripts (no inline). Keep the
// storage key in step with src/theme.ts.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("auditlogs.theme");
  } catch (e) {}
  // Light unless the person has chosen dark (owner decision: light is the default for everyone).
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
})();
