// Sets the theme on <html> before the first paint, so a dark-mode reload does not flash light.
// Loaded as a plain script because the CSP allows only same-origin scripts (no inline). Keep the
// storage key in step with src/theme.ts.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("auditlogs.theme");
  } catch (e) {}
  var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
