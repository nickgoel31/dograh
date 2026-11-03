import * as React from 'react'
import { Download, Pause, Play } from '@/components/icons'
import { cn } from '@/lib/utils'

const SPEEDS = [1, 1.25, 1.5, 2]
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The call recording: play/pause, a seekable progress bar, speed, and download. Stays in step with the transcript through `time`. */
export function RecordingPlayer({ src, time, onTime }: { src: string; time: number; onTime: (t: number) => void }) {
  const audio = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [length, setLength] = React.useState(0)
  const [speed, setSpeed] = React.useState(1)
  const [failed, setFailed] = React.useState(false)

  // Clicking a line in the transcript jumps the recording there.
  React.useEffect(() => {
    const a = audio.current
    if (a && Math.abs(a.currentTime - time) > 0.75) a.currentTime = time
  }, [time])

  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play().catch(() => setFailed(true)); else a.pause() }
  const seek = (v: number) => { if (audio.current) audio.current.currentTime = v; onTime(v) }
  const pct = length ? Math.min(100, (time / length) * 100) : 0
  const nextSpeed = () => { const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(n); if (audio.current) audio.current.playbackRate = n }

  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-muted/50 p-3" role="group" aria-label="Call recording">
      <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)} onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setFailed(true)} />
      <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:scale-105">
        {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}</button>
      <div className="min-w-0 flex-1">
        <input type="range" min={0} max={length || 1} step={0.1} value={Math.min(time, length || 1)} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" disabled={!length}
          className="recording-range w-full" style={{ background: `linear-gradient(to right, hsl(var(--accent)) ${pct}%, hsl(var(--line)) ${pct}%)` }} />
        <div className="num mt-1 flex justify-between text-xs text-soft"><span>{clock(time)}</span><span>{failed ? "Couldn't load the recording" : length ? clock(length) : '–:––'}</span></div>
      </div>
      <button onClick={nextSpeed} aria-label="Playback speed" className={cn('num w-12 shrink-0 rounded-lg border bg-surface py-1 text-xs font-semibold hover:bg-muted', speed !== 1 && 'text-accent')}>{speed}x</button>
      <a href={src} download aria-label="Download recording" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-soft hover:bg-muted hover:text-ink"><Download size={16} /></a>
    </div>
  )
}
