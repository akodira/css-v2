import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The built-in pictures for the sign-in pages (Settings → Branding → Home and sign-in look):
 * a = support desk, b = brand icons, c = Cairo skyline, d = calm pattern. Drawn for AZKA in the brand blues; no rights issues.
 * Fills its box (object-fit: cover behaviour through preserveAspectRatio slice).
 */
@Component({
  selector: 'app-auth-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 block', 'aria-hidden': 'true' },
  template: `
    @switch (kind()) {
      @case ('b') {
        <svg class="h-full w-full" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="art-gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dfe9fc"/><stop offset=".6" stop-color="#5f8fe6"/><stop offset="1" stop-color="#0b1f4d"/></linearGradient></defs>
          <rect width="400" height="500" fill="url(#art-gb)"/>
          <circle cx="200" cy="250" r="170" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
          <circle cx="200" cy="250" r="110" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
          <circle cx="200" cy="150" r="48" fill="#fff" fill-opacity=".9"/><path d="M178 160v-10a22 22 0 0 1 44 0v10" fill="none" stroke="#1d63e0" stroke-width="6"/><rect x="172" y="152" width="12" height="18" rx="6" fill="#1d63e0"/><rect x="216" y="152" width="12" height="18" rx="6" fill="#1d63e0"/>
          <circle cx="300" cy="270" r="44" fill="#fff" fill-opacity=".9"/><rect x="278" y="256" width="44" height="28" rx="5" fill="none" stroke="#1d63e0" stroke-width="5"/><path d="M288 266h24M288 274h16" stroke="#1d63e0" stroke-width="4" stroke-linecap="round"/>
          <circle cx="110" cy="290" r="44" fill="#fff" fill-opacity=".9"/><path d="M92 290l13 13 24-26" fill="none" stroke="#1c7a45" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="210" cy="350" r="30" fill="#fff" fill-opacity=".85"/><path d="M196 342h28v16h-18l-10 8z" fill="none" stroke="#1d63e0" stroke-width="4" stroke-linejoin="round"/>
        </svg>
      }
      @case ('c') {
        <svg class="h-full w-full" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="art-gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f0fd"/><stop offset=".55" stop-color="#8fb2ef"/><stop offset="1" stop-color="#1d4fb8"/></linearGradient></defs>
          <rect width="400" height="500" fill="url(#art-gc)"/>
          <circle cx="300" cy="120" r="46" fill="#fff" opacity=".55"/>
          <g fill="#3f6fcf" opacity=".55"><rect x="20" y="300" width="34" height="100"/><rect x="60" y="270" width="28" height="130"/><rect x="96" y="310" width="40" height="90"/><rect x="250" y="290" width="36" height="110"/><rect x="292" y="260" width="30" height="140"/><rect x="330" y="300" width="50" height="100"/></g>
          <g fill="#1d4fb8"><path d="M190 400V230h6l3-40h2l3 40h6v170z"/><ellipse cx="200" cy="232" rx="16" ry="6"/><rect x="194" y="160" width="12" height="32" rx="3"/><rect x="198" y="140" width="4" height="22"/></g>
          <g fill="#1d4fb8" opacity=".8"><rect x="140" y="320" width="36" height="80"/><rect x="224" y="330" width="22" height="70"/><path d="M0 400h400v10H0z"/></g>
          <path d="M0 410c60-10 120 10 200 0s140-10 200 0v90H0z" fill="#0b1f4d" opacity=".75"/>
          <path d="M30 430h70M140 444h90M260 432h80" stroke="#9dbdf2" stroke-width="3" stroke-linecap="round" opacity=".7"/>
        </svg>
      }
      @case ('d') {
        <svg class="h-full w-full" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="art-gd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eaf1fd"/><stop offset="1" stop-color="#1d4fb8"/></linearGradient></defs>
          <rect width="400" height="500" fill="url(#art-gd)"/>
          <path d="M0 300c80-40 160 40 240 0s120-60 160-30v230H0z" fill="#fff" opacity=".18"/>
          <path d="M0 360c90-50 170 30 250-10s110-40 150-20v170H0z" fill="#fff" opacity=".18"/>
          <path d="M0 420c70-30 150 20 230-10s120-30 170-10v100H0z" fill="#0b1f4d" opacity=".35"/>
          <g fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"><circle cx="320" cy="110" r="60"/><circle cx="320" cy="110" r="90"/><circle cx="320" cy="110" r="120"/></g>
        </svg>
      }
      @default {
        <svg class="h-full w-full" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="art-ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7effd"/><stop offset=".55" stop-color="#9dbdf2"/><stop offset="1" stop-color="#1d4fb8"/></linearGradient></defs>
          <rect width="400" height="500" fill="url(#art-ga)"/>
          <circle cx="200" cy="250" r="150" fill="#fff" opacity=".25"/>
          <rect x="40" y="350" width="320" height="14" rx="7" fill="#0b1f4d" opacity=".85"/>
          <rect x="190" y="268" width="130" height="84" rx="8" fill="#1d63e0"/><rect x="198" y="276" width="114" height="68" rx="4" fill="#e7effd"/><rect x="208" y="288" width="60" height="7" rx="3.5" fill="#1d63e0"/><rect x="208" y="302" width="88" height="5" rx="2.5" fill="#9dbdf2"/><rect x="208" y="314" width="74" height="5" rx="2.5" fill="#9dbdf2"/>
          <path d="M176 352h168l-10 -6H186z" fill="#0b1f4d"/>
          <path d="M70 350c0-60 30-92 70-92s70 32 70 92z" fill="#0b1f4d"/>
          <path d="M118 262l22 30 22-30" fill="#fff"/>
          <circle cx="140" cy="214" r="38" fill="#f2c9a6"/>
          <path d="M102 208c0-26 18-42 40-42s38 16 38 40c-8-10-22-16-40-16-16 0-30 8-38 18z" fill="#2b1d16"/>
          <path d="M100 214a40 40 0 0 1 80 0" fill="none" stroke="#0b1f4d" stroke-width="6"/><rect x="94" y="206" width="12" height="22" rx="6" fill="#0b1f4d"/><rect x="174" y="206" width="12" height="22" rx="6" fill="#0b1f4d"/>
          <path d="M180 226c0 14-10 22-24 22" fill="none" stroke="#0b1f4d" stroke-width="4"/><circle cx="154" cy="248" r="5" fill="#0b1f4d"/>
          <path d="M126 228q14 10 28 0" fill="none" stroke="#7a4b32" stroke-width="3" stroke-linecap="round"/>
          <path d="M162 300l40 24" stroke="#0b1f4d" stroke-width="16" stroke-linecap="round"/>
          <rect x="246" y="150" width="108" height="56" rx="14" fill="#fff"/><path d="M262 206l-6 16 22-16z" fill="#fff"/><rect x="262" y="166" width="60" height="7" rx="3.5" fill="#1d63e0"/><rect x="262" y="182" width="78" height="6" rx="3" fill="#9dbdf2"/>
          <circle cx="300" cy="104" r="26" fill="#1d63e0"/><path d="M289 104l8 8 15-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="76" cy="130" r="22" fill="#fff"/><path d="M66 124h20M66 132h14" stroke="#1d63e0" stroke-width="4" stroke-linecap="round"/>
        </svg>
      }
    }`,
})
export class AuthArt {
  readonly kind = input<string>('a');
}
