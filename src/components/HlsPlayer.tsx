import { useEffect, useRef, useState } from "react"
import Hls from "hls.js"

type Props = {
  src: string | null
  segmentSrc?: string | null
  segmentDuration?: number | null
  autoPlay?: boolean
  className?: string
}

/** Build a minimal single-segment m3u8 so HLS.js can play one segment (works for .ts and .m4s). */
function buildSingleSegmentM3u8(segmentUri: string, durationSeconds: number): string {
  const duration = Math.max(0.1, durationSeconds)
  const targetDuration = Math.ceil(duration)
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXTINF:${duration.toFixed(3)},`,
    segmentUri,
    "#EXT-X-ENDLIST",
  ].join("\n")
}

export function HlsPlayer({ src, segmentSrc, segmentDuration, autoPlay = true, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const [segmentError, setSegmentError] = useState<string | null>(null)

  const isSegmentMode = segmentSrc != null && segmentSrc !== "" && segmentDuration != null

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
      setSegmentError(null)
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      return
    }

    const video = videoRef.current
    if (!video || !Hls.isSupported()) {
      setSegmentError("HLS.js is required for segment playback.")
      return
    }

    setSegmentError(null)
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const m3u8 = buildSingleSegmentM3u8(segmentSrc, segmentDuration)
    const blob = new Blob([m3u8], { type: "application/vnd.apple.mpegurl" })
    const blobUrl = URL.createObjectURL(blob)
    blobUrlRef.current = blobUrl

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
      setSegmentError(null)
    }
  }, [segmentSrc, segmentDuration, isSegmentMode])

  if (!src && !segmentSrc) {
    return (
      <div className={`w-full aspect-video max-h-[70vh] min-h-[240px] ${className ?? ""}`} style={{ background: "hsl(var(--muted))", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--muted-foreground))" }}>
        Select a stream to preview
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="w-full aspect-video max-h-[70vh] min-h-[240px] bg-black rounded-lg overflow-hidden flex items-center justify-center">
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
      {segmentError && <p className="text-xs text-destructive">{segmentError}</p>}
    </div>
  )
}
