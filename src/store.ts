/**
 * Client-only store: streams in localStorage, events in memory.
 * No server — inspect runs in the browser via fetch + parse + checks.
 */

import { fetchAndParse, runHealthChecks, extractScte35 } from "@/lib/inspect"

const STREAMS_KEY = "hls-inspector-streams"
const MAX_EVENTS = 200

export type StreamState = {
  status: "healthy" | "warning" | "error" | "none"
  last_check?: string
  error?: string
}

export type Stream = {
  id: string
  url: string
  label: string | null
  created_at: string
  state: StreamState | null
}

export type EventItem = {
  stream_id: string
  stream_label: string | null
  kind: string
  message: string
  severity: string
  at: string
}

export type InspectResult = {
  stream_id: string
  url: string
  label: string | null
  at: string
  status: string
  last_check?: string
  error?: string | null
  master?: {
    is_master: boolean
    raw?: string
    playlists?: { uri: string; name?: string; bandwidth?: number; resolution?: string; codecs?: string; frameRate?: number }[]
    captions?: { type: string; name?: string; language?: string; uri?: string; groupId?: string }[]
  } | null
  media_playlists?: {
    uri?: string
    error?: string
    is_live?: boolean
    target_duration?: number
    media_sequence?: number
    segments?: { uri: string; duration: number; discontinuity?: boolean }[]
    raw?: string
    encryption?: { method: string; uri?: string }
    init_segment?: { uri: string }
    segment_format?: "ts" | "fmp4"
  }[]
  checks?: { status: string; events: { kind: string; message: string; severity: string }[] }
  scte35?: { type: string; raw?: string; duration_advertised?: number; advertised_seconds?: number; actual_seconds?: number; delta_seconds?: number }[]
  /** Captions from fallback parse when master had none or URL was media playlist */
  captions?: { type: string; name?: string; language?: string; uri?: string; groupId?: string }[]
}

export type StreamDetail = Stream & { result: InspectResult | null }

function genId(): string {
  return crypto.randomUUID?.() ?? "id-" + Date.now() + "-" + Math.random().toString(36).slice(2)
}

export function loadStreams(): Stream[] {
  try {
    const raw = localStorage.getItem(STREAMS_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function saveStreams(streams: Stream[]): void {
  try {
    localStorage.setItem(STREAMS_KEY, JSON.stringify(streams))
  } catch (err) {
    // LocalStorage can fail (e.g. privacy mode/quota). Not critical for playback/inspection.
    void err
  }
}

export function addStream(streams: Stream[], url: string, label: string | null): Stream[] {
  const next: Stream = {
    id: genId(),
    url: url.trim(),
    label: label?.trim() || null,
    created_at: new Date().toISOString(),
    state: null,
  }
  const list = [...streams, next]
  saveStreams(list)
  return list
}

export function removeStream(streams: Stream[], id: string): Stream[] {
  const list = streams.filter((s) => s.id !== id)
  saveStreams(list)
  return list
}

export function onInspectEvents(
  streamId: string,
  streamLabel: string | null,
  events: { kind: string; message: string; severity: string }[],
  pushEvent: (e: EventItem) => void
): void {
  const at = new Date().toISOString()
  for (const ev of events) {
    pushEvent({
      stream_id: streamId,
      stream_label: streamLabel,
      kind: ev.kind,
      message: ev.message,
      severity: ev.severity,
      at,
    })
  }
}

export async function runInspect(
  streamId: string,
  url: string,
  label: string | null,
  pushEvent: (e: EventItem) => void
): Promise<InspectResult> {
  const at = new Date().toISOString()
  const result: InspectResult = {
    stream_id: streamId,
    url,
    label,
    at,
    status: "healthy",
    last_check: at,
    error: null,
    master: null,
    media_playlists: [],
    checks: undefined,
    scte35: [],
  }
  try {
    const fetchResult = await fetchAndParse(url)
    result.error = fetchResult.error ?? null
    result.master = fetchResult.master
    result.captions = fetchResult.captions ?? undefined
    result.media_playlists = fetchResult.media_playlists.map((mp) => ({
      uri: mp.uri,
      error: mp.error,
      is_live: mp.is_live,
      target_duration: mp.target_duration,
      media_sequence: mp.media_sequence,
      segments: mp.segments,
      raw: mp.raw,
      encryption: mp.encryption,
      init_segment: mp.init_segment,
      segment_format: mp.segment_format,
    }))

    if (fetchResult.error) {
      result.status = "error"
      pushEvent({
        stream_id: streamId,
        stream_label: label,
        kind: "http_error",
        message: fetchResult.error,
        severity: "error",
        at,
      })
      return result
    }

    const checks = runHealthChecks(fetchResult)
    result.checks = checks
    onInspectEvents(streamId, label, checks.events, pushEvent)
    if (checks.status === "error") result.status = "error"
    else if (checks.status === "warning" || checks.events.length > 0) result.status = "warning"

    result.scte35 = extractScte35(fetchResult)
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    result.status = "error"
    pushEvent({
      stream_id: streamId,
      stream_label: label,
      kind: "error",
      message: result.error ?? "Unknown error",
      severity: "error",
      at,
    })
  }
  return result
}

export function streamStateFromResult(result: InspectResult): StreamState {
  return {
    status: result.status as StreamState["status"],
    last_check: result.last_check ?? undefined,
    error: result.error ?? undefined,
  }
}

export function trimEvents(events: EventItem[], max: number = MAX_EVENTS): EventItem[] {
  if (events.length <= max) return events
  return events.slice(-max)
}
