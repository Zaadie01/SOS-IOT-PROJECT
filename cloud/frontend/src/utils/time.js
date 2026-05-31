/** Formats a Unix-millisecond timestamp as "HH:MM:SS, DD/MM/YYYY". Returns "—" for falsy values. */
export function formatTime(ms) {
    if (!ms) return '—';
    const date = new Date(ms);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const day  = date.toLocaleDateString([],  { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${time}, ${day}`;
}
