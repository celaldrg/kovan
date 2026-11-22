// Re-export the shared renderer so the UI and the node tests use one implementation.
import { esc as escapeHtml, md as renderMd } from '../../shared/md.js';

export function esc(s: string): string { return escapeHtml(s); }
export function md(src: string): string { return renderMd(src); }
