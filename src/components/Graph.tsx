import { t } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { select } from 'd3-selection'
import { useApp } from '../lib/app'
import { baseName } from '../lib/links'

interface GNode extends SimulationNodeDatum {
  id: string
  label: string
  deg: number
  color: string
}
interface GLink {
  source: string | GNode
  target: string | GNode
}

function folderColor(path: string, dark: boolean) {
  const top = path.includes('/') ? path.split('/')[0] : ''
  if (!top) return dark ? '#ff5555' : '#d01010'
  let h = 0
  for (const c of top) h = (h * 31 + c.charCodeAt(0)) % 360
  // 폴더마다 회색 농도만 다르게. 배경과 3:1 이상 대비가 되도록 너무 어둡거나 밝은 값은 쓰지 않는다
  const step = (h % 5) * 6
  return `hsl(0 0% ${dark ? 55 + step : 30 + step}%)`
}

export function Graph({ local = false, mini = false }: { local?: boolean; mini?: boolean }) {
  const index = useApp((s) => s.index)
  const current = useApp((s) => s.current)
  const [isLocal, setLocal] = useState(local)
  const [depth, setDepth] = useState(2)
  const [orphans, setOrphans] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const dark = document.documentElement.dataset.theme === 'dark'
  const stateRef = useRef({ selected: null as string | null, filter: '', current: null as string | null })
  stateRef.current = { selected, filter, current }

  const data = useMemo(() => {
    const all = [...index.notes.keys()]
    let ids = new Set(all)
    if (isLocal && current && index.notes.has(current)) {
      ids = new Set([current])
      let frontier = [current]
      for (let d = 0; d < depth; d++) {
        const next: string[] = []
        for (const p of frontier)
          for (const q of [...(index.out.get(p) ?? []), ...(index.back.get(p) ?? [])])
            if (!ids.has(q)) {
              ids.add(q)
              next.push(q)
            }
        frontier = next
      }
    }
    const links: GLink[] = []
    const deg = new Map<string, number>()
    for (const p of ids)
      for (const q of index.out.get(p) ?? [])
        if (ids.has(q)) {
          links.push({ source: p, target: q })
          deg.set(p, (deg.get(p) ?? 0) + 1)
          deg.set(q, (deg.get(q) ?? 0) + 1)
        }
    const nodes: GNode[] = [...ids]
      .filter((p) => orphans || deg.get(p) || p === current)
      .map((p) => ({ id: p, label: baseName(p), deg: deg.get(p) ?? 0, color: folderColor(p, dark) }))
    return { nodes, links: links.filter((l) => nodes.some((n) => n.id === l.source) && nodes.some((n) => n.id === l.target)) }
  }, [index, isLocal, current, depth, orphans, dark])

  const draw = useRef<() => void>(() => {})
  const sim = useRef<Simulation<GNode, undefined> | null>(null)
  const tf = useRef<ZoomTransform>(zoomIdentity)
  const nodesRef = useRef<GNode[]>([])

  useEffect(() => {
    const cv = canvas.current!
    const box = wrap.current!
    const ctx = cv.getContext('2d')!
    const nodes = data.nodes.map((n) => ({ ...n }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = data.links.map((l) => ({ source: l.source as string, target: l.target as string }))
    nodesRef.current = nodes
    let W = 0
    let H = 0
    let ready = false // 배치 계산이 끝나 보여줄 수 있는 상태
    let touched = false // 사용자가 직접 확대/이동했는가
    const fit = () => {
      const r = box.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      W = r.width
      H = r.height
      cv.width = W * dpr
      cv.height = H * dpr
      cv.style.width = W + 'px'
      cv.style.height = H + 'px'
      draw.current()
    }

    const css = getComputedStyle(document.documentElement)
    const colLink = css.getPropertyValue('--graph-link').trim() || '#8884'
    const colText = css.getPropertyValue('--text').trim() || '#222'
    const colAccent = css.getPropertyValue('--accent').trim() || '#d01010'

    draw.current = () => {
      const dpr = window.devicePixelRatio || 1
      const { selected: sel, filter: fl, current: cur } = stateRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!ready) return
      ctx.save()
      ctx.translate(tf.current.x, tf.current.y)
      ctx.scale(tf.current.k, tf.current.k)
      const nb = new Set<string>()
      if (sel) {
        nb.add(sel)
        for (const l of links) {
          const s = (l.source as unknown as GNode).id
          const t = (l.target as unknown as GNode).id
          if (s === sel) nb.add(t)
          if (t === sel) nb.add(s)
        }
      }
      const fq = fl.trim().toLowerCase()
      ctx.lineWidth = 1 / tf.current.k
      for (const l of links) {
        const s = l.source as unknown as GNode
        const t = l.target as unknown as GNode
        const hot = sel && (s.id === sel || t.id === sel)
        ctx.strokeStyle = hot ? colAccent : colLink
        ctx.globalAlpha = sel && !hot ? 0.3 : 1
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      const showAll = tf.current.k > 1.1 || nodes.length < 25
      ctx.font = `${12 / Math.max(tf.current.k, 0.6)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      for (const n of nodes) {
        const r = 4 + Math.sqrt(n.deg) * 2.2
        const dim = (sel && !nb.has(n.id)) || (fq && !n.label.toLowerCase().includes(fq))
        ctx.globalAlpha = dim ? 0.28 : 1
        ctx.fillStyle = n.color
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)
        ctx.fill()
        if (n.id === cur || n.id === sel) {
          ctx.lineWidth = 2 / tf.current.k
          ctx.strokeStyle = n.id === sel ? colAccent : colText
          ctx.stroke()
        }
        if (!dim && (showAll || n.id === cur || n.id === sel || nb.has(n.id) || (fq && n.label.toLowerCase().includes(fq)) || n.deg > 3)) {
          ctx.fillStyle = colText
          ctx.fillText(n.label, n.x!, n.y! + r + 12 / Math.max(tf.current.k, 0.6))
        }
      }
      ctx.restore()
      ctx.globalAlpha = 1
    }

    // 배치는 화면에 그리기 전에 한 번에 계산한다 (보이는 채로 풀리면 작게 떠서 버벅이며 커져 보인다)
    sim.current?.stop()
    const s = forceSimulation<GNode>(nodes)
      .force('link', forceLink<GNode, { source: string; target: string }>(links).id((d) => d.id).distance(mini ? 38 : 70).strength(0.7))
      .force('charge', forceManyBody().strength(mini ? -90 : -260))
      .force('collide', forceCollide<GNode>().radius((d) => 8 + Math.sqrt(d.deg) * 2))
      .force('x', forceX(0).strength(0.05))
      .force('y', forceY(0).strength(0.05))
      .force('center', forceCenter(0, 0))
      .stop()
    sim.current = s

    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 6])
      .on('zoom', (e) => {
        if (e.sourceEvent) touched = true
        tf.current = e.transform
        draw.current()
      })
    const sel = select(cv)
    sel.call(z)
    const fitView = () => {
      if (!nodes.length || !W) return
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of nodes) {
        x0 = Math.min(x0, n.x!); x1 = Math.max(x1, n.x!)
        y0 = Math.min(y0, n.y!); y1 = Math.max(y1, n.y!)
      }
      const pad = mini ? 50 : 70
      const k = Math.min(W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2), 2)
      const t = zoomIdentity.translate(W / 2 - ((x0 + x1) / 2) * k, H / 2 - ((y0 + y1) / 2) * k).scale(k)
      sel.call(z.transform, t)
    }
    const layout = () => {
      s.tick(nodes.length > 1500 ? 120 : nodes.length > 600 ? 200 : 300)
      ready = true
      fitView()
      draw.current()
      // 완성된 모습이 부드럽게 나타나도록
      cv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
    }
    fit()
    if (W) layout()
    const ro = new ResizeObserver(() => {
      fit()
      if (!W) return
      if (!ready) layout()
      else if (!touched) fitView() // 사이드바를 접고 펴는 등 크기가 바뀌면 맞춰서 다시 보여준다
    })
    ro.observe(box)

    const hit = (ev: MouseEvent) => {
      const r = cv.getBoundingClientRect()
      const x = (ev.clientX - r.left - tf.current.x) / tf.current.k
      const y = (ev.clientY - r.top - tf.current.y) / tf.current.k
      let best: GNode | null = null
      let bd = Infinity
      for (const n of nodes) {
        const rad = 4 + Math.sqrt(n.deg) * 2.2 + 10 / tf.current.k
        const d = Math.hypot(n.x! - x, n.y! - y)
        if (d < rad && d < bd) {
          best = n
          bd = d
        }
      }
      return best
    }
    const onClick = (ev: MouseEvent) => {
      const n = hit(ev)
      if (!n) return setSelected(null)
      if (stateRef.current.selected === n.id) useApp.getState().openNote(n.id)
      else setSelected(n.id)
    }
    cv.addEventListener('click', onClick)
    void byId

    return () => {
      s.stop()
      ro.disconnect()
      cv.removeEventListener('click', onClick)
      sel.on('.zoom', null)
    }
  }, [data, mini])

  useEffect(() => draw.current(), [selected, filter, current])

  const selNote = selected ? index.notes.get(selected) : null

  return (
    <div className={`graph ${mini ? 'mini' : ''}`}>
      {!mini && (
        <div className="graph-bar">
          <div className="seg">
            <button className={!isLocal ? 'on' : ''} onClick={() => setLocal(false)}>{t('전체')}</button>
            <button className={isLocal ? 'on' : ''} onClick={() => setLocal(true)} disabled={!current}>{t('현재 노트')}</button>
          </div>
          {isLocal && (
            <div className="stepper">
              <button onClick={() => setDepth((d) => Math.max(1, d - 1))}>−</button>
              <span>{t('깊이 {n}', { n: depth })}</span>
              <button onClick={() => setDepth((d) => Math.min(5, d + 1))}>＋</button>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> {t('고립 노트')}</label>
          <input className="graph-filter" placeholder={t('노드 찾기')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="graph-canvas" ref={wrap}>
        <canvas ref={canvas} />
        {!data.nodes.length && <div className="empty">{t('표시할 노트가 없습니다')}</div>}
        {!mini && selNote && (
          <div className="graph-card">
            <div>
              <b>{selNote.title}</b>
              <small>
                {t('나가는 링크 {out} · 백링크 {back}', { out: index.out.get(selected!)?.length ?? 0, back: index.back.get(selected!)?.length ?? 0 })}
              </small>
            </div>
            <button className="primary" onClick={() => useApp.getState().openNote(selected!)}>{t('열기')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
