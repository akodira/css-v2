import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { problemOf } from './auth';
import { I18n } from './i18n';

// ---- Contracts (mirror AdminController, camelCase JSON) -----------------------------------------

export interface OrgLite { id: string; name: string; isActive: boolean }
export interface BranchLite { id: string; organizationId: string; name: string; isActive: boolean }
export interface TeamLite { id: string; nameEn: string; nameAr: string; isActive: boolean }
export interface TypeLite { id: string; nameEn: string; nameAr: string; isBuiltin: boolean; scopeLevel: string | null }
export interface PersonLite { id: string; fullName: string; email: string }
export interface Lookups {
  orgs: OrgLite[]; branches: BranchLite[]; teams: TeamLite[]; types: TypeLite[]; leaders: PersonLite[];
  permissions: string[]; roles: string[]; me: string;
}

export interface AdminUser {
  id: string; fullName: string; email: string; phone: string | null; status: string; role: string | null;
  accountTypeId: string | null; organizationId: string | null; branchId: string | null; autoAssign: boolean;
  canCreateForCustomers: boolean; createdAt: string; teamIds: string[]; tickets: number; openTickets: number; isSelf: boolean;
}
export interface UserBody {
  fullName: string; email: string; phone: string; password: string; role: string; accountTypeId: string | null;
  organizationId: string | null; branchId: string | null; status?: string; autoAssign: boolean; canCreateForCustomers: boolean;
}

export interface AccessRow { organizationId: string; branchId: string | null }
export interface AccountTypeRow {
  id: string; nameEn: string; nameAr: string; allAccess: boolean; isBuiltin: boolean; scopeLevel: string | null;
  permissions: string[]; access: AccessRow[]; staff: number;
}
export interface TypeBody { nameEn: string; nameAr: string; allAccess: boolean; scopeLevel: string | null; permissions: string[]; access: AccessRow[] }

export interface BranchRow { id: string; name: string; location: string | null; phone: string | null; teamLeaderId: string | null; isActive: boolean; customers: number }
export interface OrgRow extends Omit<BranchRow, 'customers'> { sharedAccessEnabled: boolean; customers: number; branches: BranchRow[] }

export interface TeamMemberRow { userId: string; fullName: string; email: string; isLeader: boolean }
export interface TeamRow { id: string; nameEn: string; nameAr: string; isActive: boolean; members: TeamMemberRow[] }
export interface TeamsResult { teams: TeamRow[]; candidates: (PersonLite & { role: string })[] }

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/';

  get<T>(path: string): Promise<T> { return firstValueFrom(this.http.get<T>(this.base + path)); }
  post<T = unknown>(path: string, body: unknown): Promise<T> { return firstValueFrom(this.http.post<T>(this.base + path, body)); }
  put(path: string, body: unknown): Promise<unknown> { return firstValueFrom(this.http.put(this.base + path, body)); }
  del(path: string): Promise<unknown> { return firstValueFrom(this.http.delete(this.base + path)); }

  lookups(): Promise<Lookups> { return this.get<Lookups>('lookups'); }
}

/** Turns an API problem into a sentence: the code is looked up in the admin message groups. */
export function adminError(i18n: I18n, e: unknown): string {
  const code = problemOf(e).code;
  for (const ns of ['AdminCommon.errors.', 'Directory.errors.', 'AdminUsers.errors.', 'AdminTeams.errors.', 'Auth.errors.']) {
    if (i18n.has(ns + code)) return i18n.t(ns + code);
  }
  return i18n.t('Directory.errors.generic');
}

/** A strong random password that meets the default policy (upper, lower, number, special, 14 characters). */
export function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*?-'];
  const all = sets.join('');
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
