/**
 * SSRF guards for server-side fetches.
 * Centralizes scheme checks, domain allowlisting, private-IP literal blocking,
 * and manual redirect following so a redirect cannot bounce a request to an
 * internal/metadata address with credentials attached.
 */

import { URL } from 'node:url'

/**
 * Detect whether a hostname is a literal IP in a private/loopback/link-local
 * or otherwise reserved range. Does not perform DNS resolution (DNS-rebinding
 * is out of scope) — it blocks the obvious `http://169.254.169.254` style hops.
 * @param {string} host
 * @returns {boolean}
 */
export function isPrivateIpLiteral(host) {
  if (!host) return false
  // Strip IPv6 brackets
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  // IPv4
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)]
    if (a === 10) return true                       // 10.0.0.0/8
    if (a === 127) return true                      // loopback
    if (a === 0) return true                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true         // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
    return false
  }

  // IPv6 loopback / link-local / unique-local
  const lower = h.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:')) return true        // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPrivateIpLiteral(mapped[1])
  return false
}

/**
 * Validate a URL for server-side fetching.
 * @param {string} rawUrl
 * @param {string[]} allowedList - allowed hostnames
 * @returns {{ url: URL, hostname: string }}
 * @throws {Error} if scheme is not http(s), host not allowed, or host is a private IP
 */
export function validateFetchUrl(rawUrl, allowedList) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Scheme not allowed: ${url.protocol}`)
  }
  const hostname = url.hostname
  if (isPrivateIpLiteral(hostname)) {
    throw new Error(`Host resolves to a private/reserved address: ${hostname}`)
  }
  if (!allowedList.includes(hostname)) {
    throw new Error(`Domain not allowed: ${hostname}`)
  }
  return { url, hostname }
}

/**
 * Fetch with manual redirect handling. Every hop (including redirects) is
 * re-validated against the allowlist and the private-IP filter, and per-hop
 * headers are computed fresh so credentials are only attached to the host they
 * belong to.
 *
 * @param {string} rawUrl
 * @param {object} options - fetch options (without `redirect`)
 * @param {string[]} allowedList
 * @param {(hostname: string) => object} [buildHeaders] - per-hop headers (e.g. token injection)
 * @param {number} [maxRedirects]
 * @returns {Promise<Response>}
 */
export async function safeFetch(rawUrl, options, allowedList, buildHeaders, maxRedirects = 5) {
  let current = rawUrl
  for (let i = 0; i <= maxRedirects; i++) {
    const { hostname } = validateFetchUrl(current, allowedList)
    const headers = {
      ...(options.headers || {}),
      ...(buildHeaders ? buildHeaders(hostname) : {}),
    }
    const response = await fetch(current, { ...options, headers, redirect: 'manual' })

    // 3xx with a Location → re-validate the next hop instead of trusting fetch
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return response
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  throw new Error('Too many redirects')
}
