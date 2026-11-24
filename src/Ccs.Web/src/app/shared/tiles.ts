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
