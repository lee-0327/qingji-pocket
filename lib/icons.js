// Interface icons adapted from Lucide (ISC). See THIRD-PARTY-NOTICES.txt.
import{categorySticker}from'./stickers.js';
const paths={
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'mic':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
 'arrow-right':'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 'chevron-right':'<path d="m9 6 6 6-6 6"/>',
 'scan':'<path d="M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M7 9h10M7 12h10M7 15h6"/>',
 'file':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
 'shield':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
 'plus-square':'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
 'list':'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
 'chart':'<path d="M3 3v18h18M8 16v-5M13 16V7M18 16v-8"/>',
 'settings':'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9.5 3-1 2-2 .7-2.2-.1L2 9l1.2 2v2L2 15l2.3 3.4 2.2-.1 2 .7 1 2h5l1-2 2-.7 2.2.1L22 15l-1.2-2v-2L22 9l-2.3-3.4-2.2.1-2-.7-1-2Z"/>',
 'search':'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
 'download':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
 'wifi-off':'<path d="m2 2 20 20M8.5 16.4a5 5 0 0 1 7 0M2 8.8a16 16 0 0 1 3.8-2.1M7.9 5.9A16 16 0 0 1 22 8.8M5 12.5a10 10 0 0 1 3-1.9M11 10a10 10 0 0 1 8 2.5M12 20h.01"/>',
 'spark':'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
 'x':'<path d="m6 6 12 12M6 18 18 6"/>',
 'meal':'<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-4 0-6 5-6 10h6"/>',
 'transport':'<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21l2-3M16 21l-2-3M8 15h.01M16 15h.01"/>',
 'shopping':'<path d="M5 7h14l2 14H3L5 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
 'home':'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-8h6v8"/>',
 'health':'<path d="M19 4h-4V2H9v2H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2Z"/><path d="M12 9v7M8.5 12.5h7"/>',
 'fun':'<path d="M6 12h4M8 10v4M15 11h.01M18 13h.01M6 5h12a3 3 0 0 1 3 3l1 9a2 2 0 0 1-3 2l-4-3H9l-4 3a2 2 0 0 1-3-2l1-9a3 3 0 0 1 3-3Z"/>',
 'other':'<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
 'wallet':'<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6M16 12h5v5h-5v-5Z"/>'
};
export function icon(name){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.other}</svg>`;}
export function renderIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
export function categoryIcon(category){return categorySticker(category);}
