export type MobileIconName =
  | "arrow-left"
  | "volume-2"
  | "volume-x"
  | "message-square"
  | "maximize-2"
  | "minimize-2"
  | "expand"
  | "sliders"
  | "bar-chart-2"
  | "share-2"
  | "copy"
  | "check"
  | "x"
  | "wifi"
  | "wifi-off"
  | "refresh-cw"
  | "users";

const ICON_PATHS: Record<MobileIconName, string[]> = {
  "arrow-left": ["M19 12H5", "M12 19l-7-7 7-7"],
  "volume-2": [
    "M11 5L6 9H2v6h4l5 4V5z",
    "M15.54 8.46a5 5 0 0 1 0 7.07",
    "M19.07 4.93a10 10 0 0 1 0 14.14",
  ],
  "volume-x": [
    "M11 5L6 9H2v6h4l5 4V5z",
    "M23 9l-6 6",
    "M17 9l6 6",
  ],
  "message-square": [
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  ],
  "maximize-2": [
    "M15 3h6v6",
    "M9 21H3v-6",
    "M21 3l-7 7",
    "M3 21l7-7",
  ],
  "minimize-2": [
    "M4 14h6v6",
    "M20 10h-6V4",
    "M14 10l7-7",
    "M3 21l7-7",
  ],
  expand: [
    "M3 7V5a2 2 0 0 1 2-2h2",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "M21 17v2a2 2 0 0 1-2 2h-2",
    "M7 21H5a2 2 0 0 1-2-2v-2",
  ],
  sliders: [
    "M4 21v-7",
    "M4 10V3",
    "M12 21v-9",
    "M12 8V3",
    "M20 21v-5",
    "M20 12V3",
    "M1 14h6",
    "M9 8h6",
    "M17 16h6",
  ],
  "bar-chart-2": ["M18 20V10", "M12 20V4", "M6 20v-6"],
  "share-2": [
    "M18 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "M6 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "M18 19a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "M8.59 13.51l6.83 3.98",
    "M15.41 6.51l-6.82 3.98",
  ],
  copy: [
    "M9 9h13v13H9z",
    "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  ],
  check: ["M20 6L9 17l-5-5"],
  x: ["M18 6L6 18", "M6 6l12 12"],
  wifi: [
    "M5 12.55a11 11 0 0 1 14.08 0",
    "M1.42 9a16 16 0 0 1 21.16 0",
    "M8.53 16.11a6 6 0 0 1 6.95 0",
    "M12 20h.01",
  ],
  "wifi-off": [
    "M1 1l22 22",
    "M16.72 11.06A10.94 10.94 0 0 1 19 12.55",
    "M5 12.55a10.94 10.94 0 0 1 5.17-2.39",
    "M10.71 5.05A16 16 0 0 1 22.58 9",
    "M1.42 9a15.91 15.91 0 0 1 4.7-2.88",
    "M8.53 16.11a6 6 0 0 1 6.95 0",
    "M12 20h.01",
  ],
  "refresh-cw": [
    "M23 4v6h-6",
    "M1 20v-6h6",
    "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  ],
  users: [
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
    "M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M23 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function createMobileIcon(name: MobileIconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mobile-icon");

  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
