import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const GENERIC_SEGMENTS = new Set([
  "master", "index", "playlist", "stream", "live", "hls",
  "video", "audio", "media", "manifest", "output", "encode",
])

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns a human-readable display name for a stream.
 * Uses label if set; otherwise derives a friendly name from the URL.
 */
export function streamDisplayName(url: string, label?: string | null): string {
  if (label?.trim()) return label.trim()
  try {
    const u = new URL(url)
    const segments = u.pathname.split("/").filter(Boolean)

    // Walk path segments from the end, skip generic names and file extensions
    for (let i = segments.length - 1; i >= 0; i--) {
      const raw = segments[i].replace(/\.m3u8$/i, "").trim()
      if (!raw) continue
      const friendly = raw.replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim()
      if (!GENERIC_SEGMENTS.has(friendly.toLowerCase()) && friendly.length > 1) {
        return toTitleCase(friendly)
      }
    }

    // Fall back to hostname (strip www.)
    return u.hostname.replace(/^www\./i, "")
  } catch {
    return url.slice(0, 50)
  }
}
