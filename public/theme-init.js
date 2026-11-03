/* Aplica tema e paleta antes da primeira pintura (evita flash). Carregado como script síncrono por causa da CSP (sem inline). */
(function () {
  var theme = "light";
  var palette = "indigo";
  try {
    var t = localStorage.getItem("ping:theme");
    var p = localStorage.getItem("ping:palette");
    if (p === "indigo" || p === "teal" || p === "terracota") palette = p;
    if (t === "light" || t === "dark") theme = t;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (e) {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-palette", palette);
})();
