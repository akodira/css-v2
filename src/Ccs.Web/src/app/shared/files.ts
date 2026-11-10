import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, model, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Attachment, SiteService } from '../core/api';
import { TPipe } from '../core/i18n';

/** Same rules as v1 lib/uploads/rules: Settings → Uploads, with v1's defaults when nothing is saved. */
export interface UploadRules { maxMb: number; maxFiles: number; exts: string[] }
const DEFAULT_RULES: UploadRules = { maxMb: 10, maxFiles: 5, exts: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'txt'] };
export const extOf = (name: string): string => (name.includes('.') ? name.split('.').pop() ?? '' : '').toLowerCase();
export type FileProblem = { name: string; reason: 'tooMany' | 'tooLarge' | 'badType' };
export function checkFiles(files: { name: string; size: number }[], rules: UploadRules): FileProblem[] {
  const out: FileProblem[] = [];
  if (files.length > rules.maxFiles) out.push({ name: '', reason: 'tooMany' });
  for (const f of files) {
    if (f.size > rules.maxMb * 1024 * 1024) out.push({ name: f.name, reason: 'tooLarge' });
    else if (!rules.exts.includes(extOf(f.name))) out.push({ name: f.name, reason: 'badType' });
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class Uploads {
  private readonly http = inject(HttpClient);
  private readonly site = inject(SiteService);
  readonly rules = computed<UploadRules>(() => {
    const s = this.site.info()?.site;
    let exts: string[] = [];
    try { exts = JSON.parse(s?.uploadExtensions ?? '[]'); } catch { exts = []; }
    return { maxMb: s?.uploadMaxMb || DEFAULT_RULES.maxMb, maxFiles: s?.uploadMaxFiles || DEFAULT_RULES.maxFiles, exts: exts.length ? exts : DEFAULT_RULES.exts };
  });

  /** Uploads one file per request (so a failure names the file). Returns the names of files that failed. */
  async upload(ticketId: string, messageId: string | null, files: File[]): Promise<string[]> {
    const failed: string[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f, f.name);
      if (messageId) fd.append('messageId', messageId);
      try { await firstValueFrom(this.http.post(`/api/tickets/${ticketId}/attachments`, fd)); } catch { failed.push(f.name); }
    }
    return failed;
  }

  /** Downloads through the API (the sign-in token travels in a header, so a plain link cannot be used). */
  async download(ticketId: string, a: Attachment): Promise<void> {
    const blob = await firstValueFrom(this.http.get(`/api/tickets/${ticketId}/attachments/${a.id}`, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = a.fileName; el.rel = 'noopener';
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** File picker, same as v1: add several files, remove any, see the rules and problems before sending. */
@Component({
  selector: 'app-file-picker',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1.5">
      <label [for]="id" class="text-sm font-semibold">{{ label() }}</label>
      <input #inp [id]="id" type="file" multiple [disabled]="disabled()" [accept]="accept()" (change)="add(inp)"
        class="min-h-11 w-full rounded-lg border border-dashed border-line bg-surface p-2 text-sm file:me-3 file:min-h-9 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:font-semibold file:text-brand-ink" />
      <p class="text-sm text-muted">{{ 'Files.hint' | t: { max: rules().maxFiles, mb: rules().maxMb, types: types() } }}</p>
      @if (files().length) {
        <ul class="flex flex-col gap-1">
          @for (f of files(); track $index) {
            <li class="flex items-center justify-between gap-3 rounded-lg bg-bg px-3 py-2 text-sm">
              <span class="min-w-0 break-all" dir="auto">{{ f.name }} <span class="text-muted">({{ 'Files.size' | t: { kb: kb(f.size) } }})</span></span>
              <button type="button" [disabled]="disabled()" (click)="remove($index)" class="min-h-9 shrink-0 cursor-pointer rounded-md px-2 font-semibold text-danger hover:bg-danger-soft">{{ 'Files.remove' | t }}</button>
            </li>
          }
        </ul>
      }
      @if (problems().length) {
        <ul role="alert" class="text-sm font-medium text-danger">
          @for (p of problems(); track $index) {
            <li>{{ p.reason === 'tooMany' ? ('Files.tooMany' | t: { max: rules().maxFiles }) : p.reason === 'tooLarge' ? ('Files.tooLarge' | t: { name: p.name, mb: rules().maxMb }) : ('Files.badType' | t: { name: p.name }) }}</li>
          }
        </ul>
      }
    </div>`,
})
export class FilePicker {
  private readonly uploads = inject(Uploads);
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly files = model<File[]>([]);
  protected readonly id = 'fp' + Math.random().toString(36).slice(2, 8);
  protected readonly rules = this.uploads.rules;
  protected readonly accept = computed(() => this.rules().exts.map((e) => '.' + e).join(','));
  protected readonly types = computed(() => { const x = this.rules().exts; return x.filter((e) => e !== 'jpeg' || !x.includes('jpg')).map((e) => e.toUpperCase()).join(', '); });
  protected readonly problems = computed(() => checkFiles(this.files(), this.rules()));
  protected kb(n: number): number { return Math.max(1, Math.round(n / 1024)); }
  protected add(el: HTMLInputElement): void { if (el.files) this.files.set([...this.files(), ...Array.from(el.files)]); el.value = ''; }
  protected remove(i: number): void { this.files.set(this.files().filter((_, j) => j !== i)); }
}

/** Files on a ticket or a message: name, size and a download button. */
@Component({
  selector: 'app-attachments',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <ul class="mt-3 flex flex-wrap gap-2">
        @for (a of items(); track a.id) {
          <li><button type="button" (click)="get(a)" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg" [title]="'Files.download' | t">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            <span class="break-all" dir="auto">{{ a.fileName }}</span><span class="font-normal text-muted">({{ 'Files.size' | t: { kb: kb(a.sizeBytes) } }})</span>
          </button></li>
        }
      </ul>
      @if (failed()) { <p role="alert" class="mt-1 text-sm font-medium text-danger">{{ 'Directory.errors.generic' | t }}</p> }
    }`,
})
export class AttachmentList {
  private readonly uploads = inject(Uploads);
  protected readonly failed = signal(false);
  readonly ticketId = input.required<string>();
  readonly items = input<Attachment[]>([]);
  protected kb(n: number): number { return Math.max(1, Math.round(n / 1024)); }
  protected get(a: Attachment): void { this.failed.set(false); void this.uploads.download(this.ticketId(), a).catch(() => this.failed.set(true)); }
}
