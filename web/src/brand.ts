// Kovan brand mark: a rounded hex cell holding an abstract top-down bee (body + two wing lobes).
export function mark(size = 32, id = 'km'): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-label="Kovan">
  <defs>
    <linearGradient id="${id}g" x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#FFD37A"/><stop offset=".55" stop-color="#FFB224"/><stop offset="1" stop-color="#E5850B"/></linearGradient>
    <radialGradient id="${id}r" cx="32" cy="30" r="26" gradientUnits="userSpaceOnUse"><stop stop-color="#FFB224" stop-opacity=".28"/><stop offset="1" stop-color="#FFB224" stop-opacity="0"/></radialGradient>
  </defs>
  <path class="mk-cell" d="M28 4.6a8 8 0 0 1 8 0l18.2 10.5a8 8 0 0 1 4 6.9v20a8 8 0 0 1-4 6.9L36 59.4a8 8 0 0 1-8 0L9.8 48.9a8 8 0 0 1-4-6.9V22a8 8 0 0 1 4-6.9z" fill="url(#${id}r)" stroke="url(#${id}g)" stroke-width="3.2"/>
  <g class="mk-wings" fill="#FFD37A" fill-opacity=".16" stroke="url(#${id}g)" stroke-width="2.2" stroke-linejoin="round">
    <path d="M29.5 27.5C24 22 17.5 15.5 13.5 18.5s1.5 11.5 15.5 13z"/><path d="M34.5 27.5C40 22 46.5 15.5 50.5 18.5s-1.5 11.5-15.5 13z"/>
  </g>
  <circle cx="32" cy="20.5" r="4.6" fill="url(#${id}g)"/>
  <rect class="mk-body" x="26.5" y="25.5" width="11" height="24" rx="5.5" fill="url(#${id}g)"/>
  <path d="M27 33h10M27 39.5h10" stroke="#1A120A" stroke-width="2.3" stroke-linecap="round"/>
  <path d="M32 49.5v3.2" stroke="url(#${id}g)" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;
}

/** Wordmark: "kovan" with a hex standing in for the o. */
export function wordmark(): string {
  return `<span class="wordmark" aria-label="kovan">k<svg viewBox="0 0 20 22" class="wm-o" aria-hidden="true"><path d="M8.6 1.5a2.8 2.8 0 0 1 2.8 0l6 3.5a2.8 2.8 0 0 1 1.4 2.4v7.2a2.8 2.8 0 0 1-1.4 2.4l-6 3.5a2.8 2.8 0 0 1-2.8 0l-6-3.5a2.8 2.8 0 0 1-1.4-2.4V7.4A2.8 2.8 0 0 1 2.6 5z" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>van</span>`;
}
