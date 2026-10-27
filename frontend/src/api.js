const base = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/$/, '')
let token = sessionStorage.getItem('pulse.token') || ''
export function setToken(value) {
  token = value || ''
  if (token) sessionStorage.setItem('pulse.token', token)
  else sessionStorage.removeItem('pulse.token')
}
export const hasToken = () => Boolean(token)
export async function api(path, options = {}) {
  let response
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new Error('Could not reach Pulse. Check your connection and try again.')
  }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && token) {
      setToken('')
      window.dispatchEvent(new Event('pulse:session-expired'))
    }
    throw new Error(data.error || `Request failed (${response.status}). Please try again.`)
  }
  return data
}
