// PC 호스트 저장 계층: "호스트 폴더"(평범한 파일 폴더)에 Vault 의 노트·파일을 두고, 버전(rev)·삭제 기록·복구 정보를 `.nosidian/` 에 관리한다.
// 설계: docs/SYNC-HOST.md. 이 파일은 순수 Node(fs) 모듈이다 — Electron 에 의존하지 않아 시험하기 쉽다. 네트워크·IPC 는 다른 파일이 맡는다.
//
// 원칙
//  - 호스트 폴더의 파일은 **정본의 한 형태**일 뿐 신뢰 대상이 아니다: 이 모듈은 어떤 파일도 열거나 실행하지 않는다(읽고 쓰기만).
//  - rev = `<epoch>-<gen>.<hash16>`: gen 은 경로별 단조 증가(내용 변경·삭제·재생성마다 +1), epoch 는 manifest 를 새로 만들 때 바뀐다
//    → A→B→A 로 되돌려도, 삭제 후 같은 내용으로 다시 만들어도, manifest 를 다시 만들어도 옛 rev 와 같아지지 않는다.
//  - 쓰기는 조건부(baseRev 가 현재 rev 와 같을 때만)이고 원자적이다: tmp 에 쓰고 fsync → journal → rename → manifest(임시+rename) → journal 삭제.
//    어느 단계에서 끊겨도 다음에 열 때 journal 로 복구한다.
//  - 삭제는 휴지통(.nosidian/trash)으로 옮기고 tombstone 을 남긴다. tombstone 은 "90일 경과 AND 모든 활성 기기가 확인(ack)"했을 때만 정리한다.
//  - 외부(탐색기 등)의 수정·추가·삭제·이동은 scan 에서 발견해 gen 을 올린다.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const META = '.nosidian'
const MAX_FILE = 25 * 1024 * 1024
const DAY = 86_400_000
const TRASH_DAYS = 90
const TOMB_DAYS = 90
const STALE_DEVICE_DAYS = 180
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

class HostError extends Error {
  /** status: HTTP 비슷한 코드(409 충돌 · 400 잘못된 요청 · 403 금지 · 404 없음 · 413 너무 큼 · 423 다른 프로세스가 사용 중 · 507 공간 부족 · 500 내부) */
  constructor(msg, status, code, extra) {
    super(msg)
    this.status = status
    this.code = code
    Object.assign(this, extra || {})
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** 호스트 폴더 안의 상대 경로 정리. 안전하지 않으면 null (상대·하위만, 숨김·상위·특수 문자·예약 이름 거절) */
function cleanRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 1000) return null
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':') || rel.startsWith('/')) return null
  const segs = rel.split('/')
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || s.startsWith('.')) return null
    if (/[<>"|?*\u0000-\u001f]/.test(s) || /[. ]$/.test(s) || WIN_RESERVED.test(s)) return null
  }
  return segs.join('/')
}

/** 모바일 → PC 쓰기에서 거부할 실행 파일 확장자(v1.41 에서 쓰기 API 가 사용한다). PC 사용자가 직접 넣은 파일은 막지 않는다 */
const EXEC_EXT = new Set(['exe', 'dll', 'sys', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'cpl', 'msc', 'reg', 'lnk', 'jar', 'apk'])
/** 확장자와 파일 머리(앞 4바이트 이상)로 실행 파일인지 본다. **보조 방어**다 — 진짜 방어선은 어떤 파일도 자동 실행하지 않는 것 */
function looksExecutable(name, head) {
  const ext = String(name).split('.').pop().toLowerCase()
  if (name.includes('.') && EXEC_EXT.has(ext)) return true
  if (head && head.length >= 4) {
    const h = Buffer.from(head)
    if (h[0] === 0x4d && h[1] === 0x5a) return true // PE: MZ
    if (h[0] === 0x7f && h[1] === 0x45 && h[2] === 0x4c && h[3] === 0x46) return true // ELF
    const m = h.readUInt32BE(0)
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return true // Mach-O · 유니버설
  }
  return false
}

/** 두 폴더가 같거나 한쪽이 다른 쪽을 포함하는가(공유 폴더와 호스트 폴더는 겹치면 안 된다) */
function overlaps(a, b) {
  const re = (p) => {
    try {
      return norm(fs.realpathSync.native(p))
    } catch {
      return norm(path.resolve(p))
    }
  }
  const x = re(a)
  const y = re(b)
  return x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep)
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return !!(e && e.code === 'EPERM')
  }
}

/**
 * 호스트 폴더를 연다. opts: { now?, hooks? } — hooks 는 시험에서 저장 단계 사이에 "비정상 종료"를 일으키는 지점이다.
 * 여는 순간 이전에 끊긴 쓰기를 복구하고(journal), manifest 가 망가졌으면 백업에서 되살리거나 디스크를 스캔해 다시 만든다.
 */
function openHost(dir, opts = {}) {
  const now = opts.now || (() => Date.now())
  const hooks = opts.hooks || {}
  const root = fs.realpathSync.native(dir)
  const meta = path.join(root, META)
  fs.mkdirSync(path.join(meta, 'tmp'), { recursive: true })
  fs.mkdirSync(path.join(meta, 'trash'), { recursive: true })
  const manifestFile = path.join(meta, 'manifest.json')
  const backupFile = path.join(meta, 'manifest.bak.json')
  const journalFile = path.join(meta, 'journal.json')
  const lockFile = path.join(meta, 'host.lock')

  // ── 단일 작성자: 다른 프로세스가 쓰고 있으면 열지 않는다 ──
  try {
    const l = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    if (l && Number.isInteger(l.pid) && l.pid !== process.pid && pidAlive(l.pid)) throw new HostError('host folder is in use by another process', 423, 'busy')
  } catch (e) {
    if (e instanceof HostError) throw e
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: now() }))
  const readme = path.join(meta, 'README.txt')
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, 'Nosidian 호스트 폴더의 관리 정보입니다. 이 폴더(.nosidian)는 수정하거나 지우지 마세요.\nThis .nosidian folder holds Nosidian sync metadata. Do not edit or delete it.\n')

  let m = null
  let rebuilt = false
  const validManifest = (v) => v && typeof v === 'object' && v.v === 1 && typeof v.epoch === 'string' && v.files && typeof v.files === 'object' && v.tombs && typeof v.tombs === 'object' && Number.isInteger(v.seq)
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      return null
    }
  }
  const fresh = () => ({ v: 1, epoch: crypto.randomBytes(3).toString('hex'), seq: 0, files: {}, tombs: {}, devices: {}, trash: [] })

  // ── manifest 불러오기(손상 → 백업 → 디스크 스캔으로 재생성) ──
  const main = readJson(manifestFile)
  if (validManifest(main)) m = main
  else {
    const bak = readJson(backupFile)
    if (fs.existsSync(manifestFile)) {
      try {
        fs.renameSync(manifestFile, path.join(meta, `manifest.corrupt-${now()}.json`)) // 손상본은 지우지 않고 남긴다
      } catch {
        /* noop */
      }
    }
    if (validManifest(bak)) m = bak
    else if (fs.existsSync(manifestFile) || fs.existsSync(backupFile)) {
      m = fresh() // 새 epoch: 이전 rev 를 가진 기기는 충돌로 보인다(조용히 덮어쓰지 않는다)
      rebuilt = true
    } else m = fresh()
  }
  m.devices = m.devices || {}
  m.trash = m.trash || []

  function saveManifest() {
    if (fs.existsSync(manifestFile)) {
      try {
        atomicWrite(backupFile, fs.readFileSync(manifestFile))
      } catch {
        /* 백업 실패는 치명적이지 않다 */
      }
    }
    atomicWrite(manifestFile, JSON.stringify(m))
  }

  const revOf = (e) => `${m.epoch}-${e.gen}.${e.hash.slice(0, 16)}`
  const tombRevOf = (t) => `${m.epoch}-${t.gen}.-`
  const nextSeq = () => ++m.seq

  const abs = (rel) => path.join(root, ...rel.split('/'))

  /** 폴더 안의 파일들(숨김·링크·.nosidian 제외) */
  function walk() {
    const out = []
    const visit = (dirAbs, rel, depth) => {
      if (depth > 30) return
      let items
      try {
        items = fs.readdirSync(dirAbs, { withFileTypes: true })
      } catch {
        return
      }
      for (const it of items) {
        if (it.name === META && !rel) continue
        if (!cleanRel(it.name)) continue
        if (it.isSymbolicLink()) continue
        const childRel = rel ? `${rel}/${it.name}` : it.name
        if (it.isDirectory()) visit(path.join(dirAbs, it.name), childRel, depth + 1)
        else if (it.isFile()) out.push(childRel)
      }
    }
    visit(root, '', 0)
    return out
  }

  // ── 쓰기 도중 끊긴 작업 복구 ──
  function recover() {
    const j = readJson(journalFile)
    if (!j) return { recovered: false }
    let did = 'discarded'
    try {
      if (j.op === 'put') {
        const target = abs(j.path)
        let h = null
        try {
          h = sha256(fs.readFileSync(target))
        } catch {
          /* 대상 없음 */
        }
        if (h && h === j.hash && (!m.files[j.path] || m.files[j.path].seq < j.seq)) {
          // rename 은 끝났고 manifest 만 못 갱신했다 → 이어서 반영(롤포워드)
          const st = fs.statSync(target)
          const tomb = m.tombs[j.path]
          if (tomb) delete m.tombs[j.path]
          m.files[j.path] = { gen: j.gen, hash: j.hash, size: j.size, mtimeMs: Math.round(st.mtimeMs), seq: j.seq, by: j.by, at: j.at }
          m.seq = Math.max(m.seq, j.seq)
          saveManifest()
          did = 'rolled-forward'
        }
        if (j.tmp) fs.rmSync(path.join(meta, 'tmp', j.tmp), { force: true })
      } else if (j.op === 'del') {
        const target = abs(j.path)
        if (!fs.existsSync(target) && (!m.tombs[j.path] || m.tombs[j.path].seq < j.seq)) {
          delete m.files[j.path]
          m.tombs[j.path] = { gen: j.gen, seq: j.seq, at: j.at, by: j.by }
          if (j.trashName && fs.existsSync(path.join(meta, 'trash', j.trashName))) m.trash.push({ path: j.path, name: j.trashName, at: j.at, gen: j.gen })
          m.seq = Math.max(m.seq, j.seq)
          saveManifest()
          did = 'rolled-forward'
        }
      }
    } finally {
      fs.rmSync(journalFile, { force: true })
    }
    return { recovered: true, did }
  }
  const recovery = recover()
  // journal 이 없는 임시 파일은 쓰다 끊긴 찌꺼기다(내용은 아직 대상 위치에 반영되지 않았다) — 치운다
  try {
    for (const f of fs.readdirSync(path.join(meta, 'tmp'))) fs.rmSync(path.join(meta, 'tmp', f), { force: true })
  } catch {
    /* noop */
  }

  /** 파일 하나를 manifest 와 맞춘다(크기·mtime 이 같으면 건너뛰고, 다르면 해시를 다시 계산). 바뀌었으면 gen+1 */
  function reconcileOne(rel, by = 'external') {
    const e = m.files[rel]
    let st = null
    try {
      st = fs.lstatSync(abs(rel))
    } catch {
      /* 없음 */
    }
    if (!st || !st.isFile()) {
      if (e) {
        delete m.files[rel]
        m.tombs[rel] = { gen: e.gen + 1, seq: nextSeq(), at: now(), by }
        return 'deleted'
      }
      return null
    }
    if (e && e.size === st.size && e.mtimeMs === Math.round(st.mtimeMs)) return null
    const buf = fs.readFileSync(abs(rel))
    const hash = sha256(buf)
    if (e && e.hash === hash) {
      e.mtimeMs = Math.round(st.mtimeMs) // 내용은 같고 시간만 바뀜
      e.size = st.size
      return null
    }
    const tomb = m.tombs[rel]
    const gen = e ? e.gen + 1 : tomb ? tomb.gen + 1 : 1
    delete m.tombs[rel]
    m.files[rel] = { gen, hash, size: st.size, mtimeMs: Math.round(st.mtimeMs), seq: nextSeq(), by, at: now() }
    return e ? 'modified' : 'added'
  }

  /** 디스크를 훑어 외부 변경(수정·추가·삭제·이동)을 manifest 에 반영한다. 반환: 바뀐 경로들 */
  function scan(o = {}) {
    const prevHash = {}
    for (const [p, e] of Object.entries(m.files)) prevHash[p] = e.hash
    const disk = new Set(walk())
    const changes = { added: [], modified: [], deleted: [], moved: [] }
    for (const rel of disk) {
      if (o.deep && m.files[rel]) m.files[rel].mtimeMs = -1 // 깊은 점검: 시간 비교를 건너뛰고 해시를 다시 본다
      const r = reconcileOne(rel)
      if (r) changes[r].push(rel)
    }
    for (const rel of Object.keys(m.files)) {
      if (disk.has(rel)) continue
      if (reconcileOne(rel)) changes.deleted.push(rel)
    }
    // 같은 내용이 사라진 경로에서 새 경로로 나타났으면 "이동"일 수 있다는 힌트(자동으로 처리하지는 않는다: 삭제 + 새 파일로 기록된다)
    for (const d of changes.deleted) {
      const to = changes.added.find((a) => m.files[a] && m.files[a].hash === prevHash[d])
      if (to) changes.moved.push({ from: d, to })
    }
    saveManifest()
    return changes
  }

  if (rebuilt) scan({ deep: true })
  else scan()

  function currentRev(rel) {
    reconcileOne(rel)
    const e = m.files[rel]
    if (e) return { rev: revOf(e), exists: true }
    const t = m.tombs[rel]
    if (t) return { rev: tombRevOf(t), exists: false, deleted: true }
    return { rev: null, exists: false }
  }

  const checkPath = (rel) => {
    const c = cleanRel(rel)
    if (!c) throw new HostError('bad path', 400, 'badPath')
    return c
  }
  const caseClash = (rel) => {
    const l = rel.toLowerCase()
    return Object.keys(m.files).find((p) => p !== rel && p.toLowerCase() === l)
  }

  function ensureParent(rel) {
    const target = abs(rel)
    const parent = path.dirname(target)
    fs.mkdirSync(parent, { recursive: true })
    const real = fs.realpathSync.native(parent)
    if (!(norm(real) + path.sep).startsWith(norm(root) + path.sep)) throw new HostError('outside host folder', 403, 'outside')
    // 대상이 이미 있으면 링크가 아닌 일반 파일이어야 한다
    try {
      const st = fs.lstatSync(target)
      if (st.isSymbolicLink() || !st.isFile()) throw new HostError('target is not a regular file', 403, 'link')
    } catch (e) {
      if (e instanceof HostError) throw e
    }
    return target
  }

  const api = {
    root,
    /** 이 폴더를 처음 만들었는가(= 비어 있는 manifest) */
    info: () => ({ epoch: m.epoch, seq: m.seq, rebuilt, recovery, files: Object.keys(m.files).length, tombs: Object.keys(m.tombs).length }),
    scan: (o) => scan(o),

    /** 목록: 먼저 외부 변경을 반영한다. entries 는 현재 파일, tombs 는 삭제 기록 */
    list() {
      scan()
      return {
        epoch: m.epoch,
        seq: m.seq,
        entries: Object.entries(m.files)
          .map(([p, e]) => ({ path: p, rev: revOf(e), size: e.size, mtime: e.mtimeMs, hash: e.hash }))
          .sort((a, b) => a.path.localeCompare(b.path, 'ko')),
        tombs: Object.entries(m.tombs).map(([p, t]) => ({ path: p, rev: tombRevOf(t), at: t.at })),
      }
    },

    /** 파일 읽기: 읽기 직전에 이 경로를 manifest 와 맞춰, 돌려주는 rev 가 내용과 항상 일치한다 */
    read(rel) {
      const p = checkPath(rel)
      const r = currentRev(p)
      if (!r.exists) {
        saveManifest()
        throw new HostError('not found', 404, 'notFound')
      }
      const target = abs(p)
      const real = fs.realpathSync.native(target)
      if (norm(real) !== norm(target)) throw new HostError('forbidden', 403, 'link')
      const st = fs.statSync(target)
      if (st.size > MAX_FILE) throw new HostError('file too large', 413, 'tooLarge')
      const bytes = fs.readFileSync(target)
      saveManifest()
      return { bytes, rev: r.rev, hash: m.files[p].hash }
    },

    /**
     * 쓰기(조건부·원자적). baseRev: 내가 마지막으로 본 rev — 현재와 같을 때만 쓴다.
     *  - 새로 만들기: baseRev=null (파일도 삭제 기록도 없어야 한다. 삭제 기록 위에 만들려면 그 tombstone rev 를 baseRev 로)
     */
    put(rel, bytes, baseRev, by = 'app') {
      const p = checkPath(rel)
      if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
      if (bytes.length > MAX_FILE) throw new HostError('file too large', 413, 'tooLarge')
      const clash = caseClash(p)
      if (clash) throw new HostError(`path differs only by case from ${clash}`, 409, 'case', { currentRev: null })
      const cur = currentRev(p)
      if ((baseRev ?? null) !== cur.rev) throw new HostError('base revision does not match', 409, 'conflict', { currentRev: cur.rev, deleted: !!cur.deleted, exists: cur.exists })
      const target = ensureParent(p)
      const hash = sha256(bytes)
      const old = m.files[p]
      const gen = old ? old.gen + 1 : m.tombs[p] ? m.tombs[p].gen + 1 : 1
      const seq = m.seq + 1
      const tmpName = crypto.randomUUID()
      const tmpFile = path.join(meta, 'tmp', tmpName)
      const fd = fs.openSync(tmpFile, 'w')
      try {
        fs.writeSync(fd, bytes)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      hooks.afterTmp?.()
      atomicWrite(journalFile, JSON.stringify({ op: 'put', path: p, tmp: tmpName, hash, size: bytes.length, gen, seq, by, at: now() }))
      hooks.afterJournal?.()
      fs.renameSync(tmpFile, target)
      hooks.afterRename?.()
      const st = fs.statSync(target)
      delete m.tombs[p]
      m.files[p] = { gen, hash, size: bytes.length, mtimeMs: Math.round(st.mtimeMs), seq, by, at: now() }
      m.seq = seq
      saveManifest()
      hooks.afterManifest?.()
      fs.rmSync(journalFile, { force: true })
      return { rev: revOf(m.files[p]), seq }
    },

    /** 삭제(조건부): 파일은 휴지통으로 옮기고 삭제 기록(tombstone)을 남긴다 */
    del(rel, baseRev, by = 'app') {
      const p = checkPath(rel)
      const cur = currentRev(p)
      if (!cur.exists) throw new HostError(cur.deleted ? 'already deleted' : 'not found', cur.deleted ? 409 : 404, cur.deleted ? 'conflict' : 'notFound', { currentRev: cur.rev, deleted: !!cur.deleted })
      if ((baseRev ?? null) !== cur.rev) throw new HostError('base revision does not match', 409, 'conflict', { currentRev: cur.rev })
      const e = m.files[p]
      const seq = m.seq + 1
      const trashName = `${seq}-${path.basename(p)}`
      atomicWrite(journalFile, JSON.stringify({ op: 'del', path: p, trashName, gen: e.gen + 1, seq, by, at: now() }))
      hooks.afterJournal?.()
      fs.renameSync(abs(p), path.join(meta, 'trash', trashName))
      hooks.afterRename?.()
      delete m.files[p]
      m.tombs[p] = { gen: e.gen + 1, seq, at: now(), by }
      m.trash.push({ path: p, name: trashName, at: now(), gen: e.gen })
      m.seq = seq
      saveManifest()
      hooks.afterManifest?.()
      fs.rmSync(journalFile, { force: true })
      return { rev: tombRevOf(m.tombs[p]), seq }
    },

    // ── 기기와 확인(ack): tombstone 정리 조건 ──
    registerDevice(id, info = {}) {
      if (!m.devices[id]) m.devices[id] = { ackSeq: 0, createdAt: now(), lastSeen: now(), ...info }
      saveManifest()
    },
    /** 이 기기가 seq 까지 반영을 마쳤다 */
    ack(id, seq) {
      const d = m.devices[id] || (m.devices[id] = { ackSeq: 0, createdAt: now(), lastSeen: now() })
      d.ackSeq = Math.max(d.ackSeq, Math.min(seq, m.seq))
      d.lastSeen = now()
      saveManifest()
    },
    removeDevice(id) {
      delete m.devices[id]
      saveManifest()
    },
    devices: () => Object.entries(m.devices).map(([id, d]) => ({ id, ...d })),
    /** 오래 접속하지 않은 기기(기본 180일): 다시 연결할 때 최초 연결과 같은 미리보기가 필요하다 */
    staleDevices(days = STALE_DEVICE_DAYS) {
      return Object.entries(m.devices).filter(([, d]) => now() - d.lastSeen > days * DAY).map(([id]) => id)
    },

    /**
     * 정리: 휴지통은 90일이 지나면 비우고, tombstone 은 90일이 지났고 **모든 활성 기기가 확인(ackSeq ≥ tombstone.seq)** 했을 때만 지운다.
     * 날짜만 지났다고 지우지 않는다(오래 꺼져 있던 기기의 파일이 되살아나는 것을 막는다).
     */
    gc() {
      const t = now()
      let trashed = 0
      let tombs = 0
      const keepTrash = []
      for (const x of m.trash) {
        if (t - x.at > TRASH_DAYS * DAY) {
          fs.rmSync(path.join(meta, 'trash', x.name), { force: true })
          trashed++
        } else keepTrash.push(x)
      }
      m.trash = keepTrash
      const active = Object.values(m.devices)
      for (const [p, tomb] of Object.entries(m.tombs)) {
        if (t - tomb.at < TOMB_DAYS * DAY) continue
        if (active.every((d) => d.ackSeq >= tomb.seq)) {
          delete m.tombs[p]
          tombs++
        }
      }
      saveManifest()
      return { trashed, tombs }
    },
    trash: () => m.trash.map((x) => ({ ...x })),
    /** 휴지통 목록(복구 화면용): 최근에 지운 것이 위. 내용이 이미 사라진 항목은 뺀다 */
    trashList() {
      const out = []
      for (const x of m.trash) {
        let size = null
        try {
          size = fs.statSync(path.join(meta, 'trash', x.name)).size
        } catch {
          continue // 내용이 없다(복구할 수 없다)
        }
        out.push({ name: x.name, path: x.path, at: x.at, size })
      }
      return out.sort((a, b) => b.at - a.at)
    },
    /**
     * 휴지통에서 되살린다. 원래 자리가 비어 있으면 거기로(삭제 기록 위에 쓰는 것이라 그 rev 를 baseRev 로), 이미 다른 파일이 있으면
     * 덮어쓰지 않고 `이름 (복구).확장자` 로. 쓰기는 평범한 put 이라 조건부·원자적이다. 휴지통 항목은 되살린 뒤에 지운다(실패해도 데이터는 안전).
     */
    restoreTrash(name, by = 'app') {
      const x = m.trash.find((t) => t.name === name)
      if (!x) throw new HostError('not in trash', 404, 'notFound')
      const bytes = api.readTrash(name)
      const cur = currentRev(x.path)
      let dest = x.path
      let baseRev = null
      if (!cur.exists && !caseClash(x.path)) {
        baseRev = cur.rev ?? null // 삭제 기록이 있으면 그 rev
      } else {
        const dot = path.posix.extname(x.path)
        const stem = dot ? x.path.slice(0, -dot.length) : x.path
        for (let n = 1; ; n++) {
          dest = `${stem} (복구${n > 1 ? ' ' + n : ''})${dot}`
          const c = currentRev(dest)
          if (c.rev === null && !caseClash(dest)) break // 파일도 삭제 기록도 없는 이름
        }
        baseRev = null
      }
      const r = api.put(dest, bytes, baseRev, by)
      fs.rmSync(path.join(meta, 'trash', name), { force: true })
      m.trash = m.trash.filter((t) => t.name !== name)
      saveManifest()
      return { path: dest, rev: r.rev, seq: r.seq, renamed: dest !== x.path }
    },
    /** 휴지통에서 되살린 파일 내용(복구 화면용). 되돌리는 것은 put 으로 한다 */
    readTrash(name) {
      if (!/^[0-9]+-[^/\\]+$/.test(name)) throw new HostError('bad name', 400, 'badPath')
      return fs.readFileSync(path.join(meta, 'trash', name))
    },

    /**
     * 스냅샷: 호스트 폴더의 파일과 manifest, (선택) PC 앱 Vault 의 노트 내용을 `.nosidian/snapshots/<시각>/` 에 복사한다.
     * 공간이 부족하거나 복사에 실패하면 예외 — 호출한 쪽은 **동기화를 시작하지 않아야** 한다.
     * 보관은 최근 3개 또는 30일(둘 중 먼저).
     */
    snapshot(extra = {}) {
      scan()
      const files = Object.keys(m.files)
      const total = files.reduce((s, p) => s + m.files[p].size, 0) + (extra.vaultNotes ? Buffer.byteLength(JSON.stringify(extra.vaultNotes)) : 0)
      try {
        let free
        if (opts.freeBytes) free = opts.freeBytes(root)
        else {
          const sf = fs.statfsSync(root)
          free = Number(sf.bavail) * Number(sf.bsize)
        }
        if (free < total * 1.1 + 50 * 1024 * 1024) throw new HostError(`not enough free space (need ~${Math.ceil(total / 1048576)}MB)`, 507, 'noSpace', { need: total, free })
      } catch (e) {
        if (e instanceof HostError) throw e // statfs 를 못 쓰는 환경은 복사 자체의 성공 여부로 판단한다
      }
      const ts = new Date(now()).toISOString().replace(/[:.]/g, '-')
      const dirSnap = path.join(meta, 'snapshots', ts)
      try {
        for (const p of files) {
          const dest = path.join(dirSnap, 'files', ...p.split('/'))
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(abs(p), dest)
        }
        fs.mkdirSync(dirSnap, { recursive: true })
        fs.copyFileSync(manifestFile, path.join(dirSnap, 'manifest.json'))
        if (extra.vaultNotes) fs.writeFileSync(path.join(dirSnap, 'vault-notes.json'), JSON.stringify(extra.vaultNotes))
        fs.writeFileSync(path.join(dirSnap, 'meta.json'), JSON.stringify({ at: now(), files: files.length, bytes: total, label: extra.label || '' }))
      } catch (e) {
        fs.rmSync(dirSnap, { recursive: true, force: true })
        if (e instanceof HostError) throw e
        throw new HostError(`snapshot failed: ${e && e.message}`, 500, 'snapshot')
      }
      api.pruneSnapshots()
      return { id: ts, files: files.length, bytes: total }
    },
    snapshots() {
      const base = path.join(meta, 'snapshots')
      let names = []
      try {
        names = fs.readdirSync(base)
      } catch {
        /* 없음 */
      }
      return names
        .map((id) => ({ id, ...(readJson(path.join(base, id, 'meta.json')) || {}), hasVault: fs.existsSync(path.join(base, id, 'vault-notes.json')) }))
        .filter((s) => s.at)
        .sort((a, b) => b.at - a.at)
    },
    pruneSnapshots() {
      const list = api.snapshots()
      list.forEach((s, i) => {
        if (i >= 3 || now() - s.at > 30 * DAY) fs.rmSync(path.join(meta, 'snapshots', s.id), { recursive: true, force: true })
      })
    },
    /** 스냅샷에 담은 PC 앱 Vault 의 노트(복원용) */
    readSnapshotVault(id) {
      if (!/^[0-9TZ-]+$/.test(id)) throw new HostError('bad id', 400, 'badPath')
      return readJson(path.join(meta, 'snapshots', id, 'vault-notes.json'))
    },

    close() {
      try {
        const l = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
        if (l.pid === process.pid) fs.rmSync(lockFile, { force: true })
      } catch {
        /* noop */
      }
    },
  }
  saveManifest()
  return api
}

module.exports = { openHost, HostError, cleanRel, looksExecutable, overlaps, EXEC_EXT, MAX_FILE, META }
