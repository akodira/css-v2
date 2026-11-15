import { effect } from '@angular/core';

/**
 * Search as you type: runs <code>run</code> shortly after any of the watched filter values changes
 * (each letter typed, a list choice), so pages need no Search / Apply button.
 * The first read (page load) is skipped: the page loads its own data. Call it in a constructor or field initialiser.
 */
export function liveSearch(watch: () => unknown, run: () => void, delayMs = 250): void {
  let first = true;
  effect((onCleanup) => {
    watch();
    if (first) { first = false; return; }
    const t = setTimeout(run, delayMs);
    onCleanup(() => clearTimeout(t));
  });
}
