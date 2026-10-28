import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Album, Track, Link, loadStore, saveStore, uid } from '../../lib/potion'

export default function AlbumPage() {
  const router = useRouter()
  const { id } = router.query
  const [store, setStore] = useState<{ albums: Album[]; tracks: Track[] }>({ albums: [], tracks: [] })
  const [ready, setReady] = useState(false)

  useEffect(() => { setStore(loadStore()); setReady(true) }, [])
  useEffect(() => { if (ready) saveStore(store) }, [store, ready])

  const album = store.albums.find(a => a.id === id)
  const tracks = store.tracks.filter(t => t.albumId === id).sort((a, b) => a.position - b.position)

  if (!ready) return <div style={{ padding: 40 }}>Loading…</div>
  if (!album) return <div style={{ padding: 40 }}>Album not found. <button onClick={() => router.push('/potion')}>Back</button></div>

  function updateAlbum(patch: Partial<Album>) {
    setStore(s => ({ ...s, albums: s.albums.map(a => a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a) }))
  }

  function addTrack() {
    const t: Track = { id: uid(), albumId: id as string, title: 'New Track', position: tracks.length, completed: false, notes: '', links: [], createdAt: Date.now(), updatedAt: Date.now() }
    setStore(s => ({ ...s, tracks: [...s.tracks, t] }))
  }

  function updateTrack(tid: string, patch: Partial<Track>) {
    setStore(s => ({ ...s, tracks: s.tracks.map(t => t.id === tid ? { ...t, ...patch, updatedAt: Date.now() } : t) }))
  }

  function removeTrack(tid: string) {
    if (!confirm('Delete track?')) return
    setStore(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== tid) }))
  }

  function move(tid: string, dir: -1 | 1) {
    const idx = tracks.findIndex(t => t.id === tid)
    const ni = idx + dir
    if (ni < 0 || ni >= tracks.length) return
    const other = tracks[ni]
    setStore(s => ({ ...s, tracks: s.tracks.map(t => {
      if (t.id === tid) return { ...t, position: other.position }
      if (t.id === other.id) return { ...t, position: tracks[idx].position }
      return t
    }) }))
  }

  const pct = tracks.length ? Math.round(tracks.filter(t => t.completed).length / tracks.length * 100) : 0

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <button onClick={() => router.push('/potion')}>← Back</button>
      <input value={album.title} onChange={e => updateAlbum({ title: e.target.value })} style={{ fontSize: 28, fontWeight: 700, border: 'none', width: '100%', marginTop: 8 }} />
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <select value={album.status} onChange={e => updateAlbum({ status: e.target.value as any })}>
          <option value="upcoming">upcoming</option>
          <option value="in-progress">in-progress</option>
          <option value="completed">completed</option>
          <option value="archived">archived</option>
        </select>
        <input type="date" value={album.releaseDate || ''} onChange={e => updateAlbum({ releaseDate: e.target.value })} />
        <input placeholder="Image URL" value={album.image || ''} onChange={e => updateAlbum({ image: e.target.value })} style={{ flex: 1 }} />
      </div>
      {album.image && <img src={album.image} alt="" style={{ maxWidth: 240, borderRadius: 8 }} onError={e => (e.currentTarget.style.display='none')} />}
      <textarea placeholder="Album notes" value={album.notes} onChange={e => updateAlbum({ notes: e.target.value })} style={{ width: '100%', minHeight: 80, marginTop: 8 }} />
      <h3>Tracks — {pct}%</h3>
      <button onClick={addTrack}>Add Track</button>
      <div style={{ marginTop: 8 }}>
        {tracks.map((t, i) => (
          <div key={t.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={t.completed} onChange={e => updateTrack(t.id, { completed: e.target.checked })} />
              <input value={t.title} onChange={e => updateTrack(t.id, { title: e.target.value })} style={{ flex: 1, fontWeight: 600 }} />
              <button onClick={() => move(t.id, -1)}>↑</button>
              <button onClick={() => move(t.id, 1)}>↓</button>
              <button onClick={() => removeTrack(t.id)}>✕</button>
            </div>
            <textarea value={t.notes} onChange={e => updateTrack(t.id, { notes: e.target.value })} placeholder="Notes/lyrics" style={{ width: '100%', minHeight: 60, marginTop: 8 }} />
            <div style={{ marginTop: 6 }}>
              <button onClick={() => {
                const url = prompt('Link URL')
                if (!url) return
                updateTrack(t.id, { links: [...t.links, { id: uid(), url, label: url }] })
              }}>+ Link</button>
              {t.links.map(l => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>{l.url}</a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={() => {
          const url = prompt('Album link URL')
          if (!url) return
          updateAlbum({ links: [...album.links, { id: uid(), url, label: url }] })
        }}>+ Album Link</button>
        {album.links.map(l => <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>{l.url}</a>)}
      </div>
    </div>
  )
}
EOF
echo done