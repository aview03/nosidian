import { t, type LangPref } from './i18n'
export interface NoteFile {
  path: string
  content: string
  sha: string | null // 원격 blob sha (새 파일이면 null)
  dirty: boolean
  deleted?: boolean
  mtime: number
  conflict?: { sha: string; content: string } // 원격과 충돌 시 원격 버전
  base?: string // 내가 고치기 시작할 때의 내용(= 마지막 동기화본). 원격과 갈라졌을 때 줄 단위로 합치는 기준. 고치는 중(dirty)일 때만 있다
}

export interface AssetMeta {
  path: string
  sha: string | null
  id?: string
}

export interface GithubCfg {
  kind: 'github'
  owner: string
  repo: string
  branch: string
  token: string
}
export type RepoCfg = GithubCfg

export type CloudKind = 'gdrive' | 'onedrive'
export interface CloudCfg {
  kind: CloudKind
  clientId: string
  folder: string
  access: string
  refresh: string
  expires: number
}

/** 이 PC 의 호스트 폴더(클라우드 없이). PC 앱에서만 연결한다 — 폰은 v1.42 의 "내 PC" 연결을 쓴다 */
export interface HostCfg {
  kind: 'host'
  /** 호스트 폴더(표시용; 실제 경로는 메인 프로세스가 관리한다) */
  dir: string
}
/** 폰의 "내 PC" 연결(PC 앱의 호스트 폴더와 HTTPS 로 맞춘다). 주소·토큰은 별도 보안 저장소(pcHost.ts)에 있고 여기엔 표시용 이름만 둔다 */
export interface PcHostCfg {
  kind: 'pchost'
  name: string
  folder?: string
}
export type RemoteCfg = GithubCfg | CloudCfg | HostCfg | PcHostCfg
export type SyncKind = RemoteCfg['kind']
/** 로그인해서 쓰는 저장소(GitHub·Google Drive·OneDrive). 호스트 폴더는 로그인이 없다 */
export type AccountKind = Exclude<SyncKind, 'host' | 'pchost'>
export const SYNC_LABEL: Record<SyncKind, string> = { github: 'GitHub', gdrive: 'Google Drive', onedrive: 'OneDrive', host: '내 PC 폴더', pchost: '내 PC' }
/** 연결을 한 줄로 설명(설정·vault 목록 표시용) */
export function remoteDetail(r: RemoteCfg): string {
  return r.kind === 'github' ? `${r.owner}/${r.repo}` : r.kind === 'host' ? r.dir : r.kind === 'pchost' ? [r.name, r.folder].filter(Boolean).join(' · ') : r.folder
}

/** vault 하나 = 노트 저장소(IndexedDB) 하나 + 동기화 연결 하나 */
export interface VaultMeta {
  id: string
  name: string
  remote: RemoteCfg | null // null = 로컬 전용
  bookmarks: string[]
  recent: string[]
  lastSync: number | null
}

export const DEFAULT_VAULT_ID = 'default' // 이전 버전의 단일 vault (IndexedDB 이름 'amsidian' 그대로 사용)

export interface Settings {
  // ── 공통 ──
  theme: 'auto' | 'light' | 'dark'
  fontSize: number
  dailyFolder: string
  startMode: 'read' | 'edit'
  showRecent: boolean
  lang: LangPref // 'auto' = 시스템 언어를 따른다
  leftOpen: boolean // PC: 왼쪽(파일·검색) 사이드바
  rightOpen: boolean // PC: 오른쪽(링크·목차) 사이드바
  calHolidays: boolean // 캘린더에 공휴일 표시
  calLunar: boolean // 캘린더에 음력 표시
  remindMin: number // 일정 N분 전 알림 (0 = 끔)
  myName: string // 내 이름(쉼표로 여러 개): 내 업무에서 담당자가 나인 일만 모아 볼 때 쓴다
  persona: string | null // 내가 하는 일(역할): 내 업무 홈의 기본 구성을 고르는 데 쓴다. null = 아직 안 정함
  vaults: VaultMeta[]
  activeVault: string | null
  // ── 활성 vault 값의 사본 (화면 코드가 그대로 읽는다. 바뀌면 vaults 에도 반영) ──
  remote: RemoteCfg | null
  bookmarks: string[]
  recent: string[]
  lastSync: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  fontSize: 17,
  dailyFolder: 'Daily',
  startMode: 'read',
  showRecent: true,
  lang: 'auto',
  leftOpen: true,
  rightOpen: true,
  calHolidays: true,
  calLunar: true,
  remindMin: 0,
  myName: '',
  persona: null,
  vaults: [],
  activeVault: null,
  remote: null,
  bookmarks: [],
  recent: [],
  lastSync: null,
}

/** 연결 정보로 vault 기본 이름을 짓는다 */
export function defaultVaultName(r: RemoteCfg | null): string {
  if (!r) return t('내 노트')
  return remoteDetail(r)
}
