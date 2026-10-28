import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Album, Track, Link, loadStore, saveStore, uid } from '../../lib/potion'

export default function Workspace() {
  const [store, setStore] = useState<{ albums: Album[]; tracks: Track[] }>({ albums: [], tracks: [] })
  const [ready, setReady] = useState(false)
  const [q, setQ] = useState('')
  const router = useRouter()

  useEffect(() => { setStore(loadStore()); setReady(true) }, [])
  useEffect(() => { if (ready) saveStore(store) }, [store, ready])

  const albums = store.albums.filter(a => a.title.toLowerCase().includes(q.toLowerCase()))
  const progress = (a: Album) => {
    const ts = store.tracks.filter(t => t.albumId === a.id)
    if (!ts.length) return 0
    return Math.round((ts.filter(t => t.completed).length / ts.length) * 100)
  }

  function createAlbum() {
    const a: Album = { id: uid(), title: 'Untitled Album', status: 'upcoming', notes: '', links: [], createdAt: Date.now(), updatedAt: Date.now() }
    setStore(s => ({ ...s, albums: [a, ...s.albums] }))
  }

  function removeAlbum(id: string) {
    if (!confirm('Delete album and its tracks?')) return
    setStore(s => ({ albums: s.albums.filter(a => a.id !== id), tracks: s.tracks.filter(t => t.albumId !== id) }))
  }

  if (!ready) return <div style={{ padding: 40 }}>Loading…</div>

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>Potion — Album Workspace</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="Search albums" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, padding: 8 }} />
        <button onClick={createAlbum}>New Album</button>
      </div>
      {albums.length === 0 && <p>No albums yet. Create one.</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {albums.map(a => (
          <div key={a.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            {a.image ? <img src={a.image} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ width: 64, height: 64, background: '#eee', borderRadius: 6 }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{a.status} · {store.tracks.filter(t => t.albumId === a.id).length} tracks · {progress(a)}%</div>
            </div>
            <button onClick={() => router.push(`/potion/${a.id}`)}>Open</button>
            <button onClick={() => removeAlbum(a.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
EOF
echo done