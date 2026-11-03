import { h, icon } from "../dom";

export type AdSize = "300x250" | "300x600" | "320x100";
export type ConsentStatus = "accepted" | "essential" | "prompt";

export const CONSENT_STORAGE_KEY = "ping:cookie_consent";

export interface DirectSponsor {
  id: string;
  brand: string;
  badge: string;
  title: string;
  description: string;
  ctaText: string;
  url: string;
  iconName: string;
  statNumber?: string;
  statLabel?: string;
  highlights?: string[];
}

export const DIRECT_SPONSORS: Record<string, DirectSponsor> = {
  oracle: {
    id: "oracle",
    brand: "Oracle Cloud Free Tier",
    badge: "Patrocinado",
    title: "10 TB / mês de tráfego grátis",
    description: "Infraestrutura Always Free para hospedar seus nós de mídia, servidores TURN e Coturn WebRTC sem mensalidades.",
    ctaText: "Acessar Always Free",
    url: "https://www.oracle.com/cloud/free/",
    iconName: "refresh",
    statNumber: "10.000 GB",
    statLabel: "Tráfego de rede gratuito por mês",
    highlights: [
      "4 OCPU Ampere ARM & 24 GB RAM",
      "10 TB de transferência de saída",
      "2 instâncias AMD gratuitas para sempre",
      "Ideal para servidores Coturn e WebRTC",
    ],
  },
  vercel: {
    id: "vercel",
    brand: "Vercel Frontend Cloud",
    badge: "Patrocinado",
    title: "Deploy global com alta performance",
    description: "Hospede aplicações WebRTC, Next.js e Vite com roteamento inteligente na velocidade da borda.",
    ctaText: "Começar na Vercel",
    url: "https://vercel.com",
    iconName: "verified",
    statNumber: "Global Edge",
    statLabel: "Rede distribuída ultrarrápida",
    highlights: [
      "Deploy contínuo via GitHub",
      "Proteção DDoS e CDN global",
      "Visualização instantânea de PRs",
      "Hospedagem nativa do Ping",
    ],
  },
};

export function getConsentStatus(): ConsentStatus {
  try {
    const val = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (val === "accepted" || val === "essential") return val;
  } catch {
    // Falha silenciosa em caso de restrições de sandbox/cookies
  }
  return "prompt";
}

export function saveConsent(status: "accepted" | "essential"): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, status);
  } catch {
    // Falha silenciosa
  }
  window.dispatchEvent(new CustomEvent("ping:consent-changed", { detail: { status } }));
}

export function hasAdConsent(): boolean {
  return getConsentStatus() === "accepted";
}

export function resetConsent(): void {
  try {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // Falha silenciosa
  }
  window.dispatchEvent(new CustomEvent("ping:consent-changed", { detail: { status: "prompt" } }));
}

/* ---------- Provedores de Anúncio ---------- */
export interface AdProvider {
  render(container: HTMLElement, size: AdSize): void;
}

export class DirectSponsorAdProvider implements AdProvider {
  constructor(private sponsor: DirectSponsor = DIRECT_SPONSORS.oracle) {}

  setSponsor(sponsor: DirectSponsor): void {
    this.sponsor = sponsor;
  }

  render(container: HTMLElement, size: AdSize): void {
    container.replaceChildren();

    // Se o usuário optou por apenas essenciais, exibe aviso respeitoso de anúncios pausados
    if (!hasAdConsent()) {
      container.classList.remove("has-sponsor");
      container.classList.add("is-optout");

      const optout = h(
        "div",
        { class: "ad-optout" },
        h(
          "div",
          { class: "ad-optout-head" },
          h("span", { class: "ad-badge-muted" }, "Anúncio pausado"),
        ),
        h("p", { class: "ad-optout-text" }, "Você optou por recursos essenciais."),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-secondary btn-sm ad-optout-btn",
            "aria-label": "Personalizar preferências de anúncios",
            onClick: () => {
              resetConsent();
              openConsentBanner();
            },
          },
          "Personalizar",
        ),
      );
      container.append(optout);
      return;
    }

    container.classList.remove("is-optout");
    container.classList.add("has-sponsor");

    if (size === "300x250") {
      container.append(this.render300x250());
    } else if (size === "300x600") {
      container.append(this.render300x600());
    } else {
      container.append(this.render320x100());
    }
  }

  private render300x250(): HTMLElement {
    const s = this.sponsor;
    return h(
      "a",
      {
        href: s.url,
        target: "_blank",
        rel: "sponsored noopener",
        class: "ad-creative ad-creative-300x250",
        "data-sponsor-id": s.id,
        "aria-label": `${s.badge}: ${s.brand} - ${s.title}`,
      },
      h(
        "div",
        { class: "ad-creative-head" },
        h("span", { class: "ad-badge" }, s.badge),
        h("span", { class: "ad-brand-tag" }, s.brand),
      ),
      h(
        "div",
        { class: "ad-creative-body" },
        h("div", { class: "ad-icon-row" }, icon(s.iconName, 24)),
        h("strong", { class: "ad-title" }, s.title),
        h("p", { class: "ad-desc" }, s.description),
      ),
      h(
        "div",
        { class: "ad-creative-foot" },
        h("span", { class: "btn btn-primary btn-sm btn-block ad-cta" }, s.ctaText),
      ),
    );
  }

  private render300x600(): HTMLElement {
    const s = this.sponsor;
    const items = (s.highlights ?? []).map((txt) => h("li", { class: "ad-feature-item" }, txt));

    return h(
      "a",
      {
        href: s.url,
        target: "_blank",
        rel: "sponsored noopener",
        class: "ad-creative ad-creative-300x600",
        "data-sponsor-id": s.id,
        "aria-label": `${s.badge}: ${s.brand} - ${s.title}`,
      },
      h(
        "div",
        { class: "ad-creative-head" },
        h("span", { class: "ad-badge" }, s.badge),
        h("span", { class: "ad-brand-tag" }, s.brand),
      ),
      s.statNumber
        ? h(
            "div",
            { class: "ad-creative-banner" },
            h("span", { class: "ad-stat-number" }, s.statNumber),
            h("span", { class: "ad-stat-label" }, s.statLabel ?? ""),
          )
        : null,
      h(
        "div",
        { class: "ad-creative-body" },
        h("strong", { class: "ad-title" }, s.title),
        h("p", { class: "ad-desc" }, s.description),
        items.length > 0 ? h("ul", { class: "ad-features-list" }, ...items) : null,
      ),
      h(
        "div",
        { class: "ad-creative-foot" },
        h("span", { class: "btn btn-primary btn-block ad-cta" }, s.ctaText),
      ),
    );
  }

  private render320x100(): HTMLElement {
    const s = this.sponsor;
    return h(
      "a",
      {
        href: s.url,
        target: "_blank",
        rel: "sponsored noopener",
        class: "ad-creative ad-creative-320x100",
        "data-sponsor-id": s.id,
        "aria-label": `${s.badge}: ${s.brand} - ${s.title}`,
      },
      h(
        "div",
        { class: "ad-mini-col" },
        h(
          "div",
          { class: "ad-mini-head" },
          h("span", { class: "ad-badge" }, s.badge),
          h("span", { class: "ad-mini-brand" }, s.brand),
        ),
        h("strong", { class: "ad-mini-title" }, s.title),
      ),
      h("span", { class: "btn btn-primary btn-sm ad-mini-cta" }, s.ctaText),
    );
  }
}

export class PlaceholderAdProvider implements AdProvider {
  render(container: HTMLElement, size: AdSize): void {
    container.replaceChildren(
      h(
        "div",
        { class: "ad-placeholder" },
        h("span", { class: "ad-overline" }, "Publicidade"),
        h("span", { class: "ad-size" }, size.replace("x", " × ")),
      ),
    );
  }
}

let activeProvider: AdProvider = new DirectSponsorAdProvider();

export function setAdProvider(provider: AdProvider): void {
  activeProvider = provider;
}

export function getAdProvider(): AdProvider {
  return activeProvider;
}

/* ---------- AdSlot com Lazy Loading (IntersectionObserver) ---------- */
export function AdSlot(size: AdSize): HTMLElement {
  const slot = h("div", {
    class: `ad-slot ad-${size}`,
    "data-ad-size": size,
    "aria-label": `Espaço publicitário ${size.replace("x", " por ")}`,
  });

  // Placeholder esqueleto estático inicial para garantir layout shift estritamente ZERO (CLS = 0)
  slot.append(
    h(
      "div",
      { class: "ad-placeholder", "aria-hidden": "true" },
      h("span", { class: "ad-overline" }, "Publicidade"),
      h("span", { class: "ad-size" }, size.replace("x", " × ")),
    ),
  );

  let loaded = false;

  const loadContent = () => {
    if (loaded) return;
    loaded = true;
    activeProvider.render(slot, size);
  };

  // Se o navegador suporta IntersectionObserver, adia renderização até o slot entrar no campo visual
  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadContent();
            observer.unobserve(slot);
            break;
          }
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(slot);
  } else {
    loadContent();
  }

  // Atualiza automaticamente quando o consentimento do usuário é alterado
  window.addEventListener("ping:consent-changed", () => {
    if (loaded) {
      activeProvider.render(slot, size);
    }
  });

  return slot;
}

/* ---------- Banner LGPD / Consentimento de Privacidade ---------- */
export function openConsentBanner(onDecision?: (status: "accepted" | "essential") => void): HTMLElement {
  const existing = document.getElementById("ping-consent-banner");
  if (existing) {
    existing.remove();
  }

  const handleDecision = (status: "accepted" | "essential") => {
    saveConsent(status);
    banner.classList.add("is-closing");
    setTimeout(() => {
      banner.remove();
    }, 240);
    if (onDecision) onDecision(status);
  };

  const banner = h(
    "aside",
    {
      id: "ping-consent-banner",
      class: "consent-banner",
      role: "region",
      "aria-label": "Preferências de privacidade e cookies",
    },
    h(
      "div",
      { class: "consent-content" },
      h(
        "div",
        { class: "consent-text-wrap" },
        h("strong", { class: "consent-title" }, "Privacidade & Anúncios Responsáveis"),
        h(
          "p",
          { class: "consent-desc" },
          "O Ping utiliza armazenamento local para guardar suas preferências e exibe anúncios de patrocinadores para manter a plataforma e a transmissão P2P gratuitas. Ao aceitar, você apoia o projeto.",
        ),
      ),
      h(
        "div",
        { class: "consent-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn btn-secondary btn-sm consent-btn-essential",
            id: "consent-btn-essential",
            "aria-label": "Continuar usando apenas dados essenciais",
            onClick: () => handleDecision("essential"),
          },
          "Apenas essenciais",
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary btn-sm consent-btn-accept",
            id: "consent-btn-accept",
            "aria-label": "Aceitar anúncios e apoiar a plataforma",
            onClick: () => handleDecision("accepted"),
          },
          "Aceitar e apoiar",
        ),
      ),
    ),
  );

  document.body.append(banner);
  return banner;
}
