/* Aplica tema antes da primeira pintura (evita flash). Carregado como script síncrono por causa da CSP (sem inline). */
(function () {
  var theme = "dark";
  try {
    var t = localStorage.getItem("ping:theme");
    if (t === "light" || t === "dark") theme = t;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (e) {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.removeAttribute("data-palette");
  try {
    window.VIDEOJS_NO_DYNAMIC_STYLE = true;
  } catch (err) {}
})();
