/**
 * One icon set for teams, ticket types, categories and sub-categories, used on every screen: a line icon in a rounded
 * tile, each thing with its own colour. Templates need fixed strings, so every tile is a constant (TILE_<THING>_<SIZE>).
 */
const TEAM = '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>';
const TYPE = '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>';
const CAT = '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>';
const SUB = '<path d="M6 4v9a3 3 0 0 0 3 3h9"/><path d="M15 13l3 3-3 3"/>';
const EYE = '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>';

const SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const LG = 'aria-hidden="true" class="grid size-11 shrink-0 place-items-center rounded-xl';
const MD = 'aria-hidden="true" class="grid size-9 shrink-0 place-items-center rounded-lg';
const SM = 'aria-hidden="true" class="grid size-6 shrink-0 place-items-center rounded-md';

const T_TEAM = 'bg-brand-soft text-brand-ink';
const T_TYPE = 'bg-[#fff4e0] text-[#b45309]';
const T_CAT = 'bg-[#f1ecfd] text-[#6d4bd1]';
const T_SUB = 'bg-ok-soft text-ok';
const T_EYE = 'bg-[#e0f2fe] text-[#0369a1]';

/** The bare team icon (22px), for tiles that set their own colours. */
export const TILE_TEAM = `<svg width="22" height="22" ${SVG_OPEN}>${TEAM}</svg>`;

export const TILE_TEAM_LG = `<span ${LG} ${T_TEAM}"><svg width="22" height="22" ${SVG_OPEN}>${TEAM}</svg></span>`;
export const TILE_TYPE_LG = `<span ${LG} ${T_TYPE}"><svg width="22" height="22" ${SVG_OPEN}>${TYPE}</svg></span>`;
export const TILE_TYPE_MD = `<span ${MD} ${T_TYPE}"><svg width="18" height="18" ${SVG_OPEN}>${TYPE}</svg></span>`;
export const TILE_TYPE_SM = `<span ${SM} ${T_TYPE}"><svg width="14" height="14" ${SVG_OPEN}>${TYPE}</svg></span>`;
export const TILE_CAT_LG = `<span ${LG} ${T_CAT}"><svg width="22" height="22" ${SVG_OPEN}>${CAT}</svg></span>`;
export const TILE_CAT_MD = `<span ${MD} ${T_CAT}"><svg width="18" height="18" ${SVG_OPEN}>${CAT}</svg></span>`;
export const TILE_CAT_SM = `<span ${SM} ${T_CAT}"><svg width="14" height="14" ${SVG_OPEN}>${CAT}</svg></span>`;
export const TILE_SUB_SM = `<span ${SM} ${T_SUB}"><svg width="14" height="14" ${SVG_OPEN}>${SUB}</svg></span>`;
export const TILE_EYE_LG = `<span ${LG} ${T_EYE}"><svg width="22" height="22" ${SVG_OPEN}>${EYE}</svg></span>`;
export const TILE_EYE_SM = `<span ${SM} ${T_EYE}"><svg width="14" height="14" ${SVG_OPEN}>${EYE}</svg></span>`;

// ---- people: one tile per kind of person (Staff and Customers lists)
const P_ADMIN = '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>';
const P_ORG = '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01M15 10h.01"/>';
const P_BRANCH = '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5"/>';
const P_LEADER = '<path d="M4 18h16"/><path d="M5 18 3.5 8l5 3.5L12 5l3.5 6.5 5-3.5L19 18"/>';
const P_AGENT = '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a3 3 0 0 1-3 2h-3"/>';
const P_VIEWER = EYE;
const P_NONE = '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/><path d="M12 13v2M12 18h.01"/>';
const P_CUSTOMER = '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>';
const P_PENDING = '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 9-7.35"/><circle cx="18" cy="18" r="4"/><path d="M18 16.5V18l1 1"/>';
const T_ADMIN = 'bg-[#e6e9f2] text-[#1e2a4a]';
const T_ORG = 'bg-[#f1ecfd] text-[#6d4bd1]';
const T_BRANCH = 'bg-brand-soft text-brand-ink';
const T_LEADER = 'bg-[#fff4e0] text-[#b45309]';
const T_AGENT = 'bg-[#e0f2fe] text-[#0369a1]';
const T_NONE = 'bg-[#eef1f5] text-[#64748b]';
const T_CUSTOMER = 'bg-ok-soft text-ok';

export const TILE_P_ADMIN_LG = `<span ${LG} ${T_ADMIN}"><svg width="22" height="22" ${SVG_OPEN}>${P_ADMIN}</svg></span>`;
export const TILE_P_ORG_LG = `<span ${LG} ${T_ORG}"><svg width="22" height="22" ${SVG_OPEN}>${P_ORG}</svg></span>`;
export const TILE_P_BRANCH_LG = `<span ${LG} ${T_BRANCH}"><svg width="22" height="22" ${SVG_OPEN}>${P_BRANCH}</svg></span>`;
export const TILE_P_LEADER_LG = `<span ${LG} ${T_LEADER}"><svg width="22" height="22" ${SVG_OPEN}>${P_LEADER}</svg></span>`;
export const TILE_P_AGENT_LG = `<span ${LG} ${T_AGENT}"><svg width="22" height="22" ${SVG_OPEN}>${P_AGENT}</svg></span>`;
export const TILE_P_VIEWER_LG = `<span ${LG} ${T_NONE}"><svg width="22" height="22" ${SVG_OPEN}>${P_VIEWER}</svg></span>`;
export const TILE_P_NONE_LG = `<span ${LG} ${T_NONE}"><svg width="22" height="22" ${SVG_OPEN}>${P_NONE}</svg></span>`;
export const TILE_P_CUSTOMER_MD = `<span ${MD} ${T_CUSTOMER}"><svg width="18" height="18" ${SVG_OPEN}>${P_CUSTOMER}</svg></span>`;
export const TILE_P_PENDING_MD = `<span ${MD} ${T_LEADER}"><svg width="18" height="18" ${SVG_OPEN}>${P_PENDING}</svg></span>`;
// small ones for the key above each list
export const TILE_P_ADMIN_SM = `<span ${SM} ${T_ADMIN}"><svg width="14" height="14" ${SVG_OPEN}>${P_ADMIN}</svg></span>`;
export const TILE_P_ORG_SM = `<span ${SM} ${T_ORG}"><svg width="14" height="14" ${SVG_OPEN}>${P_ORG}</svg></span>`;
export const TILE_P_BRANCH_SM = `<span ${SM} ${T_BRANCH}"><svg width="14" height="14" ${SVG_OPEN}>${P_BRANCH}</svg></span>`;
export const TILE_P_LEADER_SM = `<span ${SM} ${T_LEADER}"><svg width="14" height="14" ${SVG_OPEN}>${P_LEADER}</svg></span>`;
export const TILE_P_AGENT_SM = `<span ${SM} ${T_AGENT}"><svg width="14" height="14" ${SVG_OPEN}>${P_AGENT}</svg></span>`;
export const TILE_P_VIEWER_SM = `<span ${SM} ${T_NONE}"><svg width="14" height="14" ${SVG_OPEN}>${P_VIEWER}</svg></span>`;
export const TILE_P_NONE_SM = `<span ${SM} ${T_NONE}"><svg width="14" height="14" ${SVG_OPEN}>${P_NONE}</svg></span>`;
export const TILE_P_CUSTOMER_SM = `<span ${SM} ${T_CUSTOMER}"><svg width="14" height="14" ${SVG_OPEN}>${P_CUSTOMER}</svg></span>`;
export const TILE_P_PENDING_SM = `<span ${SM} ${T_LEADER}"><svg width="14" height="14" ${SVG_OPEN}>${P_PENDING}</svg></span>`;

/** The staff tiles with their key, for a template: `${STAFF_TILE_SWITCH}` uses `kind` (admin, org, branch, leader, agent, viewer, none). */
export const STAFF_TILE_SWITCH = `@switch (kind) { @case ('admin') {${TILE_P_ADMIN_LG}} @case ('org') {${TILE_P_ORG_LG}} @case ('branch') {${TILE_P_BRANCH_LG}} @case ('leader') {${TILE_P_LEADER_LG}} @case ('agent') {${TILE_P_AGENT_LG}} @case ('viewer') {${TILE_P_VIEWER_LG}} @default {${TILE_P_NONE_LG}} }`;

const KEY_ITEM = 'class="inline-flex items-center gap-2"';
/** The key above the Staff list (needs the t pipe in the component). */
export const STAFF_KEY = `<p class="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm" aria-hidden="true">`
  + `<span ${KEY_ITEM}>${TILE_P_ADMIN_SM}{{ 'Roles.admin' | t }}</span><span ${KEY_ITEM}>${TILE_P_ORG_SM}{{ 'PeopleIcons.orgAdmin' | t }}</span>`
  + `<span ${KEY_ITEM}>${TILE_P_BRANCH_SM}{{ 'PeopleIcons.branchAdmin' | t }}</span><span ${KEY_ITEM}>${TILE_P_LEADER_SM}{{ 'Roles.team_leader' | t }}</span>`
  + `<span ${KEY_ITEM}>${TILE_P_AGENT_SM}{{ 'Roles.agent' | t }}</span><span ${KEY_ITEM}>${TILE_P_VIEWER_SM}{{ 'Roles.management_viewer' | t }}</span>`
  + `<span ${KEY_ITEM}>${TILE_P_NONE_SM}{{ 'StaffSetup.needsType' | t }}</span></p>`;
/** The key above the Customers list. */
export const CUSTOMER_KEY = `<p class="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm" aria-hidden="true">`
  + `<span ${KEY_ITEM}>${TILE_P_CUSTOMER_SM}{{ 'PeopleIcons.customer' | t }}</span><span ${KEY_ITEM}>${TILE_P_PENDING_SM}{{ 'PeopleIcons.pending' | t }}</span></p>`;
