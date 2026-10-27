export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase() || '?'
}
export function relativeTime(value, now = Date.now()) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(timestamp)
}
export function safeWebsite(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '' } catch { return '' }
}
