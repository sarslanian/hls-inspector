import { useEffect, useRef, useState } from "react"
import Hls from "hls.js"

type Props = {
  src: string | null
  segmentSrc?: string | null
  segmentDuration?: number | null
  segmentInitSegmentUri?: string | null
  segmentKeyMethod?: string | null
  segmentKeyUri?: string | null
  autoPlay?: boolean
  className?: string
}

type SingleSegmentM3u8Options = {
  /** EXT-X-MAP URI for fMP4/CMAF segments. */
  initSegmentUri?: string | null
  /** Optional EXT-X-KEY for encrypted segments. */
  keyMethod?: string | null
  keyUri?: string | null
}

/** Build a minimal single-segment m3u8 so HLS.js/native Safari can play one segment. */
function buildSingleSegmentM3u8(segmentUri: string, durationSeconds: number, options: SingleSegmentM3u8Options): string {
  const duration = Math.max(0.1, durationSeconds)
  const targetDuration = Math.ceil(duration)
  const initSegmentUri = options.initSegmentUri ?? null
  const keyMethod = options.keyMethod ?? null
  const keyUri = options.keyUri ?? null

  // HLS.js supports multiple versions for TS, but for fMP4 we typically need EXT-X-MAP which is
  // specified for later versions. Using 7 when an init segment is present is the most compatible.
  const version = initSegmentUri ? 7 : 3

  return [
    "#EXTM3U",
    `#EXT-X-VERSION:${version}`,
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    ...(initSegmentUri ? [`#EXT-X-MAP:URI="${initSegmentUri}"`] : []),
    ...(keyMethod && keyUri && keyMethod !== "NONE"
      ? [`#EXT-X-KEY:METHOD=${keyMethod},URI="${keyUri}"`]
      : []),
    `#EXTINF:${duration.toFixed(3)},`,
    segmentUri,
    "#EXT-X-ENDLIST",
  ].join("\n")
}

export function HlsPlayer({
  src,
  segmentSrc,
  segmentDuration,
  segmentInitSegmentUri,
  segmentKeyMethod,
  segmentKeyUri,
  autoPlay = true,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const [segmentError, setSegmentError] = useState<string | null>(null)

  const isSegmentMode = segmentSrc != null && segmentSrc !== "" && segmentDuration != null
  const canPlayNativeHls = typeof document !== "undefined" ? Boolean(document.createElement("video").canPlayType("application/vnd.apple.mpegurl")) : false
  const unsupportedSegmentPlayback = isSegmentMode && !canPlayNativeHls && !Hls.isSupported()

  // Playlist mode: HLS.js with main src
  useEffect(() => {
    if (isSegmentMode) return

    const video = videoRef.current
    if (!video || !src) {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      return
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src
      return () => {
        video.removeAttribute("src")
        video.load()
      }
    }
  }, [src, isSegmentMode])

  // Segment mode: build single-segment m3u8, blob URL, and play with HLS.js
  useEffect(() => {
    if (!isSegmentMode || !segmentSrc || segmentDuration == null) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      return
    }

    const video = videoRef.current
    if (!video) {
      return
    }

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const m3u8 = buildSingleSegmentM3u8(segmentSrc, segmentDuration, {
      initSegmentUri: segmentInitSegmentUri ?? null,
      keyMethod: segmentKeyMethod ?? null,
      keyUri: segmentKeyUri ?? null,
    })
    const blob = new Blob([m3u8], { type: "application/vnd.apple.mpegurl" })
    const blobUrl = URL.createObjectURL(blob)
    blobUrlRef.current = blobUrl

    const canNative = video.canPlayType("application/vnd.apple.mpegurl")
    const useNative = Boolean(canNative)

    // Safari/iOS can play HLS natively; Firefox/other browsers typically use MediaSource via hls.js.
    if (useNative) {
      const onVideoError = () => setSegmentError("Segment failed to play (native HLS).")
      video.addEventListener("error", onVideoError)
      video.src = blobUrl
      video.load()

      return () => {
        video.removeEventListener("error", onVideoError)
        video.removeAttribute("src")
        video.load()
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
          blobUrlRef.current = null
        }
        setSegmentError(null)
      }
    }

    if (!Hls.isSupported()) return

    const hls = new Hls({ enableWorker: true })
    hlsRef.current = hls
    hls.loadSource(blobUrl)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) setSegmentError(data.type === "networkError" ? "Segment failed to load (network or CORS)." : "Playback error.")
    })

    return () => {
      hls.destroy()
      hlsRef.current = null
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      video.removeAttribute("src")
      video.load()
      setSegmentError(null)
    }
  }, [segmentSrc, segmentDuration, segmentInitSegmentUri, segmentKeyMethod, segmentKeyUri, isSegmentMode])

  if (!src && !segmentSrc) {
    return (
      <div className={`w-full aspect-video max-h-full min-h-[180px] ${className ?? ""}`} style={{ background: "hsl(var(--muted))", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--muted-foreground))" }}>
        Select a stream to preview
      </div>
    )
  }

  return (
    <div className="space-y-1 w-full min-h-0">
      <div className="w-full aspect-video max-h-full min-h-0 bg-black rounded-lg overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          className={className}
          controls
          muted
          playsInline
          autoPlay={autoPlay}
          style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 8 }}
        />
      </div>
      {(segmentError ?? (unsupportedSegmentPlayback ? "HLS playback is not supported in this browser." : null)) && (
        <p className="text-xs text-destructive">{segmentError ?? "HLS playback is not supported in this browser."}</p>
      )}
    </div>
  )
}
