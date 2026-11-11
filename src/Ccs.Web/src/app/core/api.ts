import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18n } from './i18n';
import { apiUrl } from './api-base';

// ---- Contracts (mirror Ccs.Application DTOs, camelCase JSON) ----------------------------------

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface TicketListItem {
  id: string; reference: string; subject: string; status: string; priority: string; priorityColor: string | null; priorityIcon?: string | null;
  priorityEn: string | null; priorityAr: string | null; categoryEn: string; categoryAr: string; teamEn: string | null; teamAr: string | null; assigneeName: string | null;
  requesterName: string; slaState: string | null; resolutionDue: string | null; createdAt: string; updatedAt: string;
  requesterEmail?: string | null; firstResponseDue?: string | null; firstRespondedAt?: string | null; pausedAt?: string | null;
  pausedTotalSeconds?: number; resolvedAt?: string | null;
}

export interface TicketSummary { total: number; active: number; waiting: number; resolved: number; closed: number; unassigned: number; breached: number }

export interface Attachment { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }
export interface Message {
  id: string; kind: 'public_reply' | 'internal_note' | 'system' | 'ticket_files'; body: string; authorId: string | null;
  authorName: string | null; authorIsStaff: boolean; createdAt: string; editedAt: string | null; attachments: Attachment[];
}
export interface TimelineEntry { at: string; from: string | null; to: string; reason: string | null; closureReason: string | null; byName: string | null }
export interface Names {
  typeEn: string | null; typeAr: string | null; categoryEn: string; categoryAr: string; subcategoryEn: string | null; subcategoryAr: string | null;
  teamEn: string | null; teamAr: string | null; assignee: string | null; priorityEn: string | null; priorityAr: string | null; priorityColor: string | null; priorityIcon?: string | null;
  closureEn: string | null; closureAr: string | null; closureAllowsReopen: boolean;
}
export interface TicketDetail {
  id: string; reference: string; subject: string; description: string; status: string; priority: string;
  typeId: string | null; categoryId: string; subcategoryId: string | null; teamId: string | null; assignedAgentId: string | null;
  requesterName: string; requesterEmail: string; requesterId: string; resolutionSummary: string | null; closureReason: string | null;
  reopenedCount: number; createdAt: string; updatedAt: string; resolvedAt: string | null; closedAt: string | null;
  slaState: string | null; firstResponseDue: string | null; resolutionDue: string | null;
  messages: Message[]; timeline: TimelineEntry[]; allowedMoves: string[]; canSeeInternalNotes: boolean; canReply: boolean;
  canReopen: boolean; hasFeedback: boolean; hasPendingCancellation: boolean; customValues: Record<string, string>; names: Names;
}

export interface TypeOption { id: string; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; categoryIds: string[] }
export interface SubcategoryOption { id: string; nameEn: string; nameAr: string; fixedPriority: string | null }
export interface CategoryOption { id: string; nameEn: string; nameAr: string; fixedPriority: string | null; subcategories: SubcategoryOption[] }
export interface PriorityOption { code: string; nameEn: string; nameAr: string; color: string; icon: string }
export interface FieldOption { id: string; key: string; labelEn: string; labelAr: string; type: string; options: string; isRequired: boolean; validation: string; visibleToCustomer: boolean; categoryId: string | null }
export interface NewTicketOptions { types: TypeOption[]; categories: CategoryOption[]; priorities: PriorityOption[]; fields: FieldOption[]; customerPicksPriority: boolean }

export interface SiteInfo {
  site: {
    siteNameEn: string; siteNameAr: string; headerNameEn: string; headerNameAr: string; headerSubEn: string; headerSubAr: string;
    logoPath: string | null; faviconPath?: string | null; homeContent?: string; footerTextEn: string; footerTextAr: string; contactEmail: string | null; contactPhone: string | null;
    contactHoursEn: string; contactHoursAr: string; brandColor: string | null; loginNoticeEn: string; loginNoticeAr: string;
    homeTitleEn: string; homeTitleAr: string; homeIntroEn: string; homeIntroAr: string; registrationMode: string;
    uploadMaxMb: number; uploadMaxFiles: number; uploadExtensions: string;
  } | null;
  captcha: { enabled: boolean; provider: string | null; siteKey: string | null };
  signinCodes: { enabled: boolean; audience: string; length: number };
  passwordPolicy: { minLength: number; requireUpper: boolean; requireLower: boolean; requireNumber: boolean; requireSpecial: boolean };
  autoRefreshSeconds: number;
  minReplyChars: number;
  reopenWindowDays: number;
  systemMessages?: { key: string; locale: string; body: string }[];
}

export interface MenuRow { id: string; area: string; parentId: string | null; kind: 'link' | 'group'; labelEn: string; labelAr: string; href: string | null; audience: string; newTab: boolean; sortOrder: number; systemKey: string | null }

// ---- Services ---------------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class SiteService {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  readonly info = signal<SiteInfo | null>(null);
  readonly menus = signal<MenuRow[]>([]);
  /** The uploaded logo, or null for the built-in mark. */
  readonly logoUrl = computed(() => { const p = this.info()?.site?.logoPath; return p ? apiUrl('/api/site/branding/' + p) : null; });

  async load(): Promise<void> {
    try {
      const [info, menus] = await Promise.all([
        firstValueFrom(this.http.get<SiteInfo>('/api/site')),
        firstValueFrom(this.http.get<MenuRow[]>('/api/site/menus')),
      ]);
      this.info.set(info);
      this.menus.set(menus);
      this.i18n.setOverrides(info.systemMessages ?? []);
      const fav = info.site?.faviconPath;
      if (fav) {
        let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (!el) { el = document.createElement('link'); el.rel = 'icon'; document.head.appendChild(el); }
        el.href = apiUrl('/api/site/branding/' + fav);
      }
      if (info.site?.brandColor && /^#[0-9a-fA-F]{6}$/.test(info.site.brandColor)) applyBrand(info.site.brandColor);
    } catch {
      this.info.set(null);   // the shell still renders with the built-in defaults
    }
  }
}

/** Same as brandShades() today: the admin-chosen brand colour plus a darker ink and a soft tint. */
function applyBrand(hex: string): void {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number, t: number, w: number) => Math.round(c + (t - c) * w);
  const toHex = (rr: number, gg: number, bb: number) => '#' + [rr, gg, bb].map((v) => v.toString(16).padStart(2, '0')).join('');
  const root = document.documentElement.style;
  root.setProperty('--brand', hex);
  root.setProperty('--brand-ink', toHex(mix(r, 0, 0.2), mix(g, 0, 0.2), mix(b, 0, 0.2)));
  root.setProperty('--brand-soft', toHex(mix(r, 255, 0.88), mix(g, 255, 0.88), mix(b, 255, 0.88)));
}

@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly http = inject(HttpClient);

  list(q: Record<string, string | number | boolean | undefined>): Promise<Paged<TicketListItem>> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return firstValueFrom(this.http.get<Paged<TicketListItem>>('/api/tickets', { params }));
  }
  summary(mine: boolean): Promise<TicketSummary> {
    return firstValueFrom(this.http.get<TicketSummary>('/api/tickets/summary', { params: { mine } }));
  }
  get(id: string): Promise<TicketDetail> { return firstValueFrom(this.http.get<TicketDetail>(`/api/tickets/${id}`)); }
  options(): Promise<NewTicketOptions> { return firstValueFrom(this.http.get<NewTicketOptions>('/api/tickets/options')); }
  create(body: unknown): Promise<{ id: string; reference: string }> { return firstValueFrom(this.http.post<{ id: string; reference: string }>('/api/tickets', body)); }
  status(id: string, body: { to: string; reason?: string; resolution?: string; closureReason?: string }): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/tickets/${id}/status`, body));
  }
  message(id: string, kind: string, body: string): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`/api/tickets/${id}/messages`, { kind, body }));
  }
  assign(id: string, teamId: string, agentId: string | null, reason?: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/tickets/${id}/assign`, { teamId, agentId, reason }));
  }
}
