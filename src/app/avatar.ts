export type PresenceState = 'offline' | 'online' | 'watching' | 'hosting';
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

/** Só aceita imagens do CDN do Discord (a CSP também limita img-src a esse host). */
const DISCORD_AVATAR_URL =
  /^https:\/\/cdn\.discordapp\.com\/(avatars\/\d{5,25}\/[A-Za-z0-9_]{5,64}\.(webp|png|gif)|embed\/avatars\/\d\.png)(\?size=\d{2,4})?$/;

export function isSafeAvatarUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && DISCORD_AVATAR_URL.test(url);
}

/** Troca o tamanho pedido ao CDN (ex.: 128 na lista, 256 no modal de perfil). */
export function withAvatarSize(url: string, size: 64 | 128 | 256 | 512): string {
  return url.includes('?size=') ? url.replace(/\?size=\d+/, `?size=${size}`) : url;
}

export function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function renderAvatar(opts: {
  name: string;
  url?: string | null;
  size?: AvatarSize;
  presence?: PresenceState;
}): HTMLElement {
  const el = document.createElement('span');
  el.className = 'avatar';
  if (opts.size === 'sm') el.classList.add('avatar--sm');
  if (opts.size === 'lg') el.classList.add('avatar--lg');
  if (opts.size === 'xl') el.classList.add('avatar--xl');

  const showMonogram = () => {
    el.replaceChildren(document.createTextNode(monogram(opts.name)));
    el.setAttribute('aria-hidden', 'true');
  };

  if (isSafeAvatarUrl(opts.url)) {
    const img = document.createElement('img');
    img.className = 'chat-avatar';
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = opts.url;
    img.addEventListener('error', showMonogram, { once: true });
    el.appendChild(img);
  } else {
    showMonogram();
  }

  if (opts.presence) {
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.dataset.state = opts.presence;
    el.appendChild(dot);
  }
  return el;
}
