import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Same small SVG charts as the current dashboard (components/charts.tsx). Each has a text alternative. */

export const CHART_COLORS = ['#1f64e6', '#16915a', '#d9822b', '#7c5cd6', '#0e9fb5', '#c2415d', '#8a97ad'];
const grid = (max: number) => { const step = Math.max(1, Math.ceil(Math.max(4, max) / 4)); return { step, top: step * 4 }; };

@Component({
  selector: 'app-trend-chart',
  template: `
    <figure class="m-0">
      <div class="mb-2 flex flex-wrap gap-4 text-sm" aria-hidden="true">
        <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-brand"></span>{{ createdLabel() }}</span>
        <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-ok"></span>{{ resolvedLabel() }}</span>
      </div>
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="summary()" class="h-auto w-full" style="direction: ltr">
        @for (k of [0, 1, 2, 3, 4]; track k) {
          <line [attr.x1]="L" [attr.x2]="W - R" [attr.y1]="y(k * g().step)" [attr.y2]="y(k * g().step)" stroke="#e2e8f3" />
          <text [attr.x]="L - 6" [attr.y]="y(k * g().step) + 4" text-anchor="end" font-size="11" fill="#52607a">{{ k * g().step }}</text>
        }
        @if (data().length) {
          <path [attr.d]="area()" fill="#1f64e6" opacity="0.08" />
          <path [attr.d]="line('created')" fill="none" stroke="#1f64e6" stroke-width="2.5" stroke-linejoin="round" />
          <path [attr.d]="line('resolved')" fill="none" stroke="#16915a" stroke-width="2.5" stroke-linejoin="round" />
          @for (d of data(); track d.day; let i = $index) {
            <circle [attr.cx]="x(i)" [attr.cy]="y(d.created)" r="2.5" fill="#1f64e6" />
            <circle [attr.cx]="x(i)" [attr.cy]="y(d.resolved)" r="2.5" fill="#16915a" />
          }
          @for (i of ticks(); track i; let k = $index; let last = $last; let first = $first) {
            <text [attr.x]="x(i)" [attr.y]="H - 8" [attr.text-anchor]="last && ticks().length > 1 ? 'end' : first && ticks().length > 1 ? 'start' : 'middle'" font-size="11" fill="#52607a">{{ short(data()[i].day) }}</text>
          }
        }
      </svg>
      <div class="sr-only"><table><caption>{{ summary() }}</caption>
        <thead><tr><th scope="col">{{ dayLabel() }}</th><th scope="col">{{ createdLabel() }}</th><th scope="col">{{ resolvedLabel() }}</th></tr></thead>
        <tbody>@for (d of data(); track d.day) { <tr><th scope="row">{{ d.day }}</th><td>{{ d.created }}</td><td>{{ d.resolved }}</td></tr> }</tbody></table></div>
    </figure>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrendChart {
  readonly data = input.required<{ day: string; created: number; resolved: number }[]>();
  readonly createdLabel = input('');
  readonly resolvedLabel = input('');
  readonly summary = input('');
  readonly dayLabel = input('Day');
  protected readonly W = 640; protected readonly H = 240; protected readonly L = 36; protected readonly R = 12; private readonly T = 12; private readonly B = 28;
  protected readonly g = computed(() => grid(Math.max(0, ...this.data().flatMap((d) => [d.created, d.resolved]))));
  protected readonly ticks = computed(() => { const n = this.data().length; return n <= 6 ? [...Array(n).keys()] : [0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4)); });
  protected x(i: number): number { const n = this.data().length; return this.L + (n <= 1 ? 0 : (i * (this.W - this.L - this.R)) / (n - 1)); }
  protected y(v: number): number { return this.T + (this.H - this.T - this.B) * (1 - v / this.g().top); }
  protected line(k: 'created' | 'resolved'): string { return this.data().map((d, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)} ${this.y(d[k]).toFixed(1)}`).join(' '); }
  protected area(): string { const n = this.data().length; return `${this.line('created')} L${this.x(n - 1).toFixed(1)} ${this.y(0)} L${this.x(0).toFixed(1)} ${this.y(0)} Z`; }
  protected short(s: string): string { return s.slice(5).replace('-', '/'); }
}

@Component({
  selector: 'app-ring',
  template: `
    <svg viewBox="0 0 140 140" role="img" [attr.aria-label]="label()" class="mx-auto" [class]="size()" style="direction: ltr">
      <circle cx="70" cy="70" r="52" fill="none" stroke="#e2e8f3" stroke-width="14" />
      @if (percent() !== null) {
        <circle cx="70" cy="70" r="52" fill="none" [attr.stroke]="color()" stroke-width="14" stroke-linecap="round" [attr.stroke-dasharray]="dash()" transform="rotate(-90 70 70)" />
      }
      <text x="70" y="78" text-anchor="middle" font-size="28" font-weight="700" fill="#0f1b2d">{{ percent() === null ? '-' : percent() + '%' }}</text>
    </svg>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ring {
  readonly percent = input<number | null>(null);
  readonly label = input('');
  readonly color = input('#16915a');
  readonly size = input('h-40 w-40');
  protected readonly dash = computed(() => { const c = 2 * Math.PI * 52; return `${((this.percent() ?? 0) / 100) * c} ${c}`; });
}

@Component({
  selector: 'app-bar-list',
  template: `
    <ul class="flex flex-col gap-3">
      @for (r of rows(); track r.label) {
        <li>
          <div class="flex items-baseline justify-between gap-3 text-sm"><span dir="auto">{{ r.label }}</span><span class="font-bold">{{ r.value }}</span></div>
          <div class="mt-1 h-2.5 overflow-hidden rounded-full bg-bg" aria-hidden="true"><div class="h-full rounded-full bg-brand" [style.width.%]="pct(r.value)"></div></div>
        </li>
      }
    </ul>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarList {
  readonly rows = input.required<{ label: string; value: number }[]>();
  protected pct(v: number): number { const top = Math.max(1, ...this.rows().map((r) => r.value)); return Math.min(100, (v / top) * 100); }
}

@Component({
  selector: 'app-donut',
  template: `
    <figure class="m-0 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
      <svg viewBox="0 0 140 140" role="img" [attr.aria-label]="label()" class="h-36 w-36 shrink-0" style="direction: ltr">
        <circle cx="70" cy="70" r="52" fill="none" stroke="#e2e8f3" stroke-width="18" />
        @for (a of arcs(); track $index) {
          <circle cx="70" cy="70" r="52" fill="none" [attr.stroke]="a.color" stroke-width="18" [attr.stroke-dasharray]="a.dash" [attr.stroke-dashoffset]="a.off" transform="rotate(-90 70 70)" />
        }
        <text x="70" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="#0f1b2d">{{ centre() }}</text>
      </svg>
      <ul class="flex min-w-[14rem] flex-1 flex-col gap-2 text-sm">
        @for (x of slices(); track $index; let i = $index) {
          <li class="flex items-start gap-2">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="colors[i % colors.length]" aria-hidden="true"></span>
            <span class="min-w-0 flex-1 break-words" dir="auto">{{ x.label }}</span>
            <span class="font-bold">{{ x.value }}</span>
            <span class="w-10 text-end text-muted">{{ sum() ? round((x.value / sum()) * 100) : 0 }}%</span>
          </li>
        }
      </ul>
    </figure>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Donut {
  readonly slices = input.required<{ label: string; value: number }[]>();
  readonly label = input('');
  readonly centre = input('');
  protected readonly colors = CHART_COLORS;
  protected readonly round = Math.round;
  protected readonly sum = computed(() => this.slices().reduce((a, x) => a + x.value, 0));
  protected readonly arcs = computed(() => {
    const c = 2 * Math.PI * 52, sum = this.sum(); let acc = 0;
    if (!sum) return [];
    return this.slices().map((x, i) => { const len = (x.value / sum) * c; const off = -acc; acc += len; return { color: CHART_COLORS[i % CHART_COLORS.length], dash: `${len} ${c - len}`, off }; });
  });
}

@Component({
  selector: 'app-grouped-columns',
  template: `
    <figure class="m-0">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()" class="h-auto w-full" style="direction: ltr">
        @for (k of [0, 1, 2, 3, 4]; track k) {
          <line [attr.x1]="L" [attr.x2]="W - R" [attr.y1]="y(k * g().step)" [attr.y2]="y(k * g().step)" stroke="#e2e8f3" />
          <text [attr.x]="L - 6" [attr.y]="y(k * g().step) + 4" text-anchor="end" font-size="11" fill="#52607a">{{ k * g().step }}</text>
        }
        @for (r of rows(); track $index; let i = $index) {
          <rect [attr.x]="cx(i) - bw() - 1" [attr.y]="y(r.total)" [attr.width]="bw()" [attr.height]="y(0) - y(r.total)" rx="3" fill="#1f64e6"><title>{{ r.label }}: {{ totalLabel() }} {{ r.total }}</title></rect>
          <rect [attr.x]="cx(i) + 1" [attr.y]="y(r.resolved)" [attr.width]="bw()" [attr.height]="y(0) - y(r.resolved)" rx="3" fill="#16915a"><title>{{ r.label }}: {{ resolvedLabel() }} {{ r.resolved }}</title></rect>
          <text [attr.x]="cx(i) - bw() / 2 - 1" [attr.y]="y(r.total) - 4" text-anchor="middle" font-size="11" font-weight="700" fill="#0f1b2d">{{ r.total }}</text>
          <text [attr.x]="cx(i) + bw() / 2 + 1" [attr.y]="y(r.resolved) - 4" text-anchor="middle" font-size="11" font-weight="700" fill="#0b6b40">{{ r.resolved }}</text>
          <text [attr.x]="cx(i)" [attr.y]="H - 38" text-anchor="middle" font-size="12" fill="#344054">
            @for (l of lines(r.label); track $index; let k = $index) { <tspan [attr.x]="cx(i)" [attr.dy]="k === 0 ? 0 : 14">{{ l }}</tspan> }
          </text>
        }
      </svg>
      <figcaption class="mt-1 flex flex-wrap gap-4 text-sm">
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="h-2.5 w-2.5 rounded-sm" style="background: #1f64e6"></span>{{ totalLabel() }}</span>
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="h-2.5 w-2.5 rounded-sm" style="background: #16915a"></span>{{ resolvedLabel() }}</span>
      </figcaption>
      <div class="sr-only"><table><caption>{{ label() }}</caption>
        <thead><tr><th scope="col">{{ label() }}</th><th scope="col">{{ totalLabel() }}</th><th scope="col">{{ resolvedLabel() }}</th></tr></thead>
        <tbody>@for (r of rows(); track $index) { <tr><th scope="row">{{ r.label }}</th><td>{{ r.total }}</td><td>{{ r.resolved }}</td></tr> }</tbody></table></div>
    </figure>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupedColumns {
  readonly rows = input.required<{ label: string; total: number; resolved: number }[]>();
  readonly label = input('');
  readonly totalLabel = input('');
  readonly resolvedLabel = input('');
  protected readonly W = 560; protected readonly H = 260; protected readonly L = 30; protected readonly R = 8; private readonly T = 14; private readonly B = 62;
  protected readonly g = computed(() => grid(Math.max(0, ...this.rows().map((r) => r.total))));
  private readonly slot = computed(() => (this.rows().length ? (this.W - this.L - this.R) / this.rows().length : 0));
  protected readonly bw = computed(() => Math.max(6, Math.min(26, this.slot() * 0.34)));
  protected cx(i: number): number { return this.L + this.slot() * i + this.slot() / 2; }
  protected y(v: number): number { return this.T + (this.H - this.T - this.B) * (1 - v / this.g().top); }
  protected lines(s: string): string[] {
    const out: string[] = []; let cur = '';
    for (const w of s.split(/\s+/)) { if (cur && (cur + ' ' + w).length > 13) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
    if (cur) out.push(cur);
    const two = out.slice(0, 2).map((l) => (l.length > 14 ? `${l.slice(0, 13)}…` : l));
    if (out.length > 2) two[1] = `${two[1].replace(/…$/, '')}…`;
    return two;
  }
}

@Component({
  selector: 'app-stacked-bars',
  template: `
    <figure class="m-0">
      <ul [attr.aria-label]="label()" class="flex flex-col gap-3">
        @for (r of rows(); track $index) {
          <li>
            <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span class="min-w-0 break-words font-semibold" dir="auto">{{ r.label }}@if (r.sub) {<span class="font-normal text-muted"> · {{ r.sub }}</span>}</span>
              <span class="shrink-0 text-muted">{{ r.resolved }}/{{ r.total }} · <b class="text-ink">{{ rate(r) }}%</b></span>
            </div>
            <div class="flex h-3 overflow-hidden rounded-full bg-line" style="direction: ltr" [style.width.%]="width(r.total)" role="img" [attr.aria-label]="r.label + ': ' + resolvedLabel() + ' ' + r.resolved + ', ' + openLabel() + ' ' + (r.total - r.resolved)">
              <span [style.width.%]="r.total ? (r.resolved / r.total) * 100 : 0" style="background: #16915a"></span>
              <span [style.width.%]="r.total ? ((r.total - r.resolved) / r.total) * 100 : 0" style="background: #9db8ec"></span>
            </div>
          </li>
        }
      </ul>
      <figcaption class="mt-3 flex flex-wrap gap-4 text-sm">
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="h-2.5 w-2.5 rounded-sm" style="background: #16915a"></span>{{ resolvedLabel() }}</span>
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="h-2.5 w-2.5 rounded-sm" style="background: #9db8ec"></span>{{ openLabel() }}</span>
      </figcaption>
    </figure>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StackedBars {
  readonly rows = input.required<{ label: string; sub?: string; total: number; resolved: number }[]>();
  readonly label = input('');
  readonly resolvedLabel = input('');
  readonly openLabel = input('');
  protected rate(r: { total: number; resolved: number }): number { return r.total ? Math.round((r.resolved / r.total) * 100) : 0; }
  protected width(total: number): number { const max = Math.max(1, ...this.rows().map((r) => r.total)); return Math.max(6, (total / max) * 100); }
}
