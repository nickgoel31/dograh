import * as React from 'react'
import { API_URL } from '@/lib/api/env'
import { http } from '@/lib/api/http'
import { useUI } from '@/store/ui'
import type { components } from '@/lib/api/schema'

export type CallStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'failed'
export interface CallLine { id: string; who: 'agent' | 'you'; text: string; final: boolean }

/** Close reasons from the server, in plain words. */
const REASONS: Record<string, string> = {
  origin_not_allowed: "This page isn't allowed to start calls.",
  not_signed_in: 'Please sign in again to start a call.',
  session_expired: 'Your session expired. Please sign in again.',
  no_workspace: "You don't belong to a workspace yet.",
  workspace_not_found: "We couldn't find that workspace.",
  not_allowed: "You don't have permission to test this agent. Ask a workspace owner.",
  agent_not_found: "We couldn't find that agent.",
  add_money_first: "You're out of balance. Add money on the Billing page to keep practising.",
  agent_not_available: 'This agent is not taking calls right now.',
  website_not_allowed: "This website isn't allowed to start calls with this agent.",
  calls_not_set_up: "Calling isn't enabled for your workspace yet. Please contact support.",
}

/** `widget` is set when a visitor on a customer's website calls a Live agent (no sign-in). */
export interface WidgetOpts { embedder: string }

function wsUrl(agentId: string, workspaceId: string | null, widget?: WidgetOpts) {
  const base = API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`
  if (widget) return `${base.replace(/^http/, 'ws')}/public/widget/${encodeURIComponent(agentId)}/call?embedder=${encodeURIComponent(widget.embedder)}`
  const q = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ''
  return `${base.replace(/^http/, 'ws')}/agents/${agentId}/call${q}`
}

const newId = () => 'PC-' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')

/** A practice call with an agent, in the browser. Always runs on the agent's test copy. */
export function useAgentCall(agentId: string, widget?: WidgetOpts) {
  const [status, setStatus] = React.useState<CallStatus>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [lines, setLines] = React.useState<CallLine[]>([])
  const [muted, setMutedState] = React.useState(false)
  const pc = React.useRef<RTCPeerConnection | null>(null)
  const ws = React.useRef<WebSocket | null>(null)
  const stream = React.useRef<MediaStream | null>(null)
  const audio = React.useRef<HTMLAudioElement | null>(null)
  const pcId = React.useRef(newId())
  const closing = React.useRef(false)

  const cleanup = React.useCallback(() => {
    closing.current = true
    ws.current?.close(); ws.current = null
    pc.current?.close(); pc.current = null
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null
    if (audio.current) { audio.current.srcObject = null; audio.current = null }
  }, [])
  React.useEffect(() => cleanup, [cleanup])

  const addLine = (who: CallLine['who'], text: string, final: boolean) =>
    setLines((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.who === who && !last.final) {
        const merged = who === 'agent' ? `${last.text} ${text}`.trim() : text // user text is replaced as it firms up
        return [...prev.slice(0, -1), { ...last, text: merged, final }]
      }
      return [...prev, { id: `${who}-${prev.length}`, who, text, final }]
    })

  const fail = (msg: string) => { setError(msg); setStatus('failed'); cleanup() }

  const start = React.useCallback(async () => {
    setError(null); setLines([]); setStatus('connecting'); closing.current = false; pcId.current = newId()
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone.')
      const [ice, mic] = await Promise.all([
        http<components['schemas']['IceOut']>(widget ? '/public/widget/ice' : '/call/ice'),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      ])
      stream.current = mic
      const peer = new RTCPeerConnection({
        iceServers: ice.ice_servers.map((s) => ({ urls: s.urls, username: s.username ?? undefined, credential: s.credential ?? undefined })),
      })
      pc.current = peer
      mic.getTracks().forEach((t) => peer.addTrack(t, mic))
      peer.ontrack = (e) => {
        if (e.track.kind !== 'audio') return
        const el = audio.current ?? new Audio()
        el.autoplay = true; el.srcObject = e.streams[0]; audio.current = el
        void el.play().catch(() => {})
      }
      peer.oniceconnectionstatechange = () => {
        const s = peer.iceConnectionState
        if (s === 'connected' || s === 'completed') setStatus('live')
        else if (s === 'failed') fail("We couldn't connect the call. Check your network and try again.")
        else if (s === 'disconnected' && !closing.current) { setStatus('ended'); cleanup() }
      }

      const socket = new WebSocket(wsUrl(agentId, useUI.getState().workspaceId, widget))
      ws.current = socket
      peer.onicecandidate = (e) => {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({
          type: 'ice-candidate',
          payload: { pc_id: pcId.current, candidate: e.candidate ? { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } : null },
        }))
      }
      socket.onclose = (e) => {
        if (closing.current) return
        if (e.code === 1008 && e.reason) return fail(REASONS[e.reason] ?? 'The call could not start.')
        setStatus((s) => (s === 'live' ? 'ended' : s === 'connecting' ? 'failed' : s))
        setError((m) => m ?? (e.code === 1008 ? 'The call could not start.' : null))
      }
      socket.onmessage = async (ev) => {
        const m = JSON.parse(ev.data)
        if (m.type === 'answer') await peer.setRemoteDescription({ type: 'answer', sdp: m.payload.sdp })
        else if (m.type === 'ice-candidate' && m.payload?.candidate) {
          const c = m.payload.candidate
          await peer.addIceCandidate({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }).catch(() => {})
        } else if (m.type === 'rtf-user-transcription') addLine('you', m.payload.text, !!m.payload.final)
        else if (m.type === 'rtf-bot-text') addLine('agent', m.payload.text, false)
        else if (m.type === 'error') {
          const t = m.payload?.error_type
          fail(t === 'quota_exceeded' ? "You're out of free test minutes." : "Something went wrong starting the call. Please try again.")
        }
      }
      await new Promise<void>((res, rej) => { socket.onopen = () => res(); socket.addEventListener('error', () => rej(new Error('We cannot reach the server. Check your connection.')), { once: true }) })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      socket.send(JSON.stringify({ type: 'offer', payload: { sdp: offer.sdp, type: 'offer', pc_id: pcId.current } }))
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      fail(denied ? 'Microphone access is blocked. Allow it in your browser and try again.' : e instanceof Error ? e.message : 'The call could not start.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, widget?.embedder, cleanup])

  const end = React.useCallback(() => { cleanup(); setStatus('ended') }, [cleanup])
  const setMuted = (m: boolean) => { stream.current?.getAudioTracks().forEach((t) => { t.enabled = !m }); setMutedState(m) }

  return { status, error, lines, muted, start, end, setMuted }
}
