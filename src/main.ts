import "./player/bootstrap";
import { initTheme } from "./theme";
import { registerServiceWorker } from "./app/services/pwa";
import { checkUrlForCreatorKey } from "./app/auth-gate";

// Processa chave de administrador/anfitrião na URL imediatamente
checkUrlForCreatorKey();
initTheme();
registerServiceWorker();

const app = document.getElementById("app");
if (!app) throw new Error("#app não encontrado");

const path = location.pathname;
const room = new URLSearchParams(location.search).get("room");

if (room) {
  app.classList.add("legacy", "legacy-dark");
  import("./viewer").then(({ mountViewer }) => {
    mountViewer(app, room.trim().toLowerCase());
  });
} else if (path.startsWith("/studio")) {
  app.classList.add("app-root");
  import("./app/app").then(({ mountApp }) => {
    mountApp(app, { initialView: "host" });
  });
} else {
  app.classList.add("app-root");
  import("./app/app").then(({ mountApp }) => {
    mountApp(app);
  });
}
