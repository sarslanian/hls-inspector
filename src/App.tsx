import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select } from "@/components/ui/select"
import { HlsPlayer } from "@/components/HlsPlayer"
import {
  loadStreams as loadStreamsFromStorage,
  addStream as addStreamToStore,
  removeStream as removeStreamFromStore,
  runInspect,
  streamStateFromResult,
  trimEvents,
  type Stream,
  type StreamDetail,
  type EventItem,
  type InspectResult,
} from "./store"
import { Radio, AlertCircle, List, ArrowLeft, Download, Menu, X } from "lucide-react"

type View = "streams" | "issues" | "inspect"

const POLL_INTERVAL_MS = 10_000

/** Map CODECS string to short friendly labels (e.g. avc1 → H.264, mp4a → AAC). */
function codecLabels(codecs: string): { video?: string; audio?: string; raw: string } {
  const raw = codecs
  const parts = codecs.split(/,\s*/)
  let video: string | undefined
  let audio: string | undefined
  for (const p of parts) {
    const c = p.trim().toLowerCase()
    if (c.startsWith("avc1") || c.startsWith("avc2") || c.startsWith("avc3")) video = "H.264"
    else if (c.startsWith("hvc1") || c.startsWith("hev1")) video = "H.265/HEVC"
    else if (c.startsWith("vp09") || c.startsWith("vp9")) video = "VP9"
    else if (c.startsWith("av01")) video = "AV1"
    else if (c.startsWith("mp4a")) audio = "AAC"
    else if (c.startsWith("ac-3") || c.startsWith("ec-3")) audio = "Dolby Digital"
    else if (c.startsWith("opus")) audio = "Opus"
  }
  return { video, audio, raw }
}

function App() {
  const [view, setView] = useState<View>("streams")
  const [streams, setStreams] = useState<Stream[]>(() => loadStreamsFromStorage())
  const [events, setEvents] = useState<EventItem[]>([])
  const [lastResultByStreamId, setLastResultByStreamId] = useState<Record<string, InspectResult>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StreamDetail | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [addUrl, setAddUrl] = useState("")
  const [addLabel, setAddLabel] = useState("")
  const [addError, setAddError] = useState<string | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [selectedSegmentVariantIndex, setSelectedSegmentVariantIndex] = useState(0)
  const [selectedPlaylistVariantIndex, setSelectedPlaylistVariantIndex] = useState(0)
  const [selectedSegmentUrl, setSelectedSegmentUrl] = useState<string | null>(null)
  const [selectedSegmentDuration, setSelectedSegmentDuration] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mediaCount = detail?.result?.media_playlists?.length ?? 0
  const segmentVariantIndex = Math.min(selectedSegmentVariantIndex, Math.max(0, mediaCount - 1))
  const playlistVariantIndex = Math.min(selectedPlaylistVariantIndex, Math.max(0, mediaCount - 1))

  const pushEvent = useCallback((e: EventItem) => {
    setEvents((prev) => trimEvents([...prev, e]))
  }, [])

  const loadDetail = useCallback((id: string) => {
    const stream = streams.find((s) => s.id === id)
    if (!stream) return
    setSelectedId(id)
    setSelectedSegmentVariantIndex(0)
    setSelectedPlaylistVariantIndex(0)
    setSelectedSegmentUrl(null)
    setSelectedSegmentDuration(null)
    setView("inspect")
    const result = lastResultByStreamId[id]
    setDetail({ ...stream, result: result ?? null })
    if (result?.master?.playlists?.length) {
      setPlayUrl(result.master.playlists[0].uri)
    } else {
      setPlayUrl(stream.url)
    }
  }, [streams, lastResultByStreamId])

  const streamsRef = useRef(streams)
  streamsRef.current = streams
  const streamIds = streams.map((s) => s.id).sort().join(",")
  useEffect(() => {
    if (streams.length === 0) return
    const runPoll = async () => {
      const list = streamsRef.current
      for (const stream of list) {
        try {
          const result = await runInspect(stream.id, stream.url, stream.label, pushEvent)
          setLastResultByStreamId((prev) => ({ ...prev, [stream.id]: result }))
          setStreams((prev) =>
            prev.map((s) =>
              s.id === stream.id ? { ...s, state: streamStateFromResult(result) } : s
            )
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setLastResultByStreamId((prev) => ({
            ...prev,
            [stream.id]: {
              stream_id: stream.id,
              url: stream.url,
              label: stream.label,
              at: new Date().toISOString(),
              status: "error",
              error: msg,
              media_playlists: [],
            },
          }))
          setStreams((prev) =>
            prev.map((s) =>
              s.id === stream.id ? { ...s, state: { status: "error" as const, error: msg } } : s
            )
          )
        }
      }
    }
    runPoll()
    const t = setInterval(runPoll, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [streamIds, pushEvent])

  const validateHlsUrl = (url: string): string | null => {
    const trimmed = url.trim()
    if (!trimmed) return "URL is required."
    try {
      const u = new URL(trimmed)
      if (u.protocol !== "http:" && u.protocol !== "https:") return "URL must be HTTP or HTTPS."
      const path = u.pathname.toLowerCase()
      if (!path.includes(".m3u8") && !path.includes("m3u8")) return "URL should point to an HLS playlist (e.g. .m3u8)."
      return null
    } catch {
      return "Enter a valid URL."
    }
  }

  const handleAddStream = (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    const url = addUrl.trim()
    const label = addLabel.trim() || null
    const err = validateHlsUrl(addUrl)
    if (err) {
      setAddError(err)
      return
    }
    if (!url) return
    setStreams((prev) => addStreamToStore(prev, url, label))
    setAddUrl("")
    setAddLabel("")
  }

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm("Remove this stream?")) return
    setStreams((prev) => removeStreamFromStore(prev, id))
    setLastResultByStreamId((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (selectedId === id) {
      setSelectedId(null)
      setDetail(null)
      setPlayUrl(null)
      setView("streams")
    }
  }

  const handleInspect = async () => {
    if (!selectedId || !detail) return
    setInspectLoading(true)
    try {
      const result = await runInspect(detail.id, detail.url, detail.label, pushEvent)
      setLastResultByStreamId((prev) => ({ ...prev, [detail.id]: result }))
      setDetail((d) => (d ? { ...d, result, state: streamStateFromResult(result) } : null))
      setStreams((prev) =>
        prev.map((s) =>
          s.id === detail.id ? { ...s, state: streamStateFromResult(result) } : s
        )
      )
      if (result.master?.playlists?.length && !playUrl) {
        setPlayUrl(result.master.playlists[0].uri)
      }
    } finally {
      setInspectLoading(false)
    }
  }

  const variants = detail?.result?.master?.playlists ?? []

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Mobile menu backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        className={`fixed inset-0 z-30 bg-black/50 md:hidden transition-opacity ${sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={closeSidebar}
      />

      {/* Sidebar — drawer on mobile, always visible on md+ */}
      <aside
        className={`fixed md:relative inset-y-0 left-0 z-40 w-64 border-r border-border bg-card flex flex-col shrink-0 transition-transform duration-200 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="p-4 min-h-[4.5rem] flex flex-col justify-center border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Radio className="h-5 w-5 text-primary shrink-0" />
              <span className="font-semibold truncate">HLS Inspector</span>
            </div>
            <Button variant="ghost" size="icon" className="md:hidden h-10 w-10 shrink-0 touch-manipulation" aria-label="Close menu" onClick={closeSidebar}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Runs in your browser — no server</p>
        </div>
        <nav className="p-2 flex flex-col gap-1">
          <Button
            variant={view === "streams" ? "secondary" : "ghost"}
            className="justify-start min-h-[44px] touch-manipulation"
            onClick={() => { setView("streams"); closeSidebar() }}
          >
            <List className="h-4 w-4 mr-2 shrink-0" />
            Streams
          </Button>
          <Button
            variant={view === "issues" ? "secondary" : "ghost"}
            className="justify-start min-h-[44px] touch-manipulation"
            onClick={() => { setView("issues"); closeSidebar() }}
          >
            <AlertCircle className="h-4 w-4 mr-2 shrink-0" />
            Recent issues
          </Button>
        </nav>
      </aside>

      {/* Main — add stream is only here at top of right section */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {/* Mobile header with menu button */}
        <div className="md:hidden shrink-0 flex items-center gap-3 p-3 border-b border-border bg-card/80">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 touch-manipulation"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-semibold truncate">HLS Inspector</span>
        </div>
        {view === "streams" && (
          <>
            <div className="p-4 border-b border-border bg-card/50">
              <form onSubmit={handleAddStream} className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
                <div className="flex-1 min-w-0 w-full sm:min-w-[220px] space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Master or media playlist URL</Label>
                  <Input
                    type="url"
                    placeholder="https://..."
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    required
                    className="w-full text-base sm:text-sm"
                  />
                </div>
                <div className="w-full sm:min-w-[200px] sm:w-72 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Label (optional)</Label>
                  <Input
                    type="text"
                    placeholder="e.g. Channel A"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    className="text-base sm:text-sm"
                  />
                </div>
                <Button type="submit" className="min-h-[44px] touch-manipulation w-full sm:w-auto">Add stream</Button>
                {addError && <p className="text-sm text-destructive w-full">{addError}</p>}
              </form>
            </div>
            <div className="p-4 border-b border-border">
              <h1 className="text-lg font-semibold">Streams</h1>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {streams.length === 0 ? (
                  <p className="col-span-full text-muted-foreground text-sm">No streams yet. Add a URL above. Streams are saved in this browser.</p>
                ) : (
                  streams.map((s) => (
                    <Card
                      key={s.id}
                      className="cursor-pointer hover:border-primary/50 active:scale-[0.99] transition-colors touch-manipulation min-h-[44px]"
                      onClick={() => loadDetail(s.id)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              s.state?.status === "healthy"
                                ? "bg-green-500"
                                : s.state?.status === "warning"
                                ? "bg-yellow-500"
                                : s.state?.status === "error"
                                ? "bg-destructive"
                                : "bg-muted-foreground"
                            }`}
                          />
                          <CardTitle className="text-sm font-medium truncate">
                            {s.label || s.url.replace(/^https?:\/\//, "").slice(0, 40)}
                          </CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-xs text-muted-foreground truncate" title={s.url}>
                          {s.url}
                        </p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                          <span className="text-xs text-muted-foreground">
                            {s.state?.last_check ? new Date(s.state.last_check).toLocaleTimeString() : "—"}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-[44px] touch-manipulation text-xs text-muted-foreground hover:text-destructive"
                            onClick={(e) => handleRemove(e, s.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {view === "issues" && (
          <>
            <div className="p-4 border-b border-border">
              <h1 className="text-lg font-semibold">Recent issues</h1>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-2">
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent issues.</p>
                ) : (
                  events.slice().reverse().map((e, i) => (
                    <Card key={`${e.stream_id}-${e.at}-${e.kind}-${i}`} className={e.severity === "error" ? "border-l-4 border-l-destructive" : "border-l-4 border-l-yellow-500"}>
                      <CardContent className="py-3">
                        <p className="text-xs text-muted-foreground">
                          {e.stream_label || e.stream_id} · {e.kind} · {new Date(e.at).toLocaleString()}
                        </p>
                        <p className="text-sm mt-1">{e.message}</p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {view === "inspect" && detail && (
          <>
            <div className="p-3 sm:p-4 min-h-[4.5rem] flex flex-wrap items-center gap-2 sm:gap-4 border-b border-border">
              <Button variant="outline" size="sm" className="min-h-[44px] touch-manipulation shrink-0" onClick={() => { setView("streams"); setSelectedId(null); setDetail(null); setPlayUrl(null); setSelectedSegmentUrl(null); setSelectedSegmentDuration(null) }}>
                <ArrowLeft className="h-4 w-4 mr-1 shrink-0" />
                Back
              </Button>
              <h1 className="text-base sm:text-lg font-semibold truncate flex-1 min-w-0">
                {detail.label || detail.url.replace(/^https?:\/\//, "").slice(0, 50)}
              </h1>
              <Button onClick={handleInspect} disabled={inspectLoading} className="min-h-[44px] touch-manipulation shrink-0">
                {inspectLoading ? "Running…" : "Inspect now"}
              </Button>
            </div>
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
              {/* Left: video + variant — full width on mobile, 65% on lg+ */}
              <div className="w-full lg:w-[65%] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-border bg-muted/20 p-4 gap-3">
                <div className="rounded-lg overflow-hidden bg-black w-full aspect-video max-h-[45vh] sm:max-h-[55vh] lg:max-h-[70vh] min-h-[200px] lg:min-h-[240px] flex items-center justify-center shrink-0">
                  <HlsPlayer src={playUrl} segmentSrc={selectedSegmentUrl} segmentDuration={selectedSegmentDuration} autoPlay className="w-full h-full object-contain" />
                </div>
                {selectedSegmentUrl && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSelectedSegmentUrl(null); setSelectedSegmentDuration(null) }}
                    >
                      Back to full HLS
                    </Button>
                    <p className="text-xs text-muted-foreground">Playing single segment. Click a segment in the table to play another.</p>
                  </div>
                )}
                {variants.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-sm shrink-0">Variant</Label>
                    <Select
                      value={playUrl ?? ""}
                      onChange={(e) => { setPlayUrl(e.target.value || null); setSelectedSegmentUrl(null); setSelectedSegmentDuration(null) }}
                      className="w-full"
                    >
                      {variants.map((v) => (
                        <option key={v.uri} value={v.uri}>
                          {[v.resolution, v.bandwidth ? (v.bandwidth / 1e6).toFixed(1) + " Mbps" : ""].filter(Boolean).join(" · ") || v.uri}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
              {/* Right: tabs + long content */}
              <Tabs defaultValue="overview" className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                <div className="px-2 sm:px-4 py-2 shrink-0 border-b border-border overflow-x-auto -mx-2 sm:mx-0">
                  <TabsList className="h-9 inline-flex w-max min-w-full sm:min-w-0 flex-nowrap">
                    <TabsTrigger value="overview" className="touch-manipulation shrink-0">Overview</TabsTrigger>
                    <TabsTrigger value="segments" className="touch-manipulation shrink-0">Segments</TabsTrigger>
                    <TabsTrigger value="captions" className="touch-manipulation shrink-0">Captions</TabsTrigger>
                    <TabsTrigger value="scte35" className="touch-manipulation shrink-0">SCTE-35</TabsTrigger>
                    <TabsTrigger value="playlist" className="touch-manipulation shrink-0">Playlist</TabsTrigger>
                  </TabsList>
                </div>
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4">
                  <TabsContent value="overview" className="mt-0 overflow-auto min-h-0">
                    <div className="space-y-4">
                      {!detail.result ? (
                        <Card className="border-dashed">
                          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                            <p className="text-muted-foreground text-sm mb-4">No inspection data yet. Run an inspection to see stream health, variants, and segments.</p>
                            <Button onClick={handleInspect} disabled={inspectLoading}>
                              {inspectLoading ? "Running…" : "Run inspection"}
                            </Button>
                          </CardContent>
                        </Card>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-3">
                            <div
                              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${
                                detail.state?.status === "healthy"
                                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                  : detail.state?.status === "warning"
                                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                  : detail.state?.status === "error"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <span className={`h-2 w-2 rounded-full shrink-0 ${
                                detail.state?.status === "healthy" ? "bg-green-500" :
                                detail.state?.status === "warning" ? "bg-amber-500" :
                                detail.state?.status === "error" ? "bg-destructive" : "bg-muted-foreground"
                              }`} />
                              {detail.state?.status ?? "Unknown"}
                            </div>
                            {detail.state?.last_check && (
                              <span className="text-xs text-muted-foreground">
                                Last check: {new Date(detail.state.last_check).toLocaleString()}
                              </span>
                            )}
                          </div>

                          {detail.result.master?.playlists?.length != null && detail.result.media_playlists?.length != null && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Stream at a glance</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-2 text-sm">
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                                  <div>
                                    <span className="text-muted-foreground">Variants</span>
                                    <p className="font-medium">{detail.result.master.playlists.length}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Segments</span>
                                    <p className="font-medium">
                                      {detail.result.media_playlists[0]?.segments?.length ?? "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Type</span>
                                    <p className="font-medium">
                                      {detail.result.media_playlists[0]?.is_live === false ? "VOD" : "Live"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Format</span>
                                    <p className="font-medium">
                                      {detail.result.media_playlists[0]?.segment_format === "fmp4" ? "fMP4" : detail.result.media_playlists[0]?.segment_format === "ts" ? "MPEG-TS" : "—"}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {detail.state?.error && (
                            <Card className="border-destructive/50">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-destructive">Error</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <pre className="p-3 rounded-md bg-muted text-xs overflow-auto">{detail.state.error}</pre>
                              </CardContent>
                            </Card>
                          )}

                          {detail.result.checks && (detail.result.checks.events?.length ?? 0) > 0 && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Health checks</CardTitle>
                                <p className="text-xs text-muted-foreground font-normal">{detail.result.checks.events.length} event(s)</p>
                              </CardHeader>
                              <CardContent>
                                <ul className="space-y-2">
                                  {detail.result.checks.events.map((ev, i) => (
                                    <li
                                      key={i}
                                      className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                                        ev.severity === "error" ? "bg-destructive/10 border-l-2 border-destructive" : "bg-amber-500/10 border-l-2 border-amber-500"
                                      }`}
                                    >
                                      <span className="font-medium shrink-0">{ev.kind}</span>
                                      <span className="text-muted-foreground">{ev.message}</span>
                                    </li>
                                  ))}
                                </ul>
                              </CardContent>
                            </Card>
                          )}

                          {detail.result.checks?.events?.length === 0 && !detail.state?.error && (
                            <p className="text-sm text-muted-foreground">No issues reported. Stream looks good.</p>
                          )}

                          {(detail.result.scte35?.length ?? 0) > 0 && (
                            <Card>
                              <CardContent className="py-3">
                                <p className="text-sm">
                                  <span className="font-medium">{detail.result?.scte35?.length ?? 0}</span> SCTE-35 cue(s) in this snapshot. See the <strong>SCTE-35</strong> tab for details.
                                </p>
                              </CardContent>
                            </Card>
                          )}
                        </>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="segments" className="mt-0 overflow-auto min-h-0">
                    {detail.result?.master?.playlists?.length && detail.result?.media_playlists?.length ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <Label className="text-sm font-medium shrink-0">Variant</Label>
                          <Select
                            value={String(segmentVariantIndex)}
                            onChange={(e) => { setSelectedSegmentVariantIndex(Number(e.target.value)); setSelectedSegmentUrl(null); setSelectedSegmentDuration(null) }}
                            className="max-w-xs"
                          >
                            {detail.result.master.playlists.map((p, i) => (
                              <option key={i} value={i}>
                                {[p.resolution, p.bandwidth ? (p.bandwidth / 1e6).toFixed(1) + " Mbps" : ""].filter(Boolean).join(" · ") || `Variant ${i + 1}`}
                              </option>
                            ))}
                          </Select>
                          <span className="text-xs text-muted-foreground">
                            {segmentVariantIndex + 1} of {detail.result.media_playlists.length}
                          </span>
                        </div>
                        {(() => {
                          const pl = detail.result.master.playlists[segmentVariantIndex]
                          const mp = detail.result.media_playlists[segmentVariantIndex]
                          if (!mp) return null
                          if (mp.error) return <p className="text-sm text-destructive">{mp.error}</p>
                          const segments = mp.segments ?? []
                          const target = mp.target_duration ?? "—"
                          const seq = mp.media_sequence ?? "—"
                          return (
                            <div className="space-y-3">
                              {(pl || mp) && (pl?.codecs != null || pl?.frameRate != null || pl?.bandwidth != null || pl?.resolution != null || mp?.segment_format != null || mp?.encryption != null || mp?.init_segment != null) && (
                                <div className="p-3 rounded-md bg-muted/50 text-sm space-y-1">
                                  <p className="font-medium text-muted-foreground text-xs uppercase">Video &amp; audio info</p>
                                  <ul className="space-y-0.5 text-xs">
                                    {pl?.codecs != null && (() => {
                                      const { video, audio, raw } = codecLabels(pl.codecs)
                                      return (
                                        <li>
                                          <span className="text-muted-foreground">Codecs:</span>{" "}
                                          {[video, audio].filter(Boolean).join(" + ") || raw}
                                          {([video, audio].filter(Boolean).length > 0 && raw) ? ` (${raw})` : ""}
                                        </li>
                                      )
                                    })()}
                                    {pl?.resolution != null && <li><span className="text-muted-foreground">Resolution:</span> {pl.resolution}</li>}
                                    {pl?.frameRate != null && <li><span className="text-muted-foreground">Frame rate:</span> {pl.frameRate} fps</li>}
                                    {pl?.bandwidth != null && <li><span className="text-muted-foreground">Bandwidth:</span> {(pl.bandwidth / 1e6).toFixed(2)} Mbps</li>}
                                    {mp?.segment_format != null && <li><span className="text-muted-foreground">Segment format:</span> {mp.segment_format === "fmp4" ? "fMP4" : "MPEG-TS"}</li>}
                                    {mp?.encryption != null && mp.encryption.method !== "NONE" && (
                                      <li>
                                        <span className="text-muted-foreground">Encryption:</span> {mp.encryption.method}
                                        {mp.encryption.uri && (
                                          <a href={mp.encryption.uri} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary hover:underline">(key URI)</a>
                                        )}
                                      </li>
                                    )}
                                    {mp?.init_segment != null && (
                                      <li>
                                        <span className="text-muted-foreground">Init segment:</span>{" "}
                                        <a href={mp.init_segment!.uri} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[200px] inline-block align-bottom" title={mp.init_segment!.uri}>fMP4 init</a>
                                      </li>
                                    )}
                                  </ul>
                                </div>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Target duration: {target}s · Media sequence: {seq} · {segments.length} segments (last 30, newest first). Click a row to play segment; use Download to save.
                              </p>
                              {segments.length ? (
                                <table className="w-full text-sm border-collapse">
                                  <thead>
                                    <tr className="border-b border-border">
                                      <th className="text-left py-1.5">#</th>
                                      <th className="text-left py-1.5">Duration</th>
                                      <th className="text-left py-1.5">Discontinuity</th>
                                      <th className="text-left py-1.5 w-20">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {segments.slice(-30).reverse().map((seg, i) => {
                                      const displayIndex = segments.length - 1 - i
                                      const isSelected = selectedSegmentUrl === seg.uri
                                      return (
                                        <tr
                                          key={displayIndex}
                                          className={`border-b border-border cursor-pointer hover:bg-muted/50 active:bg-muted/70 min-h-[44px] ${isSelected ? "bg-primary/10" : ""}`}
                                          onClick={() => { setSelectedSegmentUrl(seg.uri); setSelectedSegmentDuration(seg.duration) }}
                                        >
                                          <td className="py-2 sm:py-1">{displayIndex}</td>
                                          <td className="py-2 sm:py-1">{seg.duration}</td>
                                          <td className="py-2 sm:py-1">{seg.discontinuity ? "yes" : ""}</td>
                                          <td className="py-2 sm:py-1" onClick={(e) => e.stopPropagation()}>
                                            <a href={seg.uri} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="Download segment">
                                              <Download className="h-3.5 w-3.5" />
                                              Download
                                            </a>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="text-sm text-muted-foreground">No segments.</p>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No segment data. Run inspection first.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="captions" className="mt-0 overflow-auto min-h-0">
                    {(detail.result?.master?.captions?.length ?? 0) > 0 || (detail.result?.captions?.length ?? 0) > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Subtitle and closed-caption tracks from the manifest (#EXT-X-MEDIA).
                        </p>
                        <div className="space-y-2">
                          {(detail.result?.master?.captions ?? detail.result?.captions ?? []).map((c, i) => (
                            <Card key={i}>
                              <CardContent className="py-3">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-muted">
                                    {c.type}
                                  </span>
                                  <span className="font-medium">{c.name ?? "(no name)"}</span>
                                  {c.language && (
                                    <span className="text-muted-foreground text-xs">({c.language})</span>
                                  )}
                                  {c.uri && (
                                    <a
                                      href={c.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:underline text-xs"
                                    >
                                      Open playlist
                                    </a>
                                  )}
                                </div>
                                {c.uri && (
                                  <p className="text-xs text-muted-foreground mt-1 truncate" title={c.uri}>
                                    {c.uri}
                                  </p>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No #EXT-X-MEDIA caption or subtitle tracks found in the manifest. Embedded captions (CEA-608/708) in the video stream are not listed here.
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="scte35" className="mt-0 overflow-auto min-h-0">
                    {detail.result?.scte35?.length ? (
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2">Type</th>
                            <th className="text-left py-2">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.result.scte35.map((s, i) => (
                            <tr key={i} className="border-b border-border">
                              <td className="py-2">
                                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-muted">
                                  {s.type}
                                </span>
                              </td>
                              <td className="py-2">
                                {s.advertised_seconds != null
                                  ? `Advertised: ${s.advertised_seconds}s, Actual: ${s.actual_seconds}s, Delta: ${s.delta_seconds}s`
                                  : s.raw ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted-foreground">No SCTE-35 cues in this snapshot.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="playlist" className="mt-0 flex flex-col min-h-0 flex-1 overflow-hidden">
                    {detail.result?.media_playlists?.length ? (
                      <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
                        {detail.result.master?.playlists?.length && detail.result.media_playlists.length > 1 && (
                          <div className="flex flex-wrap items-center gap-3 shrink-0">
                            <Label className="text-sm font-medium shrink-0">Variant</Label>
                            <Select
                              value={String(playlistVariantIndex)}
                              onChange={(e) => setSelectedPlaylistVariantIndex(Number(e.target.value))}
                              className="max-w-xs"
                            >
                              {detail.result.master.playlists.map((p, i) => (
                                <option key={i} value={i}>
                                  {[p.resolution, p.bandwidth ? (p.bandwidth / 1e6).toFixed(1) + " Mbps" : ""].filter(Boolean).join(" · ") || `Variant ${i + 1}`}
                                </option>
                              ))}
                            </Select>
                            <span className="text-xs text-muted-foreground">
                              {playlistVariantIndex + 1} of {detail.result.media_playlists.length}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const mp = detail.result?.media_playlists?.[playlistVariantIndex]
                                if (!mp?.raw) return
                                const blob = new Blob([mp.raw], { type: "text/plain" })
                                const name = `playlist-variant-${playlistVariantIndex + 1}.txt`
                                const a = document.createElement("a")
                                a.href = URL.createObjectURL(blob)
                                a.download = name
                                a.click()
                                URL.revokeObjectURL(a.href)
                              }}
                            >
                              <Download className="h-4 w-4 mr-1.5" />
                              Download as .txt
                            </Button>
                          </div>
                        )}
                        {detail.result.media_playlists.length === 1 && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const raw = detail.result?.media_playlists?.[0]?.raw
                                if (!raw) return
                                const blob = new Blob([raw], { type: "text/plain" })
                                const a = document.createElement("a")
                                a.href = URL.createObjectURL(blob)
                                a.download = "playlist.txt"
                                a.click()
                                URL.revokeObjectURL(a.href)
                              }}
                            >
                              <Download className="h-4 w-4 mr-1.5" />
                              Download as .txt
                            </Button>
                          </div>
                        )}
                        <div className="min-h-0 flex-1 rounded-md border border-border overflow-hidden flex flex-col">
                          <pre className="p-3 rounded-md bg-muted text-xs flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-all">
                            {detail.result.media_playlists[playlistVariantIndex]?.raw ?? "No raw data for this variant."}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No playlist raw data. Run inspection first.</p>
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
