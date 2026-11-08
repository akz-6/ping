// Desativa a injeção dinâmica de tags <style> pelo Video.js (vjs-styles-defaults e vjs-styles-dimensions)
// para conformidade estrita com Content-Security-Policy (CSP) style-src 'self' sem 'unsafe-inline'.
(window as unknown as { VIDEOJS_NO_DYNAMIC_STYLE?: boolean }).VIDEOJS_NO_DYNAMIC_STYLE = true;
