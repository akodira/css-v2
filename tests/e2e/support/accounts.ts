import { adminPassword, testPassword } from './env';

/** Test accounts (emails only). They exist in the LOCAL database copy; passwords come from .env (see passwordFor). */
export type Role = 'admin' | 'orgAdmin' | 'hcwwAdmin' | 'branchAdmin' | 'teamLeader' | 'agent' | 'viewer' | 'customer';

export const ACCOUNTS: Record<Role, { email: string; name: string; home: RegExp }> = {
  admin:       { email: 'admin.demo@demo.cts.test',            name: 'Demo Admin',              home: /\/console/ },
  orgAdmin:    { email: 'cairo.orgadmin@demo.cts.test',        name: 'Cairo Organization Admin', home: /\/console/ },
  hcwwAdmin:   { email: 'hcww.admin@demo.cts.test',            name: 'HCWW Admin',              home: /\/console/ },
  branchAdmin: { email: 'nasrcity.branchadmin@demo.cts.test',  name: 'Nasr City Branch Admin',  home: /\/console/ },
  teamLeader:  { email: 'tamer.leader@demo.cts.test',          name: 'Tamer Leader (all)',      home: /\/console/ },
  agent:       { email: 'agent.banha@demo.cts.test',           name: 'Agent Banha',             home: /\/console/ },   // same branch as the test customer
  viewer:      { email: 'laila.hassan@demo.cts.test',          name: 'Laila Hassan',            home: /\/console/ },
  customer:    { email: 'sara.banha@demo.cts.test',            name: 'Sara Banha',              home: /\/en\/?$/ },   // v2 lands customers on Home (v1 behaviour)
};

/** Admin and viewer use CCS_ADMIN_PASSWORD; the rest CCS_TEST_PASSWORD. */
export function passwordFor(role: Role): string {
  return role === 'admin' || role === 'viewer' ? adminPassword() : testPassword();
}

/** Phone number (without +2) of the customer above, for the phone sign-in test. Leave empty to skip that test. */
export const CUSTOMER_PHONE = process.env.CCS_CUSTOMER_PHONE || '';
