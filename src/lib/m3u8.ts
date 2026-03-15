/**
 * Minimal M3U8 parser for browser (no backend). Parses master and media playlists from text.
 */

function resolveUri(uri: string, base: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri
  const baseUrl = base.replace(/\/[^/]*$/, "/")
  if (uri.startsWith("/")) {
    try {
      const u = new URL(base)
      return u.origin + uri
    } catch {
      return baseUrl.replace(/\/$/, "") + uri
    }
  }
  return baseUrl + uri
}

function getBaseUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname || "/"
    const dir = path.includes("/") ? path.replace(/\/[^/]*$/, "/") : "/"
    return u.origin + dir
  } catch {
    return url.replace(/\/[^/]*$/, "/")
  }
}

export type MasterPlaylistVariant = {
  uri: string
  bandwidth?: number
  resolution?: string
  name?: string
  codecs?: string
  frameRate?: number
}

export type MasterPlaylistMedia = {
  type: string
  name?: string
  language?: string
  uri?: string
  groupId?: string
}

export type MasterPlaylist = {
  isMaster: true
  playlists: MasterPlaylistVariant[]
  media: MasterPlaylistMedia[]
  raw: string
}

export type MediaSegment = {
  uri: string
  duration: number
  discontinuity: boolean
  programDateTime?: string
}

export type MediaPlaylist = {
  uri?: string
  isLive: boolean
  targetDuration: number
  mediaSequence?: number
  segments: MediaSegment[]
  raw: string
  rawLines: string[]
  /** EXT-X-KEY: encryption method and key URI */
  encryption?: { method: string; uri?: string }
  /** EXT-X-MAP: init segment (fMP4) */
  initSegment?: { uri: string }
  /** Inferred from segment URIs or EXT-X-MAP: ts | fmp4 */
  segmentFormat?: "ts" | "fmp4"
}

export function parseMaster(text: string, baseUrl: string): MasterPlaylist | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines[0] !== "#EXTM3U") return null
  const playlists: MasterPlaylist["playlists"] = []
  const media: MasterPlaylist["media"] = []
  let currentBandwidth: number | undefined
  let currentResolution: string | undefined
  let currentCodecs: string | undefined
  let currentFrameRate: number | undefined
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const typeMatch = line.match(/TYPE=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/i)
      const type = typeMatch ? (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? "").trim().toUpperCase() : ""
      // Include SUBTITLES, CLOSED-CAPTIONS, and any type (some manifests use alternate names)
      const nameMatch = line.match(/NAME="([^"]*)"|NAME=([^,\s]+)/i)
      const langMatch = line.match(/LANGUAGE="([^"]*)"|LANGUAGE=([^,\s]+)/i)
      // URI can be quoted or unquoted (e.g. URI="url" or URI=https://...)
      const uriMatch = line.match(/URI="([^"]+)"|URI=([^,\s]+)/i)
      const groupMatch = line.match(/GROUP-ID="([^"]*)"|GROUP-ID=([^,\s]+)/i)
      const uriValue = uriMatch ? (uriMatch[1] ?? uriMatch[2] ?? "").trim() : undefined
      media.push({
        type: type || "MEDIA",
        name: nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? "").trim() || undefined : undefined,
        language: langMatch ? (langMatch[1] ?? langMatch[2] ?? "").trim() || undefined : undefined,
        uri: uriValue ? resolveUri(uriValue, baseUrl) : undefined,
        groupId: groupMatch ? (groupMatch[1] ?? groupMatch[2] ?? "").trim() || undefined : undefined,
      })
      continue
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const bw = line.match(/BANDWIDTH=(\d+)/i)
      const res = line.match(/RESOLUTION=([^\s,]+)/i)
      const codecs = line.match(/CODECS="([^"]+)"/i)
      const fr = line.match(/FRAME-RATE=([\d.]+)/i)
      currentBandwidth = bw ? parseInt(bw[1], 10) : undefined
      currentResolution = res ? res[1] : undefined
      currentCodecs = codecs ? codecs[1] : undefined
      currentFrameRate = fr ? parseFloat(fr[1]) : undefined
      continue
    }
    if (currentBandwidth !== undefined && !line.startsWith("#")) {
      playlists.push({
        uri: resolveUri(line, baseUrl),
        bandwidth: currentBandwidth,
        resolution: currentResolution,
        name: line,
        codecs: currentCodecs,
        frameRate: currentFrameRate,
      })
      currentBandwidth = undefined
      currentResolution = undefined
      currentCodecs = undefined
      currentFrameRate = undefined
    }
  }
  // Sort by bandwidth descending (largest first)
  playlists.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
  return { isMaster: true, playlists, media, raw: text }
}

export function parseMedia(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const rawLines = [...lines]
  const segments: MediaSegment[] = []
  let targetDuration = 0
  let mediaSequence: number | undefined
  let isLive = true
  let currentDuration = 0
  let currentDiscontinuity = false
  let currentProgramDateTime: string | undefined
  let encryption: MediaPlaylist["encryption"]
  let initSegment: MediaPlaylist["initSegment"]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === "#EXTM3U") continue
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const m = line.match(/#EXT-X-TARGETDURATION:(\d+)/i)
      if (m) targetDuration = parseInt(m[1], 10)
      continue
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const m = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/i)
      if (m) mediaSequence = parseInt(m[1], 10)
      continue
    }
    if (line === "#EXT-X-ENDLIST") {
      isLive = false
      continue
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const methodMatch = line.match(/METHOD=([^,\s]+)/i)
      const uriMatch = line.match(/URI="([^"]+)"|URI=([^,\s]+)/i)
      encryption = {
        method: methodMatch ? methodMatch[1] : "NONE",
        uri: uriMatch ? (uriMatch[1] ?? uriMatch[2] ?? "").trim() : undefined,
      }
      if (encryption.uri) encryption.uri = resolveUri(encryption.uri, baseUrl)
      continue
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const uriMatch = line.match(/URI="([^"]+)"|URI=([^,\s]+)/i)
      const uri = uriMatch ? (uriMatch[1] ?? uriMatch[2] ?? "").trim() : undefined
      if (uri) initSegment = { uri: resolveUri(uri, baseUrl) }
      continue
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      currentDiscontinuity = true
      continue
    }
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      currentProgramDateTime = line.replace(/^#EXT-X-PROGRAM-DATE-TIME:/i, "").trim()
      continue
    }
    if (line.startsWith("#EXTINF:")) {
      const m = line.match(/#EXTINF:([\d.]+)/i)
      currentDuration = m ? parseFloat(m[1]) : 0
      const next = lines[i + 1]
      if (next && !next.startsWith("#")) {
        segments.push({
          uri: resolveUri(next, baseUrl),
          duration: currentDuration,
          discontinuity: currentDiscontinuity,
          programDateTime: currentProgramDateTime,
        })
        currentDiscontinuity = false
        currentProgramDateTime = undefined
      }
      continue
    }
  }

  let segmentFormat: MediaPlaylist["segmentFormat"]
  if (initSegment) segmentFormat = "fmp4"
  else if (segments.length > 0) {
    const u = segments[0].uri.toLowerCase()
    if (u.includes(".m4s") || u.includes(".mp4")) segmentFormat = "fmp4"
    else if (u.includes(".ts")) segmentFormat = "ts"
  }

  return {
    uri: baseUrl,
    isLive,
    targetDuration,
    mediaSequence,
    segments,
    raw: text,
    rawLines,
    encryption,
    initSegment,
    segmentFormat,
  }
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF:") && !text.includes("#EXT-X-TARGETDURATION:")
}

/** Strip optional surrounding single or double quotes */
function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1)
  return t
}

/** Extract EXT-X-MEDIA lines from any manifest text (lenient, for captions fallback). */
export function parseExtXMediaFromRaw(rawText: string, baseUrl: string): MasterPlaylistMedia[] {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim())
  const out: MasterPlaylistMedia[] = []
  for (const line of lines) {
    if (!line.startsWith("#EXT-X-MEDIA")) continue
    const typeMatch = line.match(/TYPE=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/i)
    const type = typeMatch ? unquote(typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? "").toUpperCase() : ""
    const nameMatch = line.match(/NAME=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/i)
    const name = nameMatch ? unquote(nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? "") || undefined : undefined
    const langMatch = line.match(/LANGUAGE=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/i)
    const language = langMatch ? unquote(langMatch[1] ?? langMatch[2] ?? langMatch[3] ?? "") || undefined : undefined
    const uriMatch = line.match(/URI=(?:"([^"]+)"|'([^']+)'|([^,\s]+))/i)
    const uriVal = uriMatch ? unquote(uriMatch[1] ?? uriMatch[2] ?? uriMatch[3] ?? "") : undefined
    const groupMatch = line.match(/GROUP-ID=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/i)
    const groupId = groupMatch ? unquote(groupMatch[1] ?? groupMatch[2] ?? groupMatch[3] ?? "") || undefined : undefined
    out.push({
      type: type || "MEDIA",
      name: name || undefined,
      language: language || undefined,
      uri: uriVal ? resolveUri(uriVal, baseUrl) : undefined,
      groupId: groupId || undefined,
    })
  }
  return out
}

export { getBaseUrl, resolveUri }
