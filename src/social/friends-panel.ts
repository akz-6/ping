import { renderAvatar } from '../app/avatar';
import type { FriendsService } from './friends-service';
import type { Friend, FriendRequest, FriendsApiError, FriendsSnapshot, PingProfile } from './types';

export interface FriendsPanelOptions {
  root: HTMLElement;
  service: FriendsService;
  profile: PingProfile | null;          // null = não logado
  discordConfigured: boolean;           // /api/discord-auth?action=status
  toast(message: string, kind?: 'info' | 'error'): void;
}

const ERRORS: Record<FriendsApiError, string> = {
  unauthenticated: 'Entre com o Discord para usar amigos.',
  not_found: 'Não encontramos esse usuário no Ping. Ele precisa ter entrado com o Discord ao menos uma vez.',
  self: 'Esse é o seu próprio usuário.',
  already_friends: 'Vocês já são amigos.',
  rate_limited: 'Muitas tentativas. Espere um minuto.',
  limit_reached: 'Limite de amigos atingido.',
  invalid: 'Não foi possível concluir. Tente de novo.',
};

export function mountFriendsPanel(opts: FriendsPanelOptions): () => void {
  const { root, service } = opts;
  root.classList.add('friends');

  if (!opts.profile) {
    root.replaceChildren(lockedView(opts.discordConfigured));
    return () => root.replaceChildren();
  }

  const unsubscribe = service.subscribe((snap, status, error) => render(snap, status, error));
  service.start();

  function render(snap: FriendsSnapshot | null, status?: string, error?: string): void {
    const head = div('friends__head ping-friends-header');
    const headWrap = div('friends__head-info');
    const title = document.createElement('h2');
    title.className = 'friends__title';
    title.textContent = 'Amigos';
    const count = document.createElement('span');
    count.className = 'ping-friends-count';
    const onlineCount = snap?.friends.filter((f) => f.presence === 'online' || f.presence === 'hosting' || f.presence === 'watching').length ?? 0;
    count.textContent = snap ? `${onlineCount} amigos online` : 'Amigos conectados';
    headWrap.append(title, count);
    head.appendChild(headWrap);

    const form = document.createElement('form');
    form.className = 'friends__add ping-add-friend';
    form.setAttribute('data-action', 'add-friend');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'username';
    input.placeholder = 'Adicionar por @usuário';
    input.setAttribute('aria-label', 'Username do amigo');
    input.maxLength = 40;
    const add = button('Adicionar', 'btn btn--sm button button--secondary ping-button ping-button--secondary', 'submit');
    form.append(input, add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const handle = input.value.trim();
      if (!handle) return;
      add.disabled = true;
      const res = await service.request(handle);
      add.disabled = false;
      if (res.ok) { input.value = ''; opts.toast('Pedido enviado.'); }
      else opts.toast(ERRORS[res.error as FriendsApiError] || 'Não foi possível concluir.', 'error');
    });

    const nodes: Node[] = [head, form];

    if (snap && snap.incoming.length) nodes.push(requestsView(snap.incoming));

    const listWrap = div('ping-friends-list friends__list');

    if (!snap && status === 'loading') {
      const loading = div('ping-friends-loading friends__loading');
      const sk1 = div('ping-skeleton');
      const sk2 = div('ping-skeleton');
      loading.append(sk1, sk2);
      listWrap.append(loading);
    } else if (!snap && status === 'error') {
      const errBox = div('ping-friends-empty friends-error');
      const p = document.createElement('p');
      p.textContent = error === 'unauthenticated' ? 'Entre com o Discord para carregar amigos.' : 'Erro ao conectar aos servidores de amigos.';
      const retryBtn = button('Tentar novamente', 'btn btn--sm button button--secondary', 'button');
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        void service.refresh().finally(() => { retryBtn.disabled = false; });
      });
      errBox.append(p, retryBtn);
      listWrap.append(errBox);
    } else if (!snap || !snap.friends.length) {
      const empty = div('ping-friends-empty friends__empty');
      const p = document.createElement('p');
      p.textContent = 'Você ainda não tem amigos no Ping. Adicione alguém pelo @usuário do Discord.';
      empty.append(p);
      listWrap.append(empty);
    } else {
      const groups: [string, Friend[]][] = [
        ['Transmitindo', snap.friends.filter((f) => f.presence === 'hosting')],
        ['Online', snap.friends.filter((f) => f.presence === 'online' || f.presence === 'watching')],
        ['Offline', snap.friends.filter((f) => f.presence === 'offline')],
      ];
      for (const [label, list] of groups) {
        if (!list.length) continue;
        const g = document.createElement('p');
        g.className = 'friends__group';
        g.textContent = `${label} (${list.length})`;
        listWrap.append(g, ...list.map(friendRow));
      }
    }
    nodes.push(listWrap);

    const toggle = document.createElement('label');
    toggle.className = 'ping-activity-setting switch-row activity-setting';
    const textWrap = div('ping-activity-setting-text');
    const strong = document.createElement('strong');
    strong.textContent = 'Mostrar minha atividade';
    const p = document.createElement('p');
    p.textContent = 'Amigos veem se você está online e em qual sala pública.';
    textWrap.append(strong, p);

    const switchLabel = document.createElement('span');
    switchLabel.className = 'ping-switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'showActivity';
    cb.checked = snap?.settings.showActivity ?? true;
    cb.addEventListener('change', async () => {
      const res = await service.setShowActivity(cb.checked);
      if (!res.ok) { cb.checked = !cb.checked; opts.toast(ERRORS[res.error as FriendsApiError] || 'Erro', 'error'); }
    });
    const slider = document.createElement('span');
    slider.className = 'ping-switch__slider';
    switchLabel.append(cb, slider);

    toggle.append(textWrap, switchLabel);
    nodes.push(toggle);

    root.replaceChildren(...nodes);
  }

  function friendRow(f: Friend): HTMLElement {
    const row = div('friend');
    row.dataset.discordId = f.discordId;
    const text = div('friend__text');
    const name = div('friend__name');
    name.textContent = f.displayName;
    const status = div('friend__status');
    status.dataset.state = f.presence;
    status.textContent = statusText(f);
    text.append(name, status);
    row.append(renderAvatar({ name: f.displayName, url: f.avatarUrl, presence: f.presence }), text);

    if (f.room) {
      const join = button('Entrar', 'btn btn--sm btn--primary');
      join.setAttribute('aria-label', `Entrar na sala de ${f.displayName}`);
      join.addEventListener('click', () => window.location.assign(`/?room=${encodeURIComponent(f.room!.id)}`));
      row.appendChild(join);
    }
    const rm = button('Remover', 'btn btn--sm btn--ghost');
    rm.addEventListener('click', async () => {
      if (!window.confirm(`Remover ${f.displayName} dos amigos?`)) return;
      const res = await service.remove(f.discordId);
      if (!res.ok) opts.toast(ERRORS[res.error], 'error');
    });
    if (!f.room) row.appendChild(rm);
    return row;
  }

  function requestsView(list: FriendRequest[]): HTMLElement {
    const box = div('friends__requests');
    const g = document.createElement('p');
    g.className = 'friends__group';
    g.textContent = `Pedidos recebidos (${list.length})`;
    box.appendChild(g);
    for (const r of list) {
      const row = div('friend');
      const text = div('friend__text');
      const name = div('friend__name');
      name.textContent = r.from.displayName;
      const handle = div('friend__status');
      handle.textContent = `@${r.from.username}`;
      text.append(name, handle);
      const ok = button('Aceitar', 'btn btn--sm btn--primary');
      const no = button('Recusar', 'btn btn--sm btn--ghost');
      ok.addEventListener('click', () => void service.accept(r.from.discordId));
      no.addEventListener('click', () => void service.decline(r.from.discordId));
      row.append(renderAvatar({ name: r.from.displayName, url: r.from.avatarUrl }), text, ok, no);
      box.appendChild(row);
    }
    return box;
  }

  return () => {
    unsubscribe();
    service.stop();
    root.replaceChildren();
  };
}

function statusText(f: Friend): string {
  if (f.presence === 'offline') return 'Offline';
  if (f.inPrivateRoom) return 'Em uma sala privada';
  if (f.presence === 'hosting') return f.room ? `Transmitindo: ${f.room.name}` : 'Transmitindo';
  if (f.presence === 'watching') return f.room ? `Assistindo: ${f.room.name}` : 'Assistindo';
  return 'Online';
}

function lockedView(configured: boolean): HTMLElement {
  const box = div('friends__locked');
  const p = document.createElement('p');
  p.textContent = configured
    ? 'Entre com o Discord para ver quem está online e entrar nas salas dos seus amigos.'
    : 'O login com Discord ainda não está disponível neste ambiente.';
  const a = document.createElement('a');
  a.className = 'btn btn--discord';
  a.textContent = 'Entrar com o Discord';
  if (configured) a.href = '/api/discord-auth?action=login';
  else { a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; }
  box.append(p, a);
  return box;
}

function div(className: string): HTMLElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function button(text: string, className: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = type;
  b.className = className;
  b.textContent = text;
  return b;
}
