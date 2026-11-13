/** Test accounts (emails only). They exist in the LOCAL database copy; the password comes from CCS_TEST_PASSWORD. */
export type Role = 'admin' | 'orgAdmin' | 'branchAdmin' | 'teamLeader' | 'agent' | 'viewer' | 'customer';

export const ACCOUNTS: Record<Role, { email: string; name: string; home: RegExp }> = {
  admin:       { email: 'admin.demo@demo.cts.test',            name: 'Demo Admin',              home: /\/console/ },
  orgAdmin:    { email: 'cairo.orgadmin@demo.cts.test',        name: 'Cairo Organization Admin', home: /\/console/ },
  branchAdmin: { email: 'nasrcity.branchadmin@demo.cts.test',  name: 'Nasr City Branch Admin',  home: /\/console/ },
  teamLeader:  { email: 'tamer.leader@demo.cts.test',          name: 'Tamer Leader (all)',      home: /\/console/ },
  agent:       { email: 'agent.alex@demo.cts.test',            name: 'Agent Alex',              home: /\/console/ },
  viewer:      { email: 'laila.hassan@demo.cts.test',          name: 'Laila Hassan',            home: /\/console/ },
  customer:    { email: 'sara.banha@demo.cts.test',            name: 'Sara Banha',              home: /\/en\/?$/ },   // v2 lands customers on Home (v1 behaviour)
};

/** Phone number (without +2) of the customer above, for the phone sign-in test. Leave empty to skip that test. */
export const CUSTOMER_PHONE = process.env.CCS_CUSTOMER_PHONE || '';
