import { mountHost } from "./host";
import { mountViewer } from "./viewer";

const app = document.getElementById("app");
if (!app) throw new Error("#app não encontrado");

const room = new URLSearchParams(location.search).get("room");

if (room) mountViewer(app, room.trim().toLowerCase());
else mountHost(app);
