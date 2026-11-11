import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/**
 * The small, safe Markdown subset used in system messages (v1 lib/system-messages/rich.ts):
 * **bold**, *italic*, [text](link), [#name] anchor, "- " bullet lines, blank line = new paragraph. Never raw HTML.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i'; c: Inline[] }
  | { t: 'a'; href: string; external: boolean; c: Inline[] }
  | { t: 'anchor'; id: string }
  | { t: 'br' };
export type Block = { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] };

export function safeHref(raw: string): string | null {
  const u = raw.trim();
  if (!u || /\s/.test(u)) return null;
  if (/^https?:\/\/[^\s/]+/i.test(u) || /^mailto:[^\s@]+@[^\s@]+$/i.test(u) || /^tel:\+?[0-9() -]{3,}$/i.test(u)) return u;
  if (/^\/(?!\/)[^\s]*$/.test(u) || /^#[A-Za-z][\w-]{0,40}$/.test(u)) return u;
  return null;
}

const ANCHOR = /^\[#([A-Za-z][\w-]{0,40})\](?!\()/;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]*)\)/;

function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpMatchArray | null;
    if (rest.startsWith('**') && (m = rest.match(/^\*\*([^*][\s\S]*?)\*\*/))) { flush(); out.push({ t: 'b', c: inline(m[1]) }); i += m[0].length; continue; }
    if (rest.startsWith('*') && !rest.startsWith('**') && (m = rest.match(/^\*([^*\s][^*]*?)\*/))) { flush(); out.push({ t: 'i', c: inline(m[1]) }); i += m[0].length; continue; }
    if (rest.startsWith('[') && (m = rest.match(ANCHOR))) { flush(); out.push({ t: 'anchor', id: m[1] }); i += m[0].length; continue; }
    if (rest.startsWith('[') && (m = rest.match(LINK))) {
      const href = safeHref(m[2]);
      flush();
      if (href) out.push({ t: 'a', href, external: /^https?:/i.test(href), c: inline(m[1]) }); else out.push(...inline(m[1]));
      i += m[0].length; continue;
    }
    if (rest.startsWith('\n')) { flush(); out.push({ t: 'br' }); i += 1; continue; }
    text += s[i]; i += 1;
  }
  flush();
  return out;
}

export function parseRich(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', c: inline(para.join('\n')) }); para = []; } };
  const flushList = () => { if (list.length) { blocks.push({ t: 'ul', items: list.map(inline) }); list = []; } };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const bullet = line.match(/^\s*[-•]\s+(.*)$/);
    if (bullet) { flushPara(); list.push(bullet[1]); } else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return blocks;
}

/** Names that appear as {name} in a text. */
export const varsOf = (src: string): string[] => [...new Set([...src.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

/** Shows an editable system message (v1 RichText). Plain text shows unchanged. */
@Component({
  selector: 'app-rich',
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #inl let-nodes>
      @for (n of $any(nodes); track $index) {
        @switch (n.t) {
          @case ('text') {{{ n.v }}}
          @case ('br') {<br />}
          @case ('b') {<strong><ng-container *ngTemplateOutlet="inl; context: { $implicit: n.c }" /></strong>}
          @case ('i') {<em><ng-container *ngTemplateOutlet="inl; context: { $implicit: n.c }" /></em>}
          @case ('anchor') {<span [id]="n.id"></span>}
          @case ('a') {<a [href]="n.href" class="font-semibold text-brand-ink underline" [attr.target]="n.external ? '_blank' : null" [attr.rel]="n.external ? 'noopener noreferrer' : null"><ng-container *ngTemplateOutlet="inl; context: { $implicit: n.c }" /></a>}
        }
      }
    </ng-template>
    <span class="flex flex-col gap-2 text-start" [class.leading-7]="!compact()">
      @for (b of blocks(); track $index) {
        @if (b.t === 'p') { <span class="block"><ng-container *ngTemplateOutlet="inl; context: { $implicit: b.c }" /></span> }
        @else { <ul class="list-disc ps-5">@for (it of b.items; track $index) { <li><ng-container *ngTemplateOutlet="inl; context: { $implicit: it }" /></li> }</ul> }
      }
    </span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichText {
  readonly text = input('');
  readonly compact = input(false);
  protected readonly blocks = computed(() => parseRich(this.text() ?? ''));
}
