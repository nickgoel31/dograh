import * as React from 'react'
import { Heart, Lock, Play, Plus, Square, Columns3 } from 'lucide-react'
import { Badge, Button, Card, Chip, Dialog, Input, Select, Textarea } from '@/components/ui'
import { AdvancedOnly, Bars, CardSkeletons, PageHeader, speak, stopSpeaking, useAsync } from '@/components/shared'
import { api, USE_MOCKS } from '@/lib/api'
import { voicesApi } from '@/lib/api/voices'
import { useData } from '@/store/data'
import { cn } from '@/lib/utils'
import type { Voice } from '@/mock/types'

export default function VoicesPage() {
  const { data, loading } = useAsync(() => api.voices(), [])
  const { favorites, toggleFav, setFavorites } = useData()
  // Real mode: favourites live on the server.
  React.useEffect(() => { if (!USE_MOCKS) voicesApi.list().then((vs) => setFavorites(vs.filter((v) => v.favorite).map((v) => v.id))).catch(() => {}) }, [setFavorites])
  const [f, setF] = React.useState({ lang: '', gender: '', age: '', accent: '', style: '' })
  const [playing, setPlaying] = React.useState<string | null>(null)
  const [favOnly, setFavOnly] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [shown, setShown] = React.useState(30)
  const [cmp, setCmp] = React.useState<string[]>([])
  const [open, setOpen] = React.useState(false)
  const [sentence, setSentence] = React.useState('Hi there! Thanks for calling. How can I help you today?')

  const list = (data ?? []).filter((v) => (!f.lang || v.lang === f.lang) && (!f.gender || v.gender === f.gender) && (!f.age || v.age === f.age) && (!f.accent || v.accent === f.accent) && (!f.style || v.style === f.style) && (!favOnly || favorites.includes(v.id)) && (!q || `${v.name} ${v.style} ${v.description ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const opts = (k: keyof Voice) => [...new Set((data ?? []).map((v) => v[k]))].filter(Boolean) as string[]
  const play = (v: Voice, text = 'Hello! I can be the voice of your business.') => {
    if (playing === v.id) { stopSpeaking(); setPlaying(null); return }
    setPlaying(v.id); speak(text, { female: v.gender === 'Female', onEnd: () => setPlaying((p) => (p === v.id ? null : p)) })
  }
  const playAll = async () => {
    for (const id of cmp) {
      const v = data!.find((x) => x.id === id)!
      await new Promise<void>((res) => { setPlaying(id); speak(sentence, { female: v.gender === 'Female', onEnd: () => { setPlaying(null); res() } }) })
    }
  }
  const Sel = ({ k, label }: { k: keyof typeof f; label: string }) => opts(k as keyof Voice).length === 0 ? null : (
    <Select className="w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}><option value="">{label}</option>{opts(k as keyof Voice).map((o) => <option key={o}>{o}</option>)}</Select>
  )
  return (
    <>
      <PageHeader title="Voices" subtitle="Choose how your agent sounds. Press play on any voice."
        actions={<Button onClick={() => setOpen(true)}><Columns3 size={15} />Compare voices{cmp.length > 0 && ` (${cmp.length})`}</Button>} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Input className="w-52" placeholder="Search voices" aria-label="Search voices" value={q} onChange={(e) => { setQ(e.target.value); setShown(30) }} /><Sel k="lang" label="Language" /><Sel k="gender" label="Gender" /><Sel k="age" label="Age" /><Sel k="accent" label="Accent" /><Sel k="style" label="Style" />
        <Chip active={favOnly} onClick={() => setFavOnly(!favOnly)}>♥ Favorites</Chip>
      </div>
      <AdvancedOnly><Card className="mb-6 border-accent/30 bg-accent-soft p-4 text-sm">Voices come from our voice engines. Voices marked Coming soon aren't switched on yet.</Card></AdvancedOnly>
      {loading ? <CardSkeletons n={9} h="h-32" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card className="flex flex-col items-center justify-center gap-1 border-dashed p-5 text-center opacity-70"><Lock size={18} /><div className="font-semibold">Clone a voice</div><Badge tone="accent">Coming soon</Badge><Button size="sm" disabled className="mt-2">Upload a sample</Button></Card>
          {list.slice(0, shown).map((v) => (
            <Card key={v.id} className={cn('p-4', v.available === false && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <Button variant={playing === v.id ? 'primary' : 'secondary'} size="icon" className="h-11 w-11 rounded-full" onClick={() => play(v)} disabled={!USE_MOCKS} title={USE_MOCKS ? undefined : 'Voice samples are coming soon'} aria-label={`${playing === v.id ? 'Stop' : 'Play'} ${v.name}`}>{playing === v.id ? <Square size={14} /> : <Play size={15} className="ml-0.5" />}</Button>
                <div className="flex-1"><div className="flex items-center gap-2 font-semibold">{v.name}{playing === v.id && <Bars className="text-accent" />}</div><div className="text-[13px] text-soft">{[v.lang, v.accent].filter(Boolean).join(' · ')}</div>{v.description && <p className="mt-1 line-clamp-2 text-xs text-soft">{v.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">{v.gender && <Badge>{v.gender}</Badge>}{v.age && <Badge>{v.age}</Badge>}{v.style && <Badge tone="accent">{v.style}</Badge>}{v.available === false && <Badge>Coming soon</Badge>}<AdvancedOnly><Badge>{v.provider}</Badge></AdvancedOnly></div></div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => toggleFav(v.id)} aria-label="Favorite" aria-pressed={favorites.includes(v.id)} className={cn('rounded-md p-1.5 hover:bg-muted', favorites.includes(v.id) ? 'text-bad' : 'text-soft')}><Heart size={16} fill={favorites.includes(v.id) ? 'currentColor' : 'none'} /></button>
                  <button onClick={() => setCmp(cmp.includes(v.id) ? cmp.filter((x) => x !== v.id) : cmp.length < 3 ? [...cmp, v.id] : cmp)} aria-label="Add to compare" className={cn('rounded-md p-1.5 hover:bg-muted', cmp.includes(v.id) ? 'text-accent' : 'text-soft')}><Plus size={16} /></button></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {list.length > shown && <div className="mt-4 text-center"><Button onClick={() => setShown(shown + 30)}>Show more ({list.length - shown} left)</Button></div>}
      <Dialog open={open} onOpenChange={setOpen} side title="Compare voices" description="Pick up to 3 voices with the + button, then play them one after another.">
        <Textarea value={sentence} onChange={(e) => setSentence(e.target.value)} aria-label="Sentence" />
        <div className="mt-4 space-y-2">{cmp.length === 0 && <p className="text-soft">No voices picked yet.</p>}
          {cmp.map((id) => { const v = data!.find((x) => x.id === id)!; return <div key={id} className="flex items-center gap-3 rounded-lg border p-3"><Button size="icon" variant="secondary" className="rounded-full" onClick={() => play(v, sentence)}><Play size={14} /></Button><div className="flex-1 font-medium">{v.name}<div className="text-xs font-normal text-soft">{v.lang}</div></div>{playing === id && <Bars className="text-accent" />}<Button size="sm" variant="ghost" onClick={() => setCmp(cmp.filter((x) => x !== id))}>Remove</Button></div> })}</div>
        <Button variant="primary" className="mt-4 w-full" disabled={!cmp.length || !USE_MOCKS} onClick={playAll}>Play all in a row</Button>
      </Dialog>
    </>
  )
}
