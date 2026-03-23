/**
 * Client-side HLS inspection: fetch manifests, parse, run health checks, extract SCTE-35.
 * No server required — runs entirely in the browser.
 */

import { parseMaster, parseMedia, isMasterPlaylist, parseExtXMediaFromRaw } from "./m3u8"

const FETCH_HEADERS: HeadersInit = {
  Accept: "application/vnd.apple.mpegurl,*/*",
}

export type FetchResult = {
  url: string
  error: string | null
  master: {
    is_master: true
    playlists: { uri: string; bandwidth?: number; resolution?: string; name?: string; codecs?: string; frameRate?: number }[]
    captions?: { type: string; name?: string; language?: string; uri?: string; groupId?: string }[]
    raw?: string
  } | null
  media_playlists: MediaPlaylistResult[]
  raw: string | null
  /** Captions from EXT-X-MEDIA when no master or master had none (fallback parse) */
  captions?: { type: string; name?: string; language?: string; uri?: string; groupId?: string }[]
}

export type MediaPlaylistResult = {
  uri?: string
  error?: string
  is_live?: boolean
  target_duration?: number
  media_sequence?: number
  segments: { uri: string; duration: number; discontinuity?: boolean }[]
  raw?: string
  raw_lines?: string[]
  encryption?: {
    method: string
    uri?: string
    iv?: string
    keyFormat?: string
    keyFormatVersions?: string
  }
  init_segment?: { uri: string }
  segment_format?: "ts" | "fmp4"
}

export async function fetchAndParse(url: string): Promise<FetchResult> {
  const result: FetchResult = {
    url,
    error: null,
    master: null,
    media_playlists: [],
    raw: null,
  }
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" })
    result.raw = await res.text()
    if (!res.ok) {
      result.error = `HTTP ${res.status}`
      return result
    }
    if (isMasterPlaylist(result.raw)) {
      const master = parseMaster(result.raw, url)
      if (master) {
        let captions = master.media.length > 0 ? master.media.map((m) => ({
          type: m.type,
          name: m.name,
          language: m.language,
          uri: m.uri,
          groupId: m.groupId,
        })) : undefined
        if (!captions?.length && result.raw) {
          const fallback = parseExtXMediaFromRaw(result.raw, url)
          if (fallback.length > 0) captions = fallback.map((m) => ({ type: m.type, name: m.name, language: m.language, uri: m.uri, groupId: m.groupId }))
        }
        result.master = {
          is_master: true,
          raw: result.raw ?? undefined,
          playlists: master.playlists.map((p) => ({
            uri: p.uri,
            bandwidth: p.bandwidth,
            resolution: p.resolution,
            name: p.name,
            codecs: p.codecs,
            frameRate: p.frameRate,
          })),
          captions,
        }
        for (const pl of master.playlists) {
          const mediaRes = await fetch(pl.uri, { headers: FETCH_HEADERS, redirect: "follow" })
          const mediaText = await mediaRes.text()
          if (!mediaRes.ok) {
            result.media_playlists.push({ error: `HTTP ${mediaRes.status}`, segments: [] })
            continue
          }
          const parsed = parseMedia(mediaText, pl.uri)
          result.media_playlists.push({
            uri: parsed.uri,
            is_live: parsed.isLive,
            target_duration: parsed.targetDuration,
            media_sequence: parsed.mediaSequence,
            segments: parsed.segments.map((s) => ({
              uri: s.uri,
              duration: s.duration,
              discontinuity: s.discontinuity,
            })),
            raw: parsed.raw,
            raw_lines: parsed.rawLines,
            encryption: parsed.encryption,
            init_segment: parsed.initSegment,
            segment_format: parsed.segmentFormat,
          })
        }
      }
    } else {
      const parsed = parseMedia(result.raw, url)
      result.media_playlists.push({
        uri: parsed.uri,
        is_live: parsed.isLive,
        target_duration: parsed.targetDuration,
        media_sequence: parsed.mediaSequence,
        segments: parsed.segments.map((s) => ({
          uri: s.uri,
          duration: s.duration,
          discontinuity: s.discontinuity,
        })),
        raw: parsed.raw,
        raw_lines: parsed.rawLines,
        encryption: parsed.encryption,
        init_segment: parsed.initSegment,
        segment_format: parsed.segmentFormat,
      })
      if (result.raw) {
        const fallback = parseExtXMediaFromRaw(result.raw, url)
        if (fallback.length > 0) result.captions = fallback.map((m) => ({ type: m.type, name: m.name, language: m.language, uri: m.uri, groupId: m.groupId }))
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }
  return result
}

export type CheckEvent = { kind: string; message: string; severity: string }

export function runHealthChecks(fetchResult: FetchResult): { status: string; events: CheckEvent[] } {
  const events: CheckEvent[] = []
  let status = "healthy"
  if (fetchResult.error) {
    events.push({ kind: "http_error", message: fetchResult.error, severity: "error" })
    return { status: "error", events }
  }
  for (const mp of fetchResult.media_playlists) {
    if (mp.error) {
      events.push({ kind: "media_fetch", message: mp.error, severity: "error" })
      status = "error"
      continue
    }
    if (mp.is_live && (!mp.segments || mp.segments.length === 0)) {
      events.push({ kind: "staleness", message: "No segments in live playlist", severity: "warning" })
    }
    if (mp.target_duration != null && mp.target_duration <= 0) {
      events.push({ kind: "staleness", message: "Invalid or missing target duration", severity: "warning" })
    }
    mp.segments?.forEach((seg, i) => {
      if (seg.discontinuity) {
        events.push({
          kind: "discontinuity",
          message: `Segment index ${i} has EXT-X-DISCONTINUITY`,
          severity: "warning",
        })
      }
      if (
        mp.target_duration != null &&
        mp.target_duration > 0 &&
        seg.duration > mp.target_duration * 2
      ) {
        events.push({
          kind: "segment_duration",
          message: `Segment ${i} duration ${seg.duration}s exceeds 2x target`,
          severity: "warning",
        })
      }
    })
  }
  if (fetchResult.media_playlists.length > 1) {
    const valid = fetchResult.media_playlists.filter((m) => !m.error)
    const counts = valid.map((m) => m.segments?.length ?? 0)
    const countDelta = Math.max(...counts) - Math.min(...counts)
    if (counts.length >= 2 && countDelta > 2) {
      events.push({
        kind: "cross_rendition",
        message: `Segment count mismatch: min=${Math.min(...counts)}, max=${Math.max(...counts)}`,
        severity: "warning",
      })
    }
    const seqs = valid.map((m) => m.media_sequence).filter((s): s is number => s != null)
    if (seqs.length >= 2) {
      const minS = Math.min(...seqs)
      const maxS = Math.max(...seqs)
      if (maxS - minS > 2) {
        events.push({
          kind: "cross_rendition",
          message: `Media sequence mismatch: min=${minS}, max=${maxS}`,
          severity: "warning",
        })
      }
    }
  }
  if (events.some((e) => e.severity === "error")) status = "error"
  else if (events.length > 0) status = "warning"
  return { status, events }
}

export type Scte35Entry = {
  type: string
  raw?: string
  duration_advertised?: number
  /** `#EXT-X-CUE-OUT-CONT` — ElapsedTime= (seconds into break) */
  elapsed_seconds?: number
  /** `#EXT-X-CUE-OUT-CONT` — Duration= (total break length) */
  cont_duration_seconds?: number
  advertised_seconds?: number
  actual_seconds?: number
  delta_seconds?: number
  scte35_value?: string
  /** Index in `fetchResult.media_playlists` (0 = first variant) */
  source_variant_index?: number
  /** Resolved media playlist URL this tag was read from */
  source_playlist_uri?: string
}

/** Parse `#EXT-X-CUE-OUT-CONT` attributes without mistaking unrelated `Duration=`-like tokens on the same line. */
function parseCueOutContLine(line: string): {
  elapsed_seconds?: number
  cont_duration_seconds?: number
  scte35_value?: string
} {
  const rest = line.replace(/^#EXT-X-CUE-OUT-CONT:?\s*/i, "").trim()
  const scteM = rest.match(/\bSCTE35=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/)
  let scte35_value: string | undefined
  if (scteM) {
    const raw35 = (scteM[1] ?? scteM[2] ?? scteM[3] ?? "").trim()
    scte35_value = (raw35.startsWith("0x") || raw35.startsWith("0X") ? raw35.slice(2) : raw35) || undefined
  }
  let attrPart = rest
  if (scteM) {
    attrPart = rest.replace(scteM[0], "").replace(/^[,\s]+|[,\s]+$/g, "")
  }
  let elapsed_seconds: number | undefined
  let cont_duration_seconds: number | undefined
  for (const part of attrPart.split(",").map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const val = part.slice(eq + 1).trim()
    if (key === "elapsedtime") {
      const n = parseFloat(val)
      if (!Number.isNaN(n)) elapsed_seconds = n
    } else if (key === "duration") {
      const n = parseFloat(val)
      if (!Number.isNaN(n)) cont_duration_seconds = n
    }
  }
  return { elapsed_seconds, cont_duration_seconds, scte35_value }
}

export function extractScte35(fetchResult: FetchResult): Scte35Entry[] {
  const out: Scte35Entry[] = []
  for (let mpIdx = 0; mpIdx < fetchResult.media_playlists.length; mpIdx++) {
    const mp = fetchResult.media_playlists[mpIdx]
    if (mp.error) continue
    const src: Pick<Scte35Entry, "source_variant_index" | "source_playlist_uri"> = {
      source_variant_index: mpIdx,
      ...(mp.uri ? { source_playlist_uri: mp.uri } : {}),
    }
    const rawLines = mp.raw_lines ?? (mp.raw ?? "").split("\n")
    const segments = mp.segments ?? []
    let advertisedDuration: number | undefined
    let cueOutIndex: number | undefined
    for (let idx = 0; idx < rawLines.length; idx++) {
      const line = rawLines[idx].trim()
      if (line.startsWith("#EXT-X-CUE-OUT") && !line.includes("#EXT-X-CUE-OUT-CONT")) {
        cueOutIndex = idx
        const m = line.match(/DURATION=([\d.]+)/i)
        advertisedDuration = m ? parseFloat(m[1]) : undefined
      }
      if (line.startsWith("#EXT-X-CUE-IN") && cueOutIndex != null) {
        let segmentCount = 0
        for (let i = cueOutIndex; i <= idx; i++) {
          if (rawLines[i].startsWith("#EXTINF:")) segmentCount++
        }
        const segsInRange = segments.slice(0, segmentCount)
        const actual = segsInRange.reduce((sum, s) => sum + (s.duration ?? 0), 0)
        if (advertisedDuration != null) {
          out.push({
            type: "AD_DURATION",
            advertised_seconds: advertisedDuration,
            actual_seconds: Math.round(actual * 100) / 100,
            delta_seconds: Math.round((actual - advertisedDuration) * 100) / 100,
            ...src,
          })
        }
        cueOutIndex = undefined
        advertisedDuration = undefined
      }
      if (line.startsWith("#EXT-X-CUE-OUT") && !line.includes("CONT")) {
        const m = line.match(/DURATION=([\d.]+)/i)
        const scteM = line.match(/SCTE35=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/)
        const raw35 = (scteM?.[1] ?? scteM?.[2] ?? scteM?.[3] ?? "").trim()
        const scte35_value = (raw35.startsWith("0x") || raw35.startsWith("0X") ? raw35.slice(2) : raw35) || undefined
        out.push({
          type: "CUE-OUT",
          duration_advertised: m ? parseFloat(m[1]) : undefined,
          raw: line,
          ...(scte35_value ? { scte35_value } : {}),
          ...src,
        })
      }
      if (line.startsWith("#EXT-X-CUE-OUT-CONT")) {
        const { elapsed_seconds, cont_duration_seconds, scte35_value } = parseCueOutContLine(line)
        out.push({
          type: "CUE-OUT-CONT",
          raw: line,
          ...(elapsed_seconds != null ? { elapsed_seconds } : {}),
          ...(cont_duration_seconds != null ? { cont_duration_seconds } : {}),
          ...(scte35_value ? { scte35_value } : {}),
          ...src,
        })
      }
      if (line.startsWith("#EXT-X-CUE-IN")) {
        out.push({ type: "CUE-IN", raw: line, ...src })
      }
      if (line.startsWith("#EXT-X-DATERANGE")) {
        // Match any SCTE35-* attribute (SCTE35-OUT, SCTE35-IN, SCTE35-CMD, etc.)
        // Value may be quoted or unquoted hex/base64
        const scteM = line.match(/SCTE35-[A-Za-z]+=(?:"([^"]*)"|'([^']*)'|(0x[0-9a-fA-F]+)|([A-Za-z0-9+/=]+))/)
        let scte35_value: string | undefined
        if (scteM) {
          const raw35 = (scteM[1] ?? scteM[2] ?? scteM[3] ?? scteM[4] ?? "").trim()
          // Strip 0x prefix — parser expects plain hex or base64
          scte35_value = (raw35.startsWith("0x") || raw35.startsWith("0X") ? raw35.slice(2) : raw35) || undefined
        }
        out.push({ type: "DATERANGE", raw: line, ...(scte35_value ? { scte35_value } : {}), ...src })
      }
      if (line.startsWith("#EXT-OATCLS-SCTE35:")) {
        const raw35 = line.slice("#EXT-OATCLS-SCTE35:".length).trim()
        const scte35_value = (raw35.startsWith("0x") || raw35.startsWith("0X") ? raw35.slice(2) : raw35) || undefined
        out.push({ type: "OATCLS-SCTE35", raw: line, ...(scte35_value ? { scte35_value } : {}), ...src })
      }
    }
  }
  return out
}
