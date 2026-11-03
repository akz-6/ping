import { mountApp } from "./app/app";
import { initTheme } from "./theme";
import { mountViewer } from "./viewer";

initTheme();

const app = document.getElementById("app");
if (!app) throw new Error("#app não encontrado");

const room = new URLSearchParams(location.search).get("room");

if (room) {
  app.classList.add("legacy", "legacy-dark");
  mountViewer(app, room.trim().toLowerCase());
} else {
  app.classList.add("app-root");
  mountApp(app);
}
