/** Text in both site languages. Every piece of Help Center text is written in English and Arabic together, so the two can never drift apart. */
export interface L { en: string; ar: string }

/** Who an article is written for. An administrator sees all of them. */
export type Audience = "customer" | "agent" | "admin";

export type AreaId = "tickets" | "customers" | "kb" | "account" | "reports" | "sla" | "catalog" | "people" | "system" | "email" | "site";

export interface Area { id: AreaId; title: L; blurb: L }

interface Base {
  id: string;
  area: AreaId;
  /** Roles this is for. An administrator sees everything regardless. */
  audience: Audience[];
  /** An agent whose account type ticks this permission also sees the article (for example manage_kb). Give a list when any one of several permissions is enough. */
  perm?: string | string[];
  title: L;
}

/** Colour of an option card's badge. */
export type OptionTone = "neutral" | "brand" | "purple" | "ok" | "warn" | "danger";

/** One choice, setting, status or group inside a feature, drawn as a small card (or a chip when it has no text). */
export interface FeatureOption { name: L; tag?: L; tone?: OptionTone; text?: L; points?: L[] }

/**
 * What a part of the system does. `summary` is the one-line lead under the title; the details are split into
 * `rule` (what always applies, highlighted), `options` (cards, titled by `optionsTitle`), `points` (bullets) and `notes`.
 */
export interface Feature extends Base {
  kind: "feature"; summary: L; path?: string; tips?: L[];
  rule?: L; optionsTitle?: L; options?: FeatureOption[]; points?: L[]; notes?: L[];
  /** How-to guides shown in the footer; when left out, the guides that open the same page are used. */
  related?: string[];
}
/** Step-by-step guide to one task. */
export interface HowTo extends Base { kind: "howto"; summary: L; steps: L[]; path?: string; tips?: L[]; related?: string[] }
export type Article = Feature | HowTo;

export type Tone = "a" | "o" | "d";
/** A process drawn as a chain of steps. */
export interface Flow { id: string; area: AreaId; audience: Audience[]; perm?: string | string[]; title: L; summary: L; nodes: { label: L; tone?: Tone }[] }
