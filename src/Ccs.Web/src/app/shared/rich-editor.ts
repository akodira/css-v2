import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18n, TPipe } from '../core/i18n';

/*
 * Visual editor for email templates (Settings → Email templates). What you see is what the email shows; underneath it
 * keeps the small, safe text format the server turns into email HTML (EmailRenderer.MarkdownToHtml):
 *   **bold**  *italic*  [text](https://..)  "- " bullets  "## " heading  [center] / [end] / [justify] paragraph
 *   [line]  [tip]Title | text  [size=small|large|xl]..[/size]  [color=#hex]..[/color]  [mark]..[/mark]
 *   ![alt](/api/site/email-images/..)  | table | rows  and ``` code blocks.
 * Every paragraph is one line of that text, so existing templates open and save unchanged.
 */

const COLORS = ['#1650b8', '#16915a', '#b42318', '#52607a'];
const SIZES: Record<string, string> = { small: '13px', large: '19px', xl: '24px' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAFE_LINK = /^(\/[A-Za-z0-9/_?=&#.%-]*|https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[+0-9 ()-]+)$/;
const IMG_PATH = /^\/api\/site\/email-images\/[0-9a-f]{32}\.(png|jpg|jpeg|gif|webp)$/;

/** Text format → editable HTML. */
export function toHtml(md: string, dir: 'ltr' | 'rtl'): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith('```'); i++) code.push(lines[i]);
      out.push(`<pre>${esc(code.join('\n'))}</pre>`);
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^[-*] /.test(lines[i]); i++) items.push(`<li>${inline(lines[i].slice(2).trimEnd())}</li>`);
      i--; out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[] = []; let first = true;
      for (; i < lines.length && lines[i].trimEnd().startsWith('|'); i++) {
        const row = lines[i].trim().replace(/^\||\|$/g, '');
        if (/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*$/.test(row)) continue;
        const tag = first ? 'th' : 'td';
        rows.push('<tr>' + row.split('|').map((c) => `<${tag}>${inline(c.trim()) || '<br>'}</${tag}>`).join('') + '</tr>');
        first = false;
      }
      i--; out.push(`<table>${rows.join('')}</table>`);
      continue;
    }
    if (!line) continue;
    let align = '';
    const am = line.match(/^\[(center|end|start|justify)]/);
    if (am) { line = line.slice(am[0].length); align = am[1] === 'center' || am[1] === 'justify' ? am[1] : am[1] === 'end' ? (dir === 'rtl' ? 'left' : 'right') : ''; }
    const style = align ? ` style="text-align:${align}"` : '';
    if (line === '[line]') { out.push('<hr>'); continue; }
    if (line.startsWith('[tip]')) {
      const [t, x] = line.slice(5).split('|');
      out.push(`<div data-tip><div data-tip-title>${inline((t ?? '').trim()) || '<br>'}</div><div data-tip-text>${inline((x ?? '').trim()) || '<br>'}</div></div>`);
      continue;
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) { out.push(`<p${style || ' style="text-align:center"'}><img src="${esc(img[2])}" alt="${esc(img[1])}"></p>`); continue; }
    if (line.startsWith('## ')) { out.push(`<h2${style}>${inline(line.slice(3))}</h2>`); continue; }
    out.push(`<p${style}>${inline(line)}</p>`);
  }
  return out.join('') || '<p><br></p>';
}

function inline(text: string): string {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, h) => `<a href="${h}">${t}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/\[size=(small|large|xl)\](.+?)\[\/size\]/g, (m, z, t) => `<span data-size="${z}" style="font-size:${SIZES[z]}">${t}</span>`);
  s = s.replace(/\[color=(#[0-9a-fA-F]{6})\](.+?)\[\/color\]/g, '<span data-color="$1" style="color:$1">$2</span>');
  s = s.replace(/\[mark\](.+?)\[\/mark\]/g, '<mark>$1</mark>');
  return s;
}

/** Editable HTML → text format. */
export function fromHtml(root: HTMLElement, dir: 'ltr' | 'rtl'): string {
  const out: string[] = [];
  const alignOf = (el: HTMLElement): string => {
    const a = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
    if (a === 'center') return '[center]';
    if (a === 'justify') return '[justify]';
    if (a === 'end' || (a === 'right' && dir === 'ltr') || (a === 'left' && dir === 'rtl')) return '[end]';
    return '';
  };
  const block = (el: HTMLElement) => {
    const tag = el.tagName;
    if (tag === 'HR') { out.push('[line]'); return; }
    if (tag === 'PRE') { out.push('```', (el.textContent ?? '').replace(/\n$/, ''), '```'); return; }
    if (tag === 'UL' || tag === 'OL') { el.querySelectorAll(':scope > li').forEach((li) => { const t = inl(li).trim(); if (t) out.push('- ' + t); }); return; }
    if (tag === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')].map((tr) => '| ' + [...tr.children].map((c) => inl(c).trim().replace(/\|/g, '/')).join(' | ') + ' |');
      if (rows.length) { out.push(rows[0]); out.push('| ' + rows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |'); out.push(...rows.slice(1)); }
      return;
    }
    if (el.hasAttribute('data-tip')) {
      const t = inl(el.querySelector('[data-tip-title]') ?? el).trim(), x = inl(el.querySelector('[data-tip-text]') ?? document.createElement('i')).trim();
      if (t || x) out.push(`[tip]${t} | ${x}`);
      return;
    }
    const kids = [...el.children] as HTMLElement[];
    if (kids.some((k) => /^(P|DIV|H[1-6]|UL|OL|TABLE|PRE|HR)$/.test(k.tagName))) { walk(el); return; }   // a wrapper (Chrome nests divs)
    const only = el.querySelector('img');
    if (only && !(el.textContent ?? '').trim()) {
      const src = only.getAttribute('src') ?? '';
      const path = src.replace(/^https?:\/\/[^/]+/, '');
      if (IMG_PATH.test(path)) out.push(`${alignOf(el)}![${(only.getAttribute('alt') ?? '').replace(/[[\]]/g, '')}](${path})`);
      return;
    }
    const text = inl(el).trim();
    if (!text) return;
    out.push(alignOf(el) + (/^H[1-6]$/.test(tag) ? '## ' : '') + text);
  };
  const walk = (parent: HTMLElement) => {
    let loose = '';
    const flush = () => { if (loose.trim()) out.push(loose.trim()); loose = ''; };
    parent.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) { loose += (n.textContent ?? '').replace(/\s+/g, ' '); return; }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      if (/^(P|DIV|H[1-6]|UL|OL|TABLE|PRE|HR|BLOCKQUOTE)$/.test(el.tagName)) { flush(); block(el); }
      else if (el.tagName === 'BR') flush();
      else loose += inl(el);
    });
    flush();
  };
  walk(root);
  return out.join('\n');
}

function hex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('') : null;
}

function inl(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return ' ';
  let s = [...el.childNodes].map(inl).join('');
  if (!s.trim()) return s;
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG' || el.style.fontWeight === 'bold' || +el.style.fontWeight >= 600) s = `**${s}**`;
  if (tag === 'I' || tag === 'EM' || el.style.fontStyle === 'italic') s = `*${s}*`;
  if (tag === 'A') { const h = el.getAttribute('href') ?? ''; if (SAFE_LINK.test(h)) s = `[${s.replace(/[[\]]/g, '')}](${h})`; }
  const size = el.dataset['size'] ?? (tag === 'FONT' ? ({ '1': 'small', '2': 'small', '5': 'large', '6': 'xl', '7': 'xl' } as Record<string, string>)[el.getAttribute('size') ?? ''] : undefined)
    ?? ({ '13px': 'small', 'small': 'small', '19px': 'large', 'large': 'large', 'x-large': 'xl', '24px': 'xl', 'xx-large': 'xl' } as Record<string, string>)[el.style.fontSize];
  if (size) s = `[size=${size}]${s}[/size]`;
  const color = hex(el.dataset['color'] ?? (tag === 'FONT' ? el.getAttribute('color') ?? '' : el.style.color));
  if (color && color !== '#000000' && color !== '#0f1b2d') s = `[color=${color}]${s}[/color]`;
  if (tag === 'MARK' || (el.style.backgroundColor && el.style.backgroundColor !== 'transparent')) s = `[mark]${s}[/mark]`;
  return s;
}

@Component({
  selector: 'app-rich-editor',
  imports: [TPipe],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .re-wrap.re-full { position: fixed; inset: 0; z-index: 60; background: var(--color-bg, #f1f5fb); padding: 16px; overflow: auto; display: flex; flex-direction: column; }
    .re-wrap.re-full .re-area { flex: 1; max-width: 760px; width: 100%; margin: 0 auto; }
    .re-area { min-height: 7rem; outline: none; line-height: 1.6; }
    .re-area:focus-visible { box-shadow: 0 0 0 3px rgb(31 100 230 / .35); }
    .re-area p { margin: 0 0 .6em; }
    .re-area h2 { font-size: 1.25rem; font-weight: 700; margin: .2em 0 .5em; }
    .re-area ul { list-style: disc; padding-inline-start: 1.4em; margin: 0 0 .6em; }
    .re-area hr { border: 0; border-top: 1px solid #d3dbea; margin: .8em 0; }
    .re-area mark { background: #fff1a8; padding: 0 2px; }
    .re-area a { color: #1650b8; text-decoration: underline; }
    .re-area table { border-collapse: collapse; width: 100%; margin: 0 0 .6em; font-size: .9rem; }
    .re-area th, .re-area td { border: 1px solid #d3dbea; padding: 5px 8px; text-align: start; min-width: 3em; }
    .re-area th { background: #f0f4fb; font-weight: 600; }
    .re-area pre { background: #0f1b2d; color: #e5eefd; border-radius: 8px; padding: 10px 12px; font-size: .85rem; white-space: pre-wrap; direction: ltr; text-align: left; margin: 0 0 .6em; }
    .re-area img { max-width: 100%; border-radius: 8px; display: inline-block; }
    .re-area [data-tip] { background: #e5eefd; border-radius: 10px; padding: 10px 14px 10px 14px; margin: 0 0 .6em; border-inline-start: 4px solid #1f64e6; }
    .re-area [data-tip-title] { font-weight: 700; color: #0f2a66; }
    .re-area [data-tip-text] { font-size: .9rem; color: #1d3566; }
    .re-tb { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 2.25rem; min-width: 2.25rem; padding: 0 .5rem; border-radius: 6px; border: 1px solid var(--color-line, #e2e8f3); background: var(--color-surface, #fff); font-size: .85rem; font-weight: 600; cursor: pointer; }
    .re-tb:hover { background: var(--color-bg, #f1f5fb); }
    .re-dot { width: 20px; height: 20px; border-radius: 999px; border: 2px solid #fff; box-shadow: 0 0 0 1px #7d8aa3; cursor: pointer; }
  `,
  template: `
    <div class="re-wrap flex flex-col gap-2" [class.re-full]="full()">
      <div class="flex flex-wrap items-center gap-1.5" role="toolbar" [attr.aria-label]="'Editor.toolbar' | t">
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('bold')" [attr.aria-label]="'Editor.bold' | t" [title]="'Editor.bold' | t"><b>B</b></button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('italic')" [attr.aria-label]="'Editor.italic' | t" [title]="'Editor.italic' | t"><i>I</i></button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('insertUnorderedList')">{{ 'Editor.list' | t }}</button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="openLink()">{{ 'Editor.link' | t }}</button>
        <span class="mx-1 h-6 w-px bg-line" aria-hidden="true"></span>
        @for (a of aligns; track a.k) {
          <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="align(a.k)" [attr.aria-label]="'Editor.align_' + a.k | t" [title]="'Editor.align_' + a.k | t">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path [attr.d]="a.d" /></svg></button>
        }
        <span class="mx-1 h-6 w-px bg-line" aria-hidden="true"></span>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="heading()">{{ 'Editor.heading' | t }}</button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="tip()">{{ 'Editor.tip' | t }}</button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('insertHorizontalRule')">{{ 'Editor.line' | t }}</button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5" role="toolbar" [attr.aria-label]="'Editor.more' | t">
        <label class="re-tb"><span class="sr-only">{{ 'Editor.size' | t }}</span>
          <select class="bg-transparent font-semibold" (mousedown)="keep()" (change)="size($any($event.target))" [attr.aria-label]="'Editor.size' | t">
            <option value="">{{ 'Editor.size' | t }}</option><option value="small">{{ 'Editor.size_small' | t }}</option><option value="normal">{{ 'Editor.size_normal' | t }}</option>
            <option value="large">{{ 'Editor.size_large' | t }}</option><option value="xl">{{ 'Editor.size_xl' | t }}</option></select></label>
        <span class="re-tb" role="group" [attr.aria-label]="'Editor.color' | t">
          @for (c of colors; track c) { <button type="button" class="re-dot" [style.background]="c" (mousedown)="$event.preventDefault()" (click)="color(c)" [attr.aria-label]="('Editor.color' | t) + ' ' + c"></button> }
        </span>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="highlight()">{{ 'Editor.highlight' | t }}</button>
        <span class="mx-1 h-6 w-px bg-line" aria-hidden="true"></span>
        <label class="re-tb cursor-pointer">{{ 'Editor.image' | t }}<input type="file" class="sr-only" accept=".png,.jpg,.jpeg,.gif,.webp" (mousedown)="keep()" (change)="image($any($event.target))" /></label>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="table()">{{ 'Editor.table' | t }}</button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="code()">{{ 'Editor.code' | t }}</button>
        <span class="mx-1 h-6 w-px bg-line" aria-hidden="true"></span>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('undo')" [attr.aria-label]="'Editor.undo' | t" [title]="'Editor.undo' | t">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" /></svg></button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="cmd('redo')" [attr.aria-label]="'Editor.redo' | t" [title]="'Editor.redo' | t">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" /></svg></button>
        <button type="button" class="re-tb" (mousedown)="$event.preventDefault()" (click)="clear()">{{ 'Editor.clear' | t }}</button>
        <button type="button" class="re-tb" (click)="full.set(!full())" [attr.aria-pressed]="full()">{{ (full() ? 'Editor.exitFull' : 'Editor.full') | t }}</button>
      </div>
      @if (linkOpen()) {
        <div class="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg p-2">
          <input #linkBox dir="ltr" placeholder="https://, /login, mailto:, tel:" [attr.aria-label]="'Editor.linkAddress' | t" class="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm" (keydown.enter)="$event.preventDefault(); addLink(linkBox.value)" />
          <button type="button" class="re-tb" (click)="addLink(linkBox.value)">{{ 'Editor.insert' | t }}</button>
          <button type="button" class="re-tb" (click)="linkOpen.set(false)">{{ 'Editor.cancel' | t }}</button>
          @if (linkBad()) { <p role="alert" class="w-full text-sm font-semibold text-danger">{{ 'Editor.linkBad' | t }}</p> }
        </div>
      }
      @if (error()) { <p role="alert" class="text-sm font-semibold text-danger">{{ error() }}</p> }
      <div #area class="re-area rounded-lg border border-line bg-surface px-3 py-2 text-base" contenteditable="true" role="textbox" aria-multiline="true"
        [attr.aria-label]="label()" [attr.dir]="dir()" [style.min-height.rem]="rows() * 1.6" (input)="changed()" (focus)="focused.emit(this)" (keyup)="keep()" (mouseup)="keep()"></div>
    </div>`,
})
export class RichEditor {
  readonly value = input<string>('');
  readonly dir = input<'ltr' | 'rtl'>('ltr');
  readonly label = input('');
  readonly rows = input(5);
  readonly valueChange = output<string>();
  /** Emitted when the editor gets focus, so a placeholder picker can insert into it. */
  readonly focused = output<RichEditor>();

  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  private readonly area = viewChild.required<ElementRef<HTMLDivElement>>('area');
  protected readonly colors = COLORS;
  protected readonly full = signal(false);
  protected readonly linkOpen = signal(false);
  protected readonly linkBad = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aligns = [
    { k: 'start', d: 'M4 6h16M4 10h10M4 14h16M4 18h10' }, { k: 'center', d: 'M4 6h16M7 10h10M4 14h16M7 18h10' }, { k: 'end', d: 'M4 6h16M10 10h10M4 14h16M10 18h10' }, { k: 'justify', d: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  ];
  private last = '\u0000';
  private range: Range | null = null;

  constructor() {
    // Keep the latest selection inside the editor, however it was made (mouse, keyboard, select-all), so toolbar buttons act on it.
    const onSel = () => this.keep();
    document.addEventListener('selectionchange', onSel);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('selectionchange', onSel));
    // Load the text into the editor when it changes from outside (another event, reset to default); not while typing.
    effect(() => {
      const v = this.value(), d = this.dir();
      if (v === this.last) return;
      this.last = v;
      this.area().nativeElement.innerHTML = toHtml(v, d);
    });
  }

  protected changed(): void {
    const v = fromHtml(this.area().nativeElement, this.dir());
    this.last = v;
    this.valueChange.emit(v);
  }
  /** Remembers the cursor so a toolbar control or a placeholder can act where the person was typing. */
  protected keep(): void {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && this.area().nativeElement.contains(sel.anchorNode)) this.range = sel.getRangeAt(0).cloneRange();
  }
  private restore(): void {
    const el = this.area().nativeElement;
    el.focus();
    if (this.range && el.contains(this.range.startContainer)) { const sel = document.getSelection(); sel?.removeAllRanges(); sel?.addRange(this.range); }
  }
  protected cmd(name: string, arg?: string): void {
    this.restore();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(name, false, arg);
    this.changed(); this.keep();
  }
  protected align(k: string): void {
    const rtl = this.dir() === 'rtl';
    this.cmd(k === 'center' ? 'justifyCenter' : k === 'justify' ? 'justifyFull' : (k === 'end') !== rtl ? 'justifyRight' : 'justifyLeft');
  }
  protected heading(): void {
    this.restore();
    const block = (document.getSelection()?.anchorNode as HTMLElement | null)?.parentElement?.closest('h2,p,div');
    document.execCommand('formatBlock', false, block?.tagName === 'H2' ? 'p' : 'h2');
    this.changed();
  }
  protected tip(): void {
    this.restore();
    const ar = this.dir() === 'rtl';
    this.insertBlock(`<div data-tip><div data-tip-title>${ar ? 'نصيحة' : 'Tip'}</div><div data-tip-text>${ar ? 'اكتب النصيحة هنا.' : 'Write the tip here.'}</div></div>`);
  }
  protected size(sel: HTMLSelectElement): void {
    const v = sel.value; sel.value = '';
    if (!v) return;
    this.cmd('fontSize', v === 'small' ? '2' : v === 'large' ? '5' : v === 'xl' ? '6' : '3');
  }
  protected color(c: string): void { this.cmd('foreColor', c); }
  protected highlight(): void {
    this.restore();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('hiliteColor', false, '#fff1a8');
    document.execCommand('styleWithCSS', false, 'false');
    this.changed();
  }
  protected table(): void {
    this.restore();
    const ar = this.dir() === 'rtl';
    const [a, b] = ar ? ['البند', 'القيمة'] : ['Item', 'Value'];
    this.insertBlock(`<table><tr><th>${a}</th><th>${b}</th></tr><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></table>`);
  }
  protected code(): void { this.restore(); document.execCommand('formatBlock', false, 'pre'); this.changed(); }
  protected clear(): void {
    this.restore();
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    document.execCommand('formatBlock', false, 'p');
    document.execCommand(this.dir() === 'rtl' ? 'justifyRight' : 'justifyLeft');
    this.changed();
  }
  protected openLink(): void { this.keep(); this.linkBad.set(false); this.linkOpen.set(true); }
  protected addLink(url: string): void {
    const u = url.trim();
    if (!SAFE_LINK.test(u) || u.startsWith('//')) { this.linkBad.set(true); return; }
    this.linkOpen.set(false);
    this.restore();
    const sel = document.getSelection();
    if (sel && sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(u)}</a>`);
    else document.execCommand('createLink', false, u);
    this.changed();
  }
  protected async image(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.error.set(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await firstValueFrom(this.http.post<{ url: string }>('/api/admin/settings/email-images', fd));
      this.restore();
      this.insertBlock(`<p style="text-align:center"><img src="${esc(r.url)}" alt=""></p>`);
    } catch { this.error.set(this.i18n.t(f.size > 1024 * 1024 ? 'Editor.imageTooBig' : 'Editor.imageType')); }
  }
  /**
   * Puts a box (tip, table, picture) as its own block after the paragraph the cursor is in, with an empty paragraph
   * after it to keep typing. The browser's insertHTML would merge it into the current line.
   */
  private insertBlock(html: string): void {
    const area = this.area().nativeElement;
    let block: Node | null = this.range?.startContainer ?? null;
    while (block && block.parentNode !== area) block = block.parentNode;
    const t = document.createElement('template'); t.innerHTML = html + '<p><br></p>';
    const nodes = [...t.content.childNodes];
    if (block && block !== area) block.parentNode!.insertBefore(t.content, block.nextSibling); else area.appendChild(t.content);
    const after = nodes[nodes.length - 1];
    const r = document.createRange(); r.setStart(after, 0); r.collapse(true);
    const sel = document.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    area.focus(); this.keep(); this.changed();
  }
  /** Puts a placeholder such as {name} where the cursor was. */
  insertText(text: string): void {
    this.restore();
    document.execCommand('insertText', false, text);
    this.changed(); this.keep();
  }
}
