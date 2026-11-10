import { AREAS } from "./areas";
import { ADMIN_A_ARTICLES, ADMIN_A_FLOWS } from "./content-admin-a";
import { ADMIN_B_ARTICLES, ADMIN_B_FLOWS } from "./content-admin-b";
import { GENERAL_ARTICLES, GENERAL_FLOWS } from "./content-general";
import { TICKET_ARTICLES } from "./content-tickets";
import type { Area, Article, Audience, Flow, L } from "./types";

export { AREAS };
export type { Area, Article, Audience, Flow, L };

export const ARTICLES: Article[] = [...TICKET_ARTICLES, ...GENERAL_ARTICLES, ...ADMIN_A_ARTICLES, ...ADMIN_B_ARTICLES];
export const FLOWS: Flow[] = [...GENERAL_FLOWS, ...ADMIN_A_FLOWS, ...ADMIN_B_FLOWS];

/** The one audience a signed-in person belongs to. Administrators see all, so they get "admin". */
export function audienceOf(roles: string[]): Audience {
  if (roles.includes("admin")) return "admin";
  if (roles.some((r) => r !== "customer")) return "agent";
  return "customer";
}

/** Can this person see an item? Administrators see everything. Others see their audience, plus items their permissions unlock. */
export function canSee(item: { audience: Audience[]; perm?: string | string[] }, who: Audience, perms: ReadonlySet<string>): boolean {
  if (who === "admin") return true;
  if (item.audience.includes(who)) return true;
  if (who !== "agent" || !item.perm) return false;
  return (Array.isArray(item.perm) ? item.perm : [item.perm]).some((p) => perms.has(p));
}

export const pickL = (t: L, locale: string): string => (locale === "ar" ? t.ar : t.en);
