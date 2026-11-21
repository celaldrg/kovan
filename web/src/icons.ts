// Lucide icons (ISC licence) rendered to inline SVG strings.
import {
  Hexagon, Network, CalendarDays, KanbanSquare, SunMoon, Focus, ArrowUp, Sparkles, Users, Cpu, Gauge, Check, RotateCcw, X,
  Play, Pause, Trash2, Clock, Repeat, Activity, BookOpen, Plug, CircleCheck, Hand, Zap, Search, ChevronLeft, ChevronRight, Bot,
  Layers, Send, MessageSquare, Wand2,
  Telescope, Megaphone, PenTool, CodeXml, LifeBuoy, Landmark, Building2, Crown, ArrowUpRight, ChevronDown, Inbox, LocateFixed, Loader, Timer, Coins, ShieldCheck,
  Folder, Bell,
} from 'lucide';

type IconNode = [string, Record<string, string | number>][];
const ICONS = { Hexagon, Network, CalendarDays, KanbanSquare, SunMoon, Focus, ArrowUp, Sparkles, Users, Cpu, Gauge, Check, RotateCcw, X, Play, Pause, Trash2, Clock, Repeat, Activity, BookOpen, Plug, CircleCheck, Hand, Zap, Search, ChevronLeft, ChevronRight, Bot, Layers, Send, MessageSquare, Wand2, Telescope, Megaphone, PenTool, CodeXml, LifeBuoy, Landmark, Building2, Crown, ArrowUpRight, ChevronDown, Inbox, LocateFixed, Loader, Timer, Coins, ShieldCheck, Folder, Bell } as unknown as Record<string, IconNode>;
export type IconName = keyof typeof ICONS;

export function icon(name: string, size = 16, stroke = 1.75): string {
  const node = ICONS[name];
  if (!node) return '';
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
