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
export const MAX_IMAGE_BYTES = 1024 * 1024
export function validatePhotoFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) throw new Error('Choose a JPG, PNG, or WebP photo.')
  if (!file.size) throw new Error('This photo is empty. Choose another file.')
  if (file.size > 10 * MAX_IMAGE_BYTES) throw new Error('This photo is too large to open. Choose one under 10 MB.')
}
export function photoDimensions(width, height, maxEdge = 1600) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0) || width > 16000 || height > 16000 || width * height > 80000000) throw new Error('This photo is too large to open. Choose a smaller photo.')
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
export function postImageUrl(value, apiBase) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const base = new URL(apiBase), url = new URL(value, base.origin)
    const prefix = base.pathname.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash || !new RegExp(`^${prefix}/posts/[a-zA-Z0-9-]+/image$`).test(url.pathname)) return ''
    return url.href
  } catch { return '' }
}
