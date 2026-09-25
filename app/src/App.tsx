import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowLeft, ArrowUpRight, Bell, Building2, Camera, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, ClipboardList, Download, Eye, FileCheck2, FileText, Info, LogOut, Menu, MessageSquareText, Paperclip, Pencil, Phone, Plus, RotateCcw, Search, Send, ShieldCheck, Sparkles, Trash2, UploadCloud, Users, X, XCircle } from 'lucide-react'
import './App.css'
import versionData from '../version.json'

type ChangelogEntry = { version: string; date: string; notes: string[] }
const CURRENT_VERSION: string = versionData.version
const CHANGELOG: ChangelogEntry[] = versionData.changelog
const lastSeenVersionKey = 'sisCredLastSeenVersion'
// Compara versões "x.y.z" numericamente (não como texto, onde "10" < "9").
const compareVersions = (a: string, b: string) => {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0)
    if (diff) return diff
  }
  return 0
}

type Role = 'vendedor' | 'analista' | 'gestao' | 'admin'
type BackendRole = 'VENDEDOR' | 'ANALISTA' | 'GESTORA' | 'ADMIN'
type Status = 'RECEBIDA' | 'EM_ANALISE' | 'AGUARDANDO_GESTAO' | 'APROVADA' | 'NEGADA' | 'DEVOLVIDA'
type Request = { id: number; protocol: string; clientCode: string; companyName: string; tradeName: string | null; cnpj: string; stateRegistration: string | null; phone: string | null; address: string | null; invoiceEmail: string | null; financeEmail: string | null; contactName: string | null; contactEmail: string | null; requestPurpose: string | null; purchaseAuthorization: string | null; deliveryType: string | null; deliveryLocation: string | null; deliveryAddress: string | null; requestedLimit: number | null; approvedLimit: number | null; origin: string | null; sellerNotes: string | null; returnReason: string | null; status: Status; sellerName: string; sellerEmail: string; sellerCode: string | null; sellerStore: string | null; sellerManagerName: string | null; sellerWhatsapp: string | null; submittedAt: string; praticoConfirmedAt: string | null; praticoConfirmedByName: string | null }
type AuthUser = { id: number; name: string; email: string; role: BackendRole; avatarUrl?: string | null }
type AppNotification = { id: string; title: string; subtitle: string; onClick: () => void }

const emptyRequest: Request = { id: 0, protocol: '', clientCode: '', companyName: '', tradeName: null, cnpj: '', stateRegistration: null, phone: null, address: null, invoiceEmail: null, financeEmail: null, contactName: null, contactEmail: null, requestPurpose: null, purchaseAuthorization: null, deliveryType: null, deliveryLocation: null, deliveryAddress: null, requestedLimit: null, approvedLimit: null, origin: null, sellerNotes: null, returnReason: null, status: 'RECEBIDA', sellerName: '', sellerEmail: '', sellerCode: null, sellerStore: null, sellerManagerName: null, sellerWhatsapp: null, submittedAt: '', praticoConfirmedAt: null, praticoConfirmedByName: null }
const apiUrl = import.meta.env.DEV ? 'http://localhost:3001' : ''
const tokenKey = 'sisCredToken'
const userKey = 'sisCredUser'
const roleMap: Record<BackendRole, Role> = { VENDEDOR: 'vendedor', ANALISTA: 'analista', GESTORA: 'gestao', ADMIN: 'admin' }
const money = (value: number | null) => (value == null ? 'A definir' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const whatsappLink = (raw: string) => `https://wa.me/55${raw.replace(/\D/g, '')}`
const formatCnpj = (raw: string) => {
  let clean = ''
  for (const char of raw.toUpperCase()) {
    if (clean.length >= 14) break
    const isDigit = /[0-9]/.test(char)
    const isLetter = /[A-Z]/.test(char)
    if (!isDigit && !isLetter) continue
    if (clean.length >= 12 && !isDigit) continue
    clean += char
  }
  let masked = ''
  for (let i = 0; i < clean.length; i++) {
    if (i === 2 || i === 5) masked += '.'
    else if (i === 8) masked += '/'
    else if (i === 12) masked += '-'
    masked += clean[i]
  }
  return masked
}
// Até 11 dígitos numéricos é tratado como CPF; com letras ou mais caracteres, como CNPJ.
const formatDocument = (raw: string) => {
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (alnum.length > 11 || /[A-Z]/.test(alnum)) return formatCnpj(raw)
  return alnum.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}
type PraticoClient = { clientCode: string; companyCode: number | null; personType: 'F' | 'J'; document: string | null; companyName: string | null; tradeName: string | null; stateRegistration: string | null; phones: string[]; email: string | null; contactName: string | null; address: string | null }
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || '?'
const avatarMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
const statusLabel: Record<Status, string> = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', AGUARDANDO_GESTAO: 'Aguardando gestão', APROVADA: 'Aprovada', NEGADA: 'Negada', DEVOLVIDA: 'Devolvida para ajustes' }

const apiFetch = async (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem(tokenKey)
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers })
  if (response.status === 401 && token) {
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(userKey)
    window.location.reload()
  }
  return response
}

type DepsExtractedData = { classification: string; suggestedLimit: number; positivePercent: number; negativePercent: number; risk: string | null; protests: { count: number; value: number } | null; pefin: { count: number; value: number } | null; paymentHistoryPercent: number | null; consultationsCount: number | null }
type DossierDocument = { id: number; documentType: 'CONTRATO_SOCIAL' | 'SERASA' | 'DEPS' | 'CNPJ' | 'INSCRICAO_ESTADUAL' | 'OUTRO'; originalName: string; fileSize: number; extractedData: DepsExtractedData | null; uploadedAt: string; uploadedByName: string }

const uploadDocument = (requestId: number, documentType: string, file: File) => {
  const data = new FormData()
  data.append('documentType', documentType)
  data.append('file', file)
  return apiFetch(`/api/credit-requests/${requestId}/documents`, { method: 'POST', body: data })
}

const listDocuments = async (requestId: number): Promise<DossierDocument[]> => {
  const response = await apiFetch(`/api/credit-requests/${requestId}/documents`)
  if (!response.ok) return []
  return response.json()
}

const viewDocument = async (documentId: number) => {
  const response = await apiFetch(`/api/documents/${documentId}/file`)
  if (!response.ok) return
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

const loadStoredUser = (): AuthUser | null => {
  const token = localStorage.getItem(tokenKey)
  const raw = localStorage.getItem(userKey)
  if (!token || !raw) return null
  try { return JSON.parse(raw) as AuthUser } catch { return null }
}

// Toque curto e discreto (dois tons sintetizados) para acompanhar as notificações em tempo
// real — evita depender de um arquivo de áudio e funciona mesmo offline.
let notificationAudioContext: AudioContext | null = null
const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    if (!notificationAudioContext) notificationAudioContext = new AudioContextClass()
    const ctx = notificationAudioContext
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.11, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)
    gain.connect(ctx.destination)
    const playTone = (frequency: number, start: number, duration: number) => {
      const oscillator = ctx.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      oscillator.connect(gain)
      oscillator.start(now + start)
      oscillator.stop(now + start + duration)
    }
    playTone(880, 0, 0.14)
    playTone(1175, 0.12, 0.18)
  } catch { /* áudio indisponível (ex.: navegador bloqueou antes de qualquer interação) — a notificação visual já é suficiente */ }
}

type RequestChangedEvent = { requestId: number; reason: string; actorId?: number; sellerId?: number; protocol?: string; companyName?: string; status?: Status }

// Decide se um evento em tempo real (vindo do SSE) merece um aviso para o usuário logado —
// nunca para quem provocou a própria mudança, já que essa pessoa recebe feedback local na hora.
const describeRequestChangeNotification = (event: RequestChangedEvent, user: AuthUser): string | null => {
  if (event.actorId != null && event.actorId === user.id) return null
  const who = event.companyName ? `${event.companyName}${event.protocol ? ` (${event.protocol})` : ''}` : event.protocol || 'uma solicitação'
  if (user.role === 'VENDEDOR') {
    if (event.sellerId !== user.id) return null
    switch (event.reason) {
      case 'return-to-seller': return `Cadastro devolvido para ajustes: ${who}.`
      case 'decision': return event.status === 'APROVADA' ? `Crédito aprovado: ${who}.` : `Crédito negado: ${who}.`
      case 'reopen': return `Solicitação reaberta e aprovada: ${who}.`
      case 'pratico-confirm': return `Atualização confirmada no sistema Prático: ${who}.`
      default: return null
    }
  }
  if (user.role === 'ANALISTA') {
    switch (event.reason) {
      case 'created': return `Novo cadastro recebido: ${who}.`
      case 'resent': return `Cadastro corrigido e reenviado: ${who}.`
      case 'decision': return `Decisão registrada para ${who} — confirme a atualização no Prático.`
      case 'reopen': return `Solicitação reaberta para ${who} — confirme a atualização no Prático.`
      default: return null
    }
  }
  return null
}

type ToastKind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: ToastKind; message: string }
const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {})
const useToast = () => useContext(ToastContext)
const toastIcon: Record<ToastKind, ReactNode> = { success: <CheckCircle2 size={19} />, error: <XCircle size={19} />, info: <Info size={19} /> }

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const dismiss = (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id))
  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = ++nextId.current
    setToasts((list) => [...list, { id, kind, message }])
    setTimeout(() => dismiss(id), 5200)
  }, [])
  return <ToastContext.Provider value={pushToast}>
    {children}
    <div className="toast-stack">
      {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
        <div className="toast-icon">{toastIcon[toast.kind]}</div>
        <p>{toast.message}</p>
        <button type="button" className="toast-close" onClick={() => dismiss(toast.id)}><X size={14} /></button>
        <span className="toast-timer"></span>
      </div>)}
    </div>
  </ToastContext.Provider>
}

function ConfirmationBurst({ ok, title, message, onDone }: { ok: boolean; title: string; message: string; onDone: () => void }) {
  useEffect(() => {
    const timeout = setTimeout(onDone, 2200)
    return () => clearTimeout(timeout)
  }, [onDone])
  return <div className="burst-backdrop" onClick={onDone}>
    <div className={ok ? 'burst-card' : 'burst-card burst-card-fail'} onClick={(event) => event.stopPropagation()}>
      <div className="burst-icon-ring">
        {ok
          ? <svg viewBox="0 0 52 52" className="burst-check"><circle cx="26" cy="26" r="24" className="burst-check-circle" /><path fill="none" d="M14 27l7 7 17-17" className="burst-check-mark" /></svg>
          : <svg viewBox="0 0 52 52" className="burst-check burst-x"><circle cx="26" cy="26" r="24" className="burst-check-circle" /><path fill="none" d="M17 17l18 18M35 17L17 35" className="burst-check-mark" /></svg>}
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  </div>
}

function WhatsNewModal({ entries, onClose }: { entries: ChangelogEntry[]; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 480 }}>
    <div className="modal-head"><div><p className="eyebrow">NOVIDADES</p><h2>O que mudou no Sis-Cred</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div>
    <div style={{ margin: '4px 0 20px' }}>{entries.map((entry) => <div key={entry.version} style={{ marginBottom: 16 }}>
      <strong style={{ display: 'block', fontSize: 13, color: '#233347', marginBottom: 5 }}>Versão {entry.version} · {new Date(`${entry.date}T00:00:00`).toLocaleDateString('pt-BR')}</strong>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#5b6a7d', lineHeight: 1.65 }}>{entry.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </div>)}</div>
    <div className="modal-actions"><button type="button" className="primary-btn" onClick={onClose}><Check size={17} /> Entendi</button></div>
  </div></div>
}

function App() {
  const [resetToken, setResetToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('resetToken'))
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)
  const [requests, setRequests] = useState<Request[]>([])
  const [selected, setSelected] = useState<Request>(emptyRequest)
  const pushToast = useToast()
  const [burst, setBurst] = useState<{ ok: boolean; title: string; message: string } | null>(null)
  const [whatsNewEntries, setWhatsNewEntries] = useState<ChangelogEntry[] | null>(null)
  const [decision, setDecision] = useState<'APROVADA' | 'NEGADA' | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [view, setView] = useState<'main' | 'users' | 'audit' | 'decisions' | 'requests'>('main')
  const [editingRequest, setEditingRequest] = useState<Request | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [notifMenuOpen, setNotifMenuOpen] = useState(false)
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const notifMenuRef = useRef<HTMLDivElement>(null)
  const role = user ? roleMap[user.role] : null
  const [pageLoading, setPageLoading] = useState(false)
  useEffect(() => {
    setPageLoading(true)
    const timeout = setTimeout(() => setPageLoading(false), 420)
    return () => clearTimeout(timeout)
  }, [view, role])
  useEffect(() => {
    if (!user?.avatarUrl) { setAvatarSrc(null); return }
    let cancelled = false
    let objectUrl: string | null = null
    apiFetch(user.avatarUrl).then((response) => (response.ok ? response.blob() : null)).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setAvatarSrc(objectUrl)
    }).catch(() => {})
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [user?.avatarUrl])
  const saveProfilePatch = (patch: Partial<AuthUser>) => {
    setUser((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      localStorage.setItem(userKey, JSON.stringify(next))
      return next
    })
    setShowEditProfile(false)
    pushToast('success', 'Perfil atualizado com sucesso.')
  }
  useEffect(() => { setView('main') }, [role])
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileMenuOpen(false)
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target as Node)) setNotifMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadRequests = async () => {
    const response = await apiFetch('/api/credit-requests')
    if (!response.ok) throw new Error('Falha ao carregar solicitações')
    const loaded: Request[] = await response.json()
    setRequests(loaded)
    return loaded
  }
  useEffect(() => { if (user) loadRequests().catch(() => pushToast('error', 'API indisponível. O exemplo do dossiê continua disponível.')) }, [user])
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let source: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    const connect = async () => {
      if (cancelled) return
      try {
        const response = await apiFetch('/api/auth/sse-ticket')
        if (!response.ok) throw new Error('ticket')
        const { ticket } = await response.json()
        if (cancelled) return
        source = new EventSource(`${apiUrl}/api/events?ticket=${encodeURIComponent(ticket)}`)
        source.addEventListener('requests-changed', (event) => {
          loadRequests().catch(() => {})
          try {
            const payload = JSON.parse((event as MessageEvent).data) as RequestChangedEvent
            const message = describeRequestChangeNotification(payload, user)
            if (message) { pushToast('info', message); playNotificationSound() }
          } catch { /* payload inesperado — a lista já foi recarregada de qualquer forma */ }
        })
        source.onerror = () => {
          source?.close()
          if (!cancelled) retryTimeout = setTimeout(connect, 3000)
        }
      } catch {
        if (!cancelled) retryTimeout = setTimeout(connect, 5000)
      }
    }
    connect()
    return () => { cancelled = true; source?.close(); if (retryTimeout) clearTimeout(retryTimeout) }
  }, [user])
  const items = requests
  const triageItems = items.filter((item) => item.status === 'RECEBIDA' || item.status === 'EM_ANALISE')
  const decidedItems = items.filter((item) => item.status === 'APROVADA' || item.status === 'NEGADA')
  const pendingDecisions = decidedItems.filter((item) => !item.praticoConfirmedAt)
  const historyDecisions = decidedItems.filter((item) => item.praticoConfirmedAt)
  const confirmPraticoUpdate = async (requestId: number) => {
    const response = await apiFetch(`/api/credit-requests/${requestId}/pratico-confirm`, { method: 'PATCH' })
    const data = await response.json().catch(() => null)
    if (!response.ok) { pushToast('error', data?.message || 'Não foi possível confirmar a atualização no Prático.'); return }
    await loadRequests()
    const message = data?.emailSent ? 'Atualização confirmada no Prático. O vendedor foi avisado por e-mail.' : 'Atualização confirmada no Prático.'
    pushToast('success', message)
    setBurst({ ok: true, title: 'Confirmado!', message })
  }
  const notifications: AppNotification[] = role === 'analista'
    ? pendingDecisions.map((item) => ({
        id: `decision-${item.id}`,
        title: item.companyName,
        subtitle: item.status === 'APROVADA' ? `Crédito aprovado · ${money(item.approvedLimit)}` : 'Crédito negado',
        onClick: () => { setView('decisions'); setNotifMenuOpen(false) },
      }))
    : []
  const createRequest = async (form: HTMLFormElement, contractFile: File | null): Promise<string | null> => {
    const data = new FormData(form)
    const joinMultiple = (name: string) => data.getAll(name).map((value) => String(value).trim()).filter(Boolean).join('; ')
    const payload = {
      clientCode: data.get('clientCode'), companyName: data.get('companyName'), tradeName: data.get('tradeName'),
      cnpj: data.get('cnpj'), stateRegistration: data.get('stateRegistration'), phone: joinMultiple('phone'), address: data.get('address'),
      invoiceEmail: data.get('invoiceEmail'), financeEmail: data.get('financeEmail'), contactName: joinMultiple('contactName'), contactEmail: joinMultiple('contactEmail'),
      requestPurpose: data.get('requestPurpose'), purchaseAuthorization: data.get('purchaseAuthorization'),
      deliveryType: data.get('deliveryType'), deliveryLocation: data.get('deliveryLocation'), deliveryAddress: data.get('deliveryAddress'),
      sellerId: user?.id, origin: data.get('origin'), sellerNotes: data.get('sellerNotes'),
    }
    const response = await apiFetch('/api/credit-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!response.ok) { const body = await response.json().catch(() => null); return body?.message || 'Confira os campos obrigatórios da ficha.' }
    const created = await response.json()
    let contractUploadFailed = false
    if (contractFile) {
      const uploadResponse = await uploadDocument(created.id, 'CONTRATO_SOCIAL', contractFile).catch(() => null)
      contractUploadFailed = !uploadResponse || !uploadResponse.ok
    }
    await loadRequests()
    if (contractUploadFailed) {
      const message = `Ficha ${created.protocol} enviada, mas o contrato social não foi salvo — reenvie o PDF com a analista.`
      pushToast('error', message)
      setBurst({ ok: false, title: 'Enviado com pendência', message })
    } else {
      const message = `Ficha ${created.protocol} enviada. A analista já pode iniciar a triagem.`
      pushToast('success', message)
      setBurst({ ok: true, title: 'Ficha enviada!', message })
    }
    return null
  }
  const resendRequest = async (requestId: number, form: HTMLFormElement, contractFile: File | null): Promise<string | null> => {
    const data = new FormData(form)
    const joinMultiple = (name: string) => data.getAll(name).map((value) => String(value).trim()).filter(Boolean).join('; ')
    const payload = {
      clientCode: data.get('clientCode'), companyName: data.get('companyName'), tradeName: data.get('tradeName'),
      cnpj: data.get('cnpj'), stateRegistration: data.get('stateRegistration'), phone: joinMultiple('phone'), address: data.get('address'),
      invoiceEmail: data.get('invoiceEmail'), financeEmail: data.get('financeEmail'), contactName: joinMultiple('contactName'), contactEmail: joinMultiple('contactEmail'),
      requestPurpose: data.get('requestPurpose'), purchaseAuthorization: data.get('purchaseAuthorization'),
      deliveryType: data.get('deliveryType'), deliveryLocation: data.get('deliveryLocation'), deliveryAddress: data.get('deliveryAddress'),
      origin: data.get('origin'), sellerNotes: data.get('sellerNotes'),
    }
    const response = await apiFetch(`/api/credit-requests/${requestId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!response.ok) { const body = await response.json().catch(() => null); return body?.message || 'Confira os campos obrigatórios da ficha.' }
    let contractUploadFailed = false
    if (contractFile) {
      const uploadResponse = await uploadDocument(requestId, 'CONTRATO_SOCIAL', contractFile).catch(() => null)
      contractUploadFailed = !uploadResponse || !uploadResponse.ok
    }
    await loadRequests()
    setEditingRequest(null)
    setView('requests')
    if (contractUploadFailed) {
      const message = 'Cadastro reenviado, mas o novo contrato social não foi salvo — reenvie o PDF com a analista.'
      pushToast('error', message)
      setBurst({ ok: false, title: 'Reenviado com pendência', message })
    } else {
      const message = 'Cadastro corrigido e reenviado para a analista.'
      pushToast('success', message)
      setBurst({ ok: true, title: 'Cadastro reenviado!', message })
    }
    return null
  }
  const updateStatus = async (nextStatus: Status, approvedLimit?: number, recipientEmail?: string, internalReason?: string, clientMessage?: string) => {
    let loaded = requests
    let emailSent = false
    let emailError: string | null = null
    if (selected.id) {
      if (nextStatus === 'AGUARDANDO_GESTAO') {
        await apiFetch(`/api/credit-requests/${selected.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
      } else {
        const response = await apiFetch(`/api/credit-requests/${selected.id}/decision`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: nextStatus === 'APROVADA' ? 'APROVADA' : 'NEGADA', approvedLimit: nextStatus === 'APROVADA' ? (approvedLimit ?? null) : null, recipientEmail: recipientEmail || null, internalReason: internalReason || null, clientMessage: clientMessage || null }) })
        const body = await response.json().catch(() => null)
        emailSent = !!body?.emailSent
        emailError = body?.emailError || null
      }
      loaded = await loadRequests()
    }
    setDecision(nextStatus === 'APROVADA' || nextStatus === 'NEGADA' ? nextStatus : null)
    if (nextStatus === 'AGUARDANDO_GESTAO') {
      const next = loaded.find((item) => item.status === 'RECEBIDA' || item.status === 'EM_ANALISE')
      setSelected(next || emptyRequest)
    } else if (nextStatus === 'APROVADA' || nextStatus === 'NEGADA') {
      setSelected(emptyRequest)
    } else {
      setSelected((current) => ({ ...current, status: nextStatus }))
    }
    if (nextStatus === 'APROVADA' || nextStatus === 'NEGADA') {
      const decisionText = nextStatus === 'APROVADA' ? `Crédito aprovado com limite de ${money(approvedLimit ?? null)}.` : 'Crédito negado.'
      const emailOk = !recipientEmail || emailSent
      const emailText = !recipientEmail ? '' : emailSent ? ' E-mail de confirmação enviado ao vendedor.' : ` Não foi possível enviar o e-mail de confirmação${emailError ? ` (${emailError})` : ''}.`
      const message = `${decisionText}${emailText} A solicitação saiu da fila de decisão.`
      pushToast(emailOk ? 'success' : 'error', `Conferido! ${message}`)
      setBurst({ ok: nextStatus === 'APROVADA', title: nextStatus === 'APROVADA' ? 'Crédito aprovado!' : 'Crédito negado', message })
    } else {
      const message = 'Dossiê enviado para a gestão com sucesso. A solicitação saiu da sua fila de triagem.'
      pushToast('success', message)
      setBurst({ ok: true, title: 'Dossiê enviado!', message })
    }
  }
  const handleReturnedToSeller = async () => {
    const loaded = await loadRequests()
    const next = loaded.find((item) => item.status === 'RECEBIDA' || item.status === 'EM_ANALISE')
    setSelected(next || emptyRequest)
  }
  const logout = () => { localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); setUser(null) }

  // Mostra "o que mudou" só quando a versão instalada no navegador é mais nova que a última
  // vista por esta pessoa — nunca no primeiro acesso (não há nada de "novo" para quem chega
  // agora), e some sozinho quando não há nenhuma nota entre a versão antiga e a atual.
  useEffect(() => {
    if (!user) return
    const lastSeen = localStorage.getItem(lastSeenVersionKey)
    if (lastSeen && lastSeen !== CURRENT_VERSION) {
      const entries = CHANGELOG.filter((entry) => compareVersions(entry.version, lastSeen) > 0)
      if (entries.length) setWhatsNewEntries(entries)
    }
    localStorage.setItem(lastSeenVersionKey, CURRENT_VERSION)
  }, [user])
  const openChangelog = () => setWhatsNewEntries(CHANGELOG)

  const pageLoadingBar = pageLoading && <div className="page-loading-bar"><span></span></div>

  if (resetToken) return <>{pageLoadingBar}<ResetPasswordScreen token={resetToken} onDone={() => { window.history.replaceState({}, '', window.location.pathname); setResetToken(null) }} /></>
  if (!user || !role) return <>{pageLoadingBar}<LoginScreen onLogin={(loggedUser) => setUser(loggedUser)} /></>

  return <>{pageLoadingBar}<div className="app-shell">
    <aside className="sidebar"><div className="brand"><img src="/logo_sc.jpg" alt="Sis-Cred" className="brand-logo" /></div><div className="workspace-label">ACESSO ATUAL</div><div className="current-role"><div className="role-icon">{role === 'vendedor' ? <Users size={16} /> : role === 'analista' ? <ClipboardCheck size={16} /> : <ShieldCheck size={16} />}</div><div><strong>{role === 'vendedor' ? 'Vendedor' : role === 'analista' ? 'Analista' : role === 'gestao' ? 'Gestão' : 'Administrador'}</strong><small>Acesso autorizado</small></div></div>{(role === 'admin' || role === 'gestao') && <div className="role-switcher" style={{ marginTop: 18 }}><button className={view === 'main' ? 'nav-item active' : 'nav-item'} onClick={() => setView('main')}>{role === 'admin' ? <Activity size={18} /> : <ShieldCheck size={18} />}<span>{role === 'admin' ? 'Administração' : 'Decisão de crédito'}</span></button><button className={view === 'users' ? 'nav-item active' : 'nav-item'} onClick={() => setView('users')}><Users size={18} /><span>Usuários</span></button><button className={view === 'audit' ? 'nav-item active' : 'nav-item'} onClick={() => setView('audit')}><FileCheck2 size={18} /><span>Auditoria</span></button></div>}{role === 'analista' && <div className="role-switcher" style={{ marginTop: 18 }}><button className={view === 'main' ? 'nav-item active' : 'nav-item'} onClick={() => setView('main')}><ClipboardCheck size={18} /><span>Triagem e dossiê</span></button><button className={view === 'decisions' ? 'nav-item active' : 'nav-item'} onClick={() => setView('decisions')}><FileCheck2 size={18} /><span>Decisões</span>{pendingDecisions.length > 0 && <span className="pending-dot">{pendingDecisions.length}</span>}</button></div>}{role === 'vendedor' && <div className="role-switcher" style={{ marginTop: 18 }}><button className={view === 'main' ? 'nav-item active' : 'nav-item'} onClick={() => { setEditingRequest(null); setView('main') }}><FileText size={18} /><span>Novo cadastro</span></button><button className={view === 'requests' ? 'nav-item active' : 'nav-item'} onClick={() => setView('requests')}><ClipboardCheck size={18} /><span>Minhas solicitações</span></button></div>}<div className="sidebar-bottom"><div className="help-box"><span>Processo digital</span><small>Sem papel no dossiê</small><ArrowUpRight size={16} /></div><button type="button" className="version-tag" onClick={openChangelog}><Sparkles size={12} /> v{CURRENT_VERSION} · novidades</button></div></aside>
    <main className="main-content"><header className="topbar"><button className="mobile-menu"><Menu size={21} /></button><div className="breadcrumb">Sis-Cred <span>/</span> <b>{view === 'audit' ? 'Auditoria' : view === 'users' ? 'Usuários' : view === 'decisions' ? 'Decisões' : view === 'requests' ? 'Minhas solicitações' : role === 'vendedor' ? 'Novo cadastro' : role === 'analista' ? 'Triagem e dossiê' : role === 'gestao' ? 'Decisão de crédito' : 'Administração'}</b></div><div className="top-actions">
        <div className="menu-wrap" ref={notifMenuRef}>
          <button type="button" className="icon-btn" onClick={() => { setNotifMenuOpen((open) => !open); setProfileMenuOpen(false) }}><Bell size={19} />{notifications.length > 0 && <i></i>}</button>
          {notifMenuOpen && <div className="dropdown-panel notif-panel">
            <div className="dropdown-panel-head"><strong>Notificações</strong>{notifications.length > 0 && <span className="tag">{notifications.length}</span>}</div>
            {notifications.length ? notifications.map((item) => <button key={item.id} type="button" className="dropdown-notif-item" onClick={item.onClick}><Bell size={14} /><div><strong>{item.title}</strong><small>{item.subtitle}</small></div></button>) : <p className="dropdown-empty">Nenhuma notificação por aqui.</p>}
          </div>}
        </div>
        <div className="menu-wrap" ref={profileMenuRef}>
          <button type="button" className="profile" onClick={() => { setProfileMenuOpen((open) => !open); setNotifMenuOpen(false) }}>
            <div className="avatar">{avatarSrc ? <img className="avatar-img" src={avatarSrc} alt="" /> : initials(user.name)}</div>
            <div><strong>{user.name}</strong><small>{role === 'admin' ? 'Acesso total' : role === 'gestao' ? 'Gestora de crédito' : role === 'analista' ? 'Analista de cadastro' : 'Equipe comercial'}</small></div>
            <ChevronDown size={16} />
          </button>
          {profileMenuOpen && <div className="dropdown-panel profile-panel">
            <button type="button" className="dropdown-item" onClick={() => { setShowEditProfile(true); setProfileMenuOpen(false) }}><Pencil size={16} /> Editar perfil</button>
            <button type="button" className="dropdown-item" onClick={() => { setShowChangePassword(true); setProfileMenuOpen(false) }}><ShieldCheck size={16} /> Trocar senha</button>
            <button type="button" className="dropdown-item danger" onClick={logout}><LogOut size={16} /> Sair do sistema</button>
          </div>}
        </div>
      </div></header>
      <div className="content-wrap"><div key={view} className="page-enter">{view === 'audit' && (role === 'admin' || role === 'gestao') ? <AuditView requests={items} /> : view === 'users' && (role === 'admin' || role === 'gestao') ? <UserManagementView isAdmin={role === 'admin'} currentUserId={user.id} /> : view === 'decisions' && role === 'analista' ? <DecisionsView pendingDecisions={pendingDecisions} historyDecisions={historyDecisions} onConfirmPratico={confirmPraticoUpdate} /> : view === 'requests' && role === 'vendedor' ? <SellerRequestsView requests={items} onNew={() => { setEditingRequest(null); setView('main') }} onEdit={(item) => { setEditingRequest(item); setView('main') }} /> : <>{role === 'vendedor' && <SellerForm key={editingRequest?.id ?? 'new'} initialRequest={editingRequest} onSubmit={editingRequest ? (form, file) => resendRequest(editingRequest.id, form, file) : createRequest} />}{role === 'analista' && <AnalystView requests={triageItems} selected={selected} setSelected={setSelected} onSend={() => updateStatus('AGUARDANDO_GESTAO')} onReturned={handleReturnedToSeller} />}{role === 'gestao' && <ManagementView requests={items.filter((item) => item.status === 'AGUARDANDO_GESTAO')} deniedItems={items.filter((item) => item.status === 'NEGADA')} onReloadRequests={loadRequests} selected={selected} setSelected={setSelected} decision={decision} onDecision={updateStatus} />}{role === 'admin' && <AdminView />}</>}</div></div></main>
    {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} onSuccess={() => { setShowChangePassword(false); pushToast('success', 'Senha atualizada com sucesso.') }} />}
    {showEditProfile && <EditProfileModal user={user} avatarSrc={avatarSrc} onClose={() => setShowEditProfile(false)} onSaved={saveProfilePatch} />}
    {burst && <ConfirmationBurst ok={burst.ok} title={burst.title} message={burst.message} onDone={() => setBurst(null)} />}
    {whatsNewEntries && <WhatsNewModal entries={whatsNewEntries} onClose={() => setWhatsNewEntries(null)} />}
  </div></>
}

function ChangePasswordModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) { setError('Preencha todos os campos.'); return }
    if (newPassword !== confirmPassword) { setError('A confirmação não coincide com a nova senha.'); return }
    setSubmitting(true); setError('')
    try {
      const response = await apiFetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || 'Não foi possível trocar a senha.'); return }
      onSuccess()
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); submit() }}><div className="modal-head"><div><p className="eyebrow">SEGURANÇA DA CONTA</p><h2>Trocar senha</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoFocus /></label><label>Nova senha<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>Confirmar nova senha<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><p className="modal-copy">{passwordHint}</p>{error && <div className="notice notice-error"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn" disabled={submitting}><Check size={17} /> {submitting ? 'Salvando...' : 'Salvar nova senha'}</button></div></form></div>
}

function EditProfileModal({ user, avatarSrc, onClose, onSaved }: { user: AuthUser; avatarSrc: string | null; onClose: () => void; onSaved: (patch: Partial<AuthUser>) => void }) {
  const [name, setName] = useState(user.name)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pickFile = (selected: File | undefined) => {
    if (!selected) return
    if (!avatarMimeTypes.includes(selected.type)) { setError('Selecione uma imagem JPG, PNG ou WEBP.'); return }
    if (selected.size > 3 * 1024 * 1024) { setError('A imagem deve ter até 3MB.'); return }
    setError('')
    setRemovePhoto(false)
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
  }

  const submit = async () => {
    if (!name.trim()) { setError('Informe um nome válido.'); return }
    setSubmitting(true); setError('')
    try {
      const patch: Partial<AuthUser> = {}
      if (name.trim() !== user.name) {
        const response = await apiFetch('/api/auth/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
        const data = await response.json().catch(() => null)
        if (!response.ok) { setError(data?.message || 'Não foi possível atualizar o nome.'); return }
        patch.name = data.name
      }
      if (file) {
        const data = new FormData()
        data.append('file', file)
        const response = await apiFetch('/api/auth/avatar', { method: 'POST', body: data })
        const body = await response.json().catch(() => null)
        if (!response.ok) { setError(body?.message || 'Não foi possível salvar a foto.'); return }
        patch.avatarUrl = body.avatarUrl
      } else if (removePhoto) {
        const response = await apiFetch('/api/auth/avatar', { method: 'DELETE' })
        if (!response.ok) { setError('Não foi possível remover a foto.'); return }
        patch.avatarUrl = null
      }
      onSaved(patch)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }

  const currentPreview = preview || (removePhoto ? null : avatarSrc)

  return <div className="modal-backdrop"><form className="modal" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="modal-head"><div><p className="eyebrow">MEU PERFIL</p><h2>Editar perfil</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div>
    <div className="avatar-edit-row">
      <button type="button" className="avatar-edit-preview" onClick={() => fileInputRef.current?.click()}>
        {currentPreview ? <img src={currentPreview} alt="" /> : initials(name || user.name)}
      </button>
      <div className="avatar-edit-actions">
        <button type="button" className="avatar-photo-btn" onClick={() => fileInputRef.current?.click()}><Camera size={14} /> Escolher foto</button>
        {currentPreview && <button type="button" className="avatar-remove-btn" onClick={() => { setFile(null); setPreview(null); setRemovePhoto(true) }}><Trash2 size={13} /> Remover foto</button>}
        <small className="avatar-edit-hint">JPG, PNG ou WEBP · até 3MB</small>
      </div>
    </div>
    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(event) => pickFile(event.target.files?.[0])} />
    <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
    {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
    <div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn" disabled={submitting}><Check size={17} /> {submitting ? 'Salvando...' : 'Salvar alterações'}</button></div>
  </form></div>
}

const adminRoleOptions = [
  { value: 'VENDEDOR', label: 'Vendedor' },
  { value: 'ANALISTA', label: 'Analista' },
  { value: 'GESTORA', label: 'Gestão' },
  { value: 'ADMIN', label: 'Administrador' },
]
const managementRoleOptions = [
  { value: 'VENDEDOR', label: 'Vendedor' },
  { value: 'ANALISTA', label: 'Analista' },
  { value: 'GESTORA', label: 'Gestão' },
]

function CreateUserModal({ roleOptions, onClose, onCreated }: { roleOptions: Array<{ value: string; label: string }>; onClose: () => void; onCreated: () => void }) {
  const [role, setRole] = useState(roleOptions[0].value)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), email: form.get('email'), role: form.get('role'), password: form.get('password'), praticoSellerCode: form.get('praticoSellerCode'), storeName: form.get('storeName'), managerName: form.get('managerName'), whatsappPhone: form.get('whatsappPhone') }) })
      if (!response.ok) { const body = await response.json().catch(() => null); setError(body?.message || 'Não foi possível criar o usuário.'); return }
      onCreated()
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">NOVO ACESSO</p><h2>Criar usuário</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><p className="modal-copy">Defina o acesso e a senha inicial. O usuário poderá trocá-la depois de entrar.</p><label>Nome completo<input name="name" required placeholder="Nome do colaborador" /></label><label>E-mail corporativo<input name="email" required type="email" placeholder="colaborador@empresa.com.br" /></label><label>Função<select name="role" value={role} onChange={(event) => setRole(event.target.value)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{role === 'VENDEDOR' && <><label>Código do vendedor no Prático<input name="praticoSellerCode" required placeholder="Ex.: 1234" /></label><label>Loja<input name="storeName" required placeholder="Loja onde o vendedor trabalha" /></label><label>Nome do gerente<input name="managerName" required placeholder="Gerente responsável pelo vendedor" /></label><label>WhatsApp do vendedor<input name="whatsappPhone" required placeholder="(00) 00000-0000" /></label></>}<label>Senha inicial<input name="password" type="password" required placeholder="Defina a senha de acesso" /></label><small className="login-foot"><ShieldCheck size={13} /> {passwordHint}</small>{error && <div className="notice notice-error"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn" disabled={submitting}><Check size={17} /> {submitting ? 'Criando...' : 'Criar acesso'}</button></div></form></div>
}

function EditUserModal({ user, roleOptions, onClose, onSaved }: { user: ManagedUser; roleOptions: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(user.role)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await apiFetch(`/api/admin/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), email: form.get('email'), role: form.get('role'), praticoSellerCode: form.get('praticoSellerCode'), storeName: form.get('storeName'), managerName: form.get('managerName'), whatsappPhone: form.get('whatsappPhone') }) })
      if (!response.ok) { const body = await response.json().catch(() => null); setError(body?.message || 'Não foi possível salvar as alterações.'); return }
      onSaved()
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">EDITAR CADASTRO</p><h2>Editar usuário</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><p className="modal-copy">Atualize os dados de acesso e cadastro deste usuário.</p><label>Nome completo<input name="name" required defaultValue={user.name} placeholder="Nome do colaborador" /></label><label>E-mail corporativo<input name="email" required type="email" defaultValue={user.email} placeholder="colaborador@empresa.com.br" /></label><label>Função<select name="role" value={role} onChange={(event) => setRole(event.target.value)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{role === 'VENDEDOR' && <><label>Código do vendedor no Prático<input name="praticoSellerCode" required defaultValue={user.praticoSellerCode ?? ''} placeholder="Ex.: 1234" /></label><label>Loja<input name="storeName" required defaultValue={user.storeName ?? ''} placeholder="Loja onde o vendedor trabalha" /></label><label>Nome do gerente<input name="managerName" required defaultValue={user.managerName ?? ''} placeholder="Gerente responsável pelo vendedor" /></label><label>WhatsApp do vendedor<input name="whatsappPhone" required defaultValue={user.whatsappPhone ?? ''} placeholder="(00) 00000-0000" /></label></>}{error && <div className="notice notice-error"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn" disabled={submitting}><Check size={17} /> {submitting ? 'Salvando...' : 'Salvar alterações'}</button></div></form></div>
}

function DeleteUserModal({ userName, onClose, onDone, onSubmit }: { userName: string; onClose: () => void; onDone: () => void; onSubmit: () => Promise<string | null> }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const confirm = async () => {
    setSubmitting(true); setError('')
    const errorMessage = await onSubmit()
    setSubmitting(false)
    if (errorMessage) { setError(errorMessage); return }
    onDone()
  }
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><p className="eyebrow">AÇÃO IRREVERSÍVEL</p><h2>Excluir {userName}</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><p className="modal-copy">Esta ação exclui definitivamente o acesso de {userName} ao sistema e não pode ser desfeita. Se este usuário tiver solicitações ou registros vinculados, a exclusão será bloqueada — nesse caso, suspenda o acesso em vez de excluir.</p>{error && <div className="notice notice-error"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="button" className="primary-btn" style={{ background: '#e05252', color: '#fff' }} disabled={submitting} onClick={confirm}><Trash2 size={17} /> {submitting ? 'Excluindo...' : 'Excluir usuário'}</button></div></div></div>
}

function ResetUserPasswordModal({ userName, onClose, onDone, onSubmit }: { userName: string; onClose: () => void; onDone: () => void; onSubmit: (newPassword: string) => Promise<string | null> }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) { setError('As senhas não coincidem.'); return }
    setSubmitting(true); setError('')
    const errorMessage = await onSubmit(newPassword)
    setSubmitting(false)
    if (errorMessage) { setError(errorMessage); return }
    onDone()
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">SEGURANÇA DA CONTA</p><h2>Trocar senha de {userName}</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><p className="modal-copy">Defina uma nova senha para este usuário. Ele poderá trocá-la novamente depois de entrar.</p><label>Nova senha<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required autoFocus /></label><label>Confirmar nova senha<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><small className="login-foot"><ShieldCheck size={13} /> {passwordHint}</small>{error && <div className="notice notice-error"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn" disabled={submitting}><Check size={17} /> {submitting ? 'Salvando...' : 'Salvar nova senha'}</button></div></form></div>
}

type ManagedUser = { id: number; name: string; email: string; role: string; praticoSellerCode: string | null; storeName: string | null; managerName: string | null; whatsappPhone: string | null; active: number }

function UserManagementView({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: number }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null)
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null)
  const [search, setSearch] = useState('')
  const pushToast = useToast()
  const roleOptions = isAdmin ? adminRoleOptions : managementRoleOptions
  const normalizedSearch = search.trim().toLowerCase()
  const filteredUsers = normalizedSearch
    ? users.filter((managedUser) => managedUser.name.toLowerCase().includes(normalizedSearch) || (managedUser.praticoSellerCode ?? '').toLowerCase().includes(normalizedSearch))
    : users
  const load = async () => { const response = await apiFetch('/api/admin/users'); setUsers(await response.json()) }
  useEffect(() => { load().catch(() => pushToast('error', 'Não foi possível carregar os usuários.')) }, [])
  const toggleUser = async (id: number) => { await apiFetch(`/api/admin/users/${id}/toggle`, { method: 'PATCH' }); await load() }
  const resetPassword = async (newPassword: string): Promise<string | null> => {
    if (!resetTarget) return null
    const response = await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }) })
    if (!response.ok) { const body = await response.json().catch(() => null); return body?.message || 'Não foi possível trocar a senha.' }
    return null
  }
  const deleteUser = async (): Promise<string | null> => {
    if (!deleteTarget) return null
    const response = await apiFetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' })
    if (!response.ok) { const body = await response.json().catch(() => null); return body?.message || 'Não foi possível excluir o usuário.' }
    return null
  }
  return <><PageHeader eyebrow="GESTÃO DE USUÁRIOS" title="Usuários e acessos" subtitle={isAdmin ? 'Crie, edite, suspenda ou exclua qualquer acesso do sistema.' : 'Crie, edite, suspenda ou exclua acessos de vendedores, analistas e gestão.'} action={<button className="primary-btn" onClick={() => setShowUserForm(true)}><Plus size={18} /> Criar usuário</button>} />
    <section className="admin-card"><div className="card-heading"><div><h2>Usuários e permissões</h2><p>{isAdmin ? 'Todos os acessos do sistema.' : 'Acessos de vendedores, analistas e gestão.'}</p></div><span className="tag">{filteredUsers.length} de {users.length} cadastrados</span></div>
      <div className="search" style={{ marginTop: 14 }}><Search size={16} /><input placeholder="Buscar por nome ou código de vendedor" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="user-table"><div className="user-head" style={{ gridTemplateColumns: '1.4fr .8fr .8fr auto' }}><span>USUÁRIO</span><span>FUNÇÃO</span><span>ACESSO</span><span></span></div>
        {filteredUsers.length ? filteredUsers.map((managedUser) => <div className="user-row" style={{ gridTemplateColumns: '1.4fr .8fr .8fr auto' }} key={managedUser.id}>
          <div><strong>{managedUser.name}</strong><small>{managedUser.email}{managedUser.storeName ? ` · ${managedUser.storeName} · Cód. Prático ${managedUser.praticoSellerCode}` : ''}</small></div>
          <span className="user-role">{managedUser.role}</span>
          <span className={managedUser.active ? 'access-active' : 'access-inactive'}><i></i>{managedUser.active ? 'Ativo' : 'Suspenso'}</span>
          <div className="user-actions">
            <button className="small-action" onClick={() => setEditTarget(managedUser)}>Editar</button>
            <button className="small-action" onClick={() => setResetTarget(managedUser)}>Trocar senha</button>
            <button className="small-action" onClick={() => toggleUser(managedUser.id)}>{managedUser.active ? 'Suspender' : 'Reativar'}</button>
            {managedUser.id !== currentUserId && <button className="small-action danger" onClick={() => setDeleteTarget(managedUser)}>Excluir</button>}
          </div>
        </div>) : <p className="dropdown-empty" style={{ padding: '18px 10px' }}>Nenhum usuário encontrado para "{search}".</p>}
      </div>
    </section>
    {showUserForm && <CreateUserModal roleOptions={roleOptions} onClose={() => setShowUserForm(false)} onCreated={() => { setShowUserForm(false); load(); pushToast('success', 'Usuário criado com acesso ativo.') }} />}
    {editTarget && <EditUserModal user={editTarget} roleOptions={roleOptions} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); load(); pushToast('success', 'Cadastro do usuário atualizado com sucesso.') }} />}
    {resetTarget && <ResetUserPasswordModal userName={resetTarget.name} onClose={() => setResetTarget(null)} onSubmit={resetPassword} onDone={() => { setResetTarget(null); pushToast('success', 'Senha do usuário atualizada com sucesso.') }} />}
    {deleteTarget && <DeleteUserModal userName={deleteTarget.name} onClose={() => setDeleteTarget(null)} onSubmit={deleteUser} onDone={() => { setDeleteTarget(null); load(); pushToast('success', 'Usuário excluído com sucesso.') }} />}
  </>
}

type UpdateCheckResult = { currentVersion: string; latestVersion: string; updateAvailable: boolean; commitsAhead: number | null; newChangelog: ChangelogEntry[] }
function UpdateCheckCard() {
  const [status, setStatus] = useState<'loading' | 'unconfigured' | 'error' | 'ok'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)
  const pushToast = useToast()
  const check = () => {
    setStatus('loading')
    apiFetch('/api/admin/updates/check').then(async (response) => {
      const body = await response.json().catch(() => null)
      if (response.status === 503) { setErrorMessage(body?.message || 'Verificação de atualização não configurada.'); setStatus('unconfigured'); return }
      if (!response.ok) { setErrorMessage(body?.message || `A verificação falhou (HTTP ${response.status}).`); setStatus('error'); return }
      setResult(body)
      setStatus('ok')
    }).catch(() => { setErrorMessage('Não foi possível conectar à API.'); setStatus('error') })
  }
  useEffect(check, [])
  const copyDeployCommand = () => {
    const command = 'cd /opt/sis-cred/app && ./deploy/linux/update.sh'
    navigator.clipboard.writeText(command)
      .then(() => pushToast('success', 'Comando copiado. Rode-o via SSH no servidor.'))
      .catch(() => pushToast('error', 'Não foi possível copiar o comando. Copie manualmente: ' + command))
  }
  // Sempre visível — mesmo quando não configurado ou a checagem falha — para o admin nunca
  // ficar sem entender por que "não aparece nada": aqui a razão sempre fica explícita.
  return <section className="admin-card update-check-card">
    <div className="card-heading">
      <div><h2>Atualizações do sistema</h2><p>{status === 'ok' && result ? `Versão instalada: v${result.currentVersion}` : `Versão instalada: v${CURRENT_VERSION}`}</p></div>
      {status === 'ok' && result && <span className={result.updateAvailable ? 'update-badge' : 'update-badge ok'}>{result.updateAvailable ? 'Nova versão disponível' : 'Atualizado'}</span>}
    </div>
    {status === 'loading' && <p className="subheading" style={{ margin: '10px 0 0' }}>Verificando no GitHub...</p>}
    {(status === 'unconfigured' || status === 'error') && <>
      <p className="subheading" style={{ margin: '10px 0 0' }}>{errorMessage}</p>
      {status === 'error' && <button type="button" className="link-btn" style={{ padding: '6px 0', marginTop: 4 }} onClick={check}>Tentar de novo</button>}
    </>}
    {status === 'ok' && result?.updateAvailable && <>
      <p className="modal-copy" style={{ margin: '12px 0' }}>Versão v{result.latestVersion} disponível no GitHub{result.commitsAhead != null ? ` · ${result.commitsAhead} commit(s) à frente do seu servidor` : ''}.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {result.newChangelog.length > 0 && <button type="button" className="outline-btn" style={{ width: 'auto', margin: 0 }} onClick={() => setShowChangelog((value) => !value)}>{showChangelog ? 'Ocultar novidades' : 'Ver o que mudou'}</button>}
        <button type="button" className="outline-btn" style={{ width: 'auto', margin: 0 }} onClick={copyDeployCommand}><Download size={14} /> Copiar comando de deploy</button>
      </div>
      {showChangelog && <div style={{ marginTop: 14 }}>{result.newChangelog.map((entry) => <div key={entry.version} style={{ marginBottom: 12 }}>
        <strong style={{ display: 'block', fontSize: 13, color: '#233347' }}>v{entry.version} · {new Date(`${entry.date}T00:00:00`).toLocaleDateString('pt-BR')}</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: '#5b6a7d' }}>{entry.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      </div>)}</div>}
    </>}
  </section>
}
function AdminView() { const [overview, setOverview] = useState<{ users: { total: number; active: number }; requests: Array<{ status: string; total: number }>; documents: { total: number }; audit: { total: number } } | null>(null); const pushToast = useToast(); useEffect(() => { apiFetch('/api/admin/overview').then((response) => response.json()).then(setOverview).catch(() => pushToast('error', 'Não foi possível carregar os dados administrativos.')) }, []); return <><PageHeader eyebrow="ADMINISTRAÇÃO DO SISTEMA" title="Controle e conferência" subtitle="Acompanhe a saúde do processo. Para gerenciar acessos, use Usuários no menu." /><UpdateCheckCard /><section className="admin-metrics"><div><Activity size={19} /><span>Usuários ativos</span><strong>{overview?.users.active ?? '...'}</strong></div><div><FileCheck2 size={19} /><span>Solicitações cadastradas</span><strong>{overview?.requests.reduce((sum, item) => sum + Number(item.total), 0) ?? '...'}</strong></div><div><FileText size={19} /><span>Documentos no dossiê</span><strong>{overview?.documents.total ?? '...'}</strong></div><div><ShieldCheck size={19} /><span>Eventos auditados</span><strong>{overview?.audit.total ?? '...'}</strong></div></section><div className="admin-grid"><section className="admin-card checks-card"><div className="card-heading"><div><h2>Conferências rápidas</h2><p>Visão operacional para manutenção.</p></div></div><div className="check-line"><Check size={16} /><div><strong>Banco de dados</strong><small>MariaDB conectado e respondendo</small></div><b>OK</b></div><div className="check-line"><Check size={16} /><div><strong>Fila de crédito</strong><small>Solicitações por status disponíveis</small></div><b>OK</b></div><div className="check-line"><Check size={16} /><div><strong>Auditoria</strong><small>Decisões registradas no histórico</small></div><b>OK</b></div><div className="check-line"><Check size={16} /><div><strong>Documentos</strong><small>Arquivos vinculados aos dossiês</small></div><b>OK</b></div></section></div></> }

const statusOrder: Status[] = ['RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_GESTAO', 'APROVADA', 'NEGADA', 'DEVOLVIDA']
const documentLabel: Record<string, string> = { CONTRATO_SOCIAL: 'Contrato social / Certificado MEI', SERASA: 'Consulta Serasa', DEPS: 'Avaliação DEPS' }

type AuditEvent = { id: number; requestId: number; eventType: string; eventData: Record<string, unknown> | null; createdAt: string; actorName: string; actorRole: BackendRole; protocol: string; companyName: string; clientCode: string }
const auditEventLabel: Record<string, string> = {
  SOLICITACAO_CRIADA: 'Solicitação criada',
  DOCUMENTO_ENVIADO: 'Documento enviado',
  DOCUMENTO_REMOVIDO: 'Documento removido',
  STATUS_ATUALIZADO: 'Status atualizado',
  DECISAO_REGISTRADA: 'Decisão registrada',
  PRATICO_CONFIRMADO: 'Confirmado no Prático',
  DECISAO_REABERTA: 'Decisão reaberta',
  SOLICITACAO_DEVOLVIDA: 'Cadastro devolvido ao vendedor',
  SOLICITACAO_REENVIADA: 'Cadastro reenviado pelo vendedor',
}
const auditEventDetail = (event: AuditEvent): string => {
  const data = event.eventData
  if (!data) return '—'
  switch (event.eventType) {
    case 'SOLICITACAO_CRIADA': return 'Ficha cadastral enviada pelo vendedor'
    case 'DOCUMENTO_ENVIADO': return `${documentLabel[data.documentType as string] || data.documentType} anexado`
    case 'DOCUMENTO_REMOVIDO': return `${documentLabel[data.documentType as string] || data.documentType} removido`
    case 'STATUS_ATUALIZADO': return `Movida para "${statusLabel[data.status as Status] || data.status}"`
    case 'DECISAO_REGISTRADA': return `${data.decision === 'APROVADA' ? 'Aprovada' : 'Negada'}${data.approvedLimit ? ` · ${money(Number(data.approvedLimit))}` : ''}`
    case 'PRATICO_CONFIRMADO': return `Registro confirmado no sistema Prático (${statusLabel[data.status as Status] || data.status})`
    case 'DECISAO_REABERTA': return `Reaberta e aprovada · ${money(Number(data.approvedLimit))}`
    case 'SOLICITACAO_DEVOLVIDA': return `Motivo: "${data.reason}"`
    case 'SOLICITACAO_REENVIADA': return 'Cadastro corrigido e reenviado para triagem'
    default: return '—'
  }
}
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`
type AuditGroup = { requestId: number; protocol: string; companyName: string; clientCode: string; events: AuditEvent[] }
const groupAuditEvents = (events: AuditEvent[]): AuditGroup[] => {
  const groups: AuditGroup[] = []
  const indexByRequest = new Map<number, number>()
  for (const event of events) {
    let index = indexByRequest.get(event.requestId)
    if (index === undefined) {
      index = groups.length
      indexByRequest.set(event.requestId, index)
      groups.push({ requestId: event.requestId, protocol: event.protocol, companyName: event.companyName, clientCode: event.clientCode, events: [] })
    }
    groups[index].events.push(event)
  }
  return groups
}

function AuditView({ requests }: { requests: Request[] }) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL')
  const [detail, setDetail] = useState<Request | null>(null)
  const [detailDocuments, setDetailDocuments] = useState<DossierDocument[]>([])
  const [detailDecision, setDetailDecision] = useState<DecisionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedRequestIds, setExpandedRequestIds] = useState<Set<number>>(new Set())

  const openDetail = async (item: Request) => {
    setDetail(item); setDetailLoading(true); setDetailDecision(null); setDetailDocuments([])
    try {
      const docs = await listDocuments(item.id)
      setDetailDocuments(docs)
      if (item.status === 'APROVADA' || item.status === 'NEGADA') {
        const response = await apiFetch(`/api/credit-requests/${item.id}/decision`)
        if (response.ok) setDetailDecision(await response.json())
      }
    } finally { setDetailLoading(false) }
  }

  const loadEvents = async () => {
    setEventsLoading(true)
    try {
      const params = new URLSearchParams()
      if (eventTypeFilter) params.set('eventType', eventTypeFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      if (searchTerm) params.set('protocol', searchTerm)
      const response = await apiFetch(`/api/audit-events?${params.toString()}`)
      if (response.ok) setEvents(await response.json())
    } finally { setEventsLoading(false) }
  }
  useEffect(() => { loadEvents() }, [])

  const exportCsv = () => {
    const header = ['Data/Hora', 'Evento', 'Protocolo', 'Código Prático', 'Cliente', 'Responsável', 'Função', 'Detalhes']
    const rows = events.map((event) => [
      formatDateTime(event.createdAt), auditEventLabel[event.eventType] || event.eventType, event.protocol,
      event.clientCode, event.companyName, event.actorName, event.actorRole, auditEventDetail(event),
    ])
    const csv = [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(';')).join('\r\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `auditoria-sis-cred-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const toggleGroup = (requestId: number) => setExpandedRequestIds((current) => {
    const next = new Set(current)
    if (next.has(requestId)) next.delete(requestId); else next.add(requestId)
    return next
  })
  const auditGroups = groupAuditEvents(events)
  const allGroupsExpanded = auditGroups.length > 0 && auditGroups.every((group) => expandedRequestIds.has(group.requestId))
  const toggleAllGroups = () => setExpandedRequestIds(allGroupsExpanded ? new Set() : new Set(auditGroups.map((group) => group.requestId)))

  const counts: Record<Status, number> = { RECEBIDA: 0, EM_ANALISE: 0, AGUARDANDO_GESTAO: 0, APROVADA: 0, NEGADA: 0, DEVOLVIDA: 0 }
  for (const item of requests) counts[item.status]++
  const filtered = statusFilter === 'ALL' ? requests : requests.filter((item) => item.status === statusFilter)

  return <>
    <PageHeader eyebrow="AUDITORIA" title="Filas de solicitações e documentos" subtitle="Acompanhe todas as solicitações, os documentos enviados e as decisões assinadas com data, hora e responsável." />
    <section className="admin-metrics">
      {statusOrder.map((status) => <button key={status} type="button" onClick={() => setStatusFilter(status)} style={{ all: 'unset', cursor: 'pointer' }}><div style={{ boxShadow: statusFilter === status ? '0 0 0 2px #96660a' : 'none' }} className="metric-card" ><span style={{ display: 'block', color: '#7c8999', fontSize: 11, marginBottom: 6 }}>{statusLabel[status]}</span><strong style={{ font: '800 23px Manrope', display: 'block', color: '#233347' }}>{counts[status]}</strong></div></button>)}
    </section>
    <div className="section-title"><div><h2>Todas as solicitações</h2><p>{filtered.length} de {requests.length} solicitação(ões){statusFilter !== 'ALL' ? ` · filtrando por ${statusLabel[statusFilter]}` : ''}</p></div>{statusFilter !== 'ALL' && <button className="link-btn" onClick={() => setStatusFilter('ALL')}>Limpar filtro</button>}</div>
    <div className="admin-card" style={{ padding: 0 }}>
      <div className="user-table" style={{ padding: '4px 20px 20px' }}>
        <div className="user-head" style={{ gridTemplateColumns: '1.4fr .7fr 1fr .9fr .8fr 110px' }}><span>CLIENTE</span><span>PROTOCOLO</span><span>VENDEDOR</span><span>STATUS</span><span>ENVIADO EM</span><span></span></div>
        {filtered.length ? filtered.map((item) => <div className="user-row" key={item.id} style={{ gridTemplateColumns: '1.4fr .7fr 1fr .9fr .8fr 110px' }}>
          <div><strong>{item.companyName}</strong><small>Código Prático: {item.clientCode}</small></div>
          <span className="user-role">{item.protocol}</span>
          <span className="user-role">{item.sellerName}</span>
          <span className={item.status === 'APROVADA' ? 'access-active' : item.status === 'NEGADA' ? 'access-inactive' : 'user-role'}>{item.status !== 'APROVADA' && item.status !== 'NEGADA' && <i style={{ background: '#96660a', width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 5 }}></i>}{item.status === 'APROVADA' || item.status === 'NEGADA' ? <><i></i>{statusLabel[item.status]}</> : statusLabel[item.status]}</span>
          <span className="time">{new Date(item.submittedAt).toLocaleDateString('pt-BR')}</span>
          <button className="small-action" onClick={() => openDetail(item)}>Ver dossiê</button>
        </div>) : <p className="subheading" style={{ padding: '17px' }}>Nenhuma solicitação encontrada.</p>}
      </div>
    </div>

    <div className="section-title" style={{ marginTop: 28 }}><div><h2>Trilha de auditoria</h2><p>{events.length} evento(s) em {auditGroups.length} cliente(s) — do envio da ficha até a confirmação final no Prático, agrupados por cliente.</p></div><div style={{ display: 'flex', gap: 14 }}><button type="button" className="link-btn" onClick={toggleAllGroups} disabled={!auditGroups.length}>{allGroupsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {allGroupsExpanded ? 'Recolher tudo' : 'Expandir tudo'}</button><button type="button" className="link-btn" onClick={exportCsv} disabled={!events.length}><Download size={15} /> Exportar CSV</button></div></div>
    <div className="admin-card">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 18 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#617084', fontWeight: 600 }}>Evento
          <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} style={{ display: 'block', marginTop: 6, border: '1px solid #dfe6ed', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#334257' }}>
            <option value="">Todos</option>
            {Object.entries(auditEventLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 12, color: '#617084', fontWeight: 600 }}>De
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} style={{ display: 'block', marginTop: 6, border: '1px solid #dfe6ed', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#334257' }} />
        </label>
        <label style={{ display: 'block', fontSize: 12, color: '#617084', fontWeight: 600 }}>Até
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} style={{ display: 'block', marginTop: 6, border: '1px solid #dfe6ed', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#334257' }} />
        </label>
        <label style={{ display: 'block', fontSize: 12, color: '#617084', fontWeight: 600, flex: 1, minWidth: 200 }}>Protocolo, cliente ou código
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && loadEvents()} placeholder="Buscar..." style={{ display: 'block', width: '100%', marginTop: 6, border: '1px solid #dfe6ed', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#334257' }} />
        </label>
        <button type="button" className="primary-btn" style={{ padding: '9px 16px' }} onClick={loadEvents}><Search size={15} /> Filtrar</button>
      </div>
      {eventsLoading ? <p className="subheading" style={{ padding: '17px' }}>Carregando...</p> : auditGroups.length ? <div className="audit-groups">
        {auditGroups.map((group) => {
          const isOpen = expandedRequestIds.has(group.requestId)
          const chronological = [...group.events].reverse()
          return <div className="audit-group" key={group.requestId}>
            <button type="button" className="audit-group-header" onClick={() => toggleGroup(group.requestId)}>
              <div className="case-avatar blue">{group.companyName.slice(0, 2)}</div>
              <div><strong>{group.companyName}</strong><small>{group.protocol} · Código {group.clientCode}</small></div>
              <div className="audit-group-meta">
                <span className="audit-group-count">{group.events.length} evento{group.events.length > 1 ? 's' : ''}</span>
                <span className="time">{formatDateTime(group.events[0].createdAt)}</span>
                <ChevronDown size={16} className={isOpen ? 'audit-group-chevron open' : 'audit-group-chevron'} />
              </div>
            </button>
            {isOpen && <div className="audit-group-body">
              {chronological.map((event) => <div className="audit-timeline-item" key={event.id}>
                <span className="audit-timeline-dot"></span>
                <div><strong>{auditEventLabel[event.eventType] || event.eventType}</strong><small>{auditEventDetail(event)} · {event.actorName}</small></div>
                <span className="audit-timeline-time">{formatDateTime(event.createdAt)}</span>
              </div>)}
            </div>}
          </div>
        })}
      </div> : <p className="subheading" style={{ padding: '17px' }}>Nenhum evento encontrado para os filtros selecionados.</p>}
    </div>

    {detail && <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 560, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
      <div className="modal-head"><div><p className="eyebrow">DOSSIÊ {detail.protocol}</p><h2>{detail.companyName}</h2></div><button type="button" onClick={() => setDetail(null)}><X size={19} /></button></div>
      <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><span>Status</span><strong>{statusLabel[detail.status]}</strong></div>
        <div><span>Vendedor</span><strong>{detail.sellerName}</strong></div>
        <div><span>CNPJ</span><strong>{detail.cnpj}</strong></div>
        <div><span>Enviado em</span><strong>{formatDateTime(detail.submittedAt)}</strong></div>
        <div><span>Motivo da solicitação</span><strong>{detail.requestPurpose || '—'}</strong></div>
      </div>
      <div className="form-section-title">Documentos do dossiê</div>
      {detailLoading ? <p className="modal-copy">Carregando...</p> : <div className="report-files">
        {(['CONTRATO_SOCIAL', 'SERASA', 'DEPS'] as const).map((type) => {
          const doc = detailDocuments.find((d) => d.documentType === type)
          return <div className="report-file" key={type}>
            <div className={'report-icon ' + (type === 'SERASA' ? 'serasa' : 'deps')}><FileText size={18} /></div>
            <div><strong>{documentLabel[type]}</strong><small>{doc ? `${doc.originalName} · enviado por ${doc.uploadedByName}` : 'Não enviado'}</small></div>
            {doc ? <button type="button" className="small-action" onClick={() => viewDocument(doc.id)}>Visualizar</button> : <span className="pending-dot">!</span>}
          </div>
        })}
      </div>}
      {(detail.status === 'APROVADA' || detail.status === 'NEGADA') && <>
        <div className="form-section-title">Assinatura de confirmação</div>
        {detailDecision ? <><div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div><span>Decisão</span><strong className={detailDecision.decision === 'APROVADA' ? 'success-text' : 'danger-text'}>{statusLabel[detailDecision.decision]}</strong></div>
          <div><span>Limite aprovado</span><strong>{detailDecision.decision === 'APROVADA' ? money(detailDecision.approvedLimit) : '—'}</strong></div>
        </div>
        <p className="modal-copy">{detailDecision.internalReason || 'Nenhuma justificativa registrada.'}</p>
        <div className="check-line"><ShieldCheck size={16} /><div><strong>{detailDecision.managerName}</strong><small>{detailDecision.decision === 'APROVADA' ? 'Aprovado' : 'Negado'} em {formatDateTime(detailDecision.decidedAt)}</small></div></div></> : <p className="modal-copy">Registro de decisão não encontrado.</p>}
      </>}
      <div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setDetail(null)}>Fechar</button></div>
    </div></div>}
  </>
}

const passwordHint = 'Mínimo de 8 caracteres, com letras e números.'

function LoginScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [praticoSellerCode, setPraticoSellerCode] = useState('')
  const [storeName, setStoreName] = useState('')
  const [managerName, setManagerName] = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const switchMode = (nextMode: 'login' | 'register' | 'forgot') => { setMode(nextMode); setError(''); setEmail(''); setPassword(''); setConfirmPassword(''); setPraticoSellerCode(''); setStoreName(''); setManagerName(''); setWhatsappPhone(''); setForgotEmail(''); setForgotSent(false) }
  const submitForgot = async () => {
    if (!forgotEmail) { setError('Informe seu e-mail.'); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || 'Não foi possível processar a solicitação.'); return }
      setForgotSent(true)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setLoading(false) }
  }
  const submitLogin = async () => {
    if (!email || !password) { setError('Informe e-mail e senha.'); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await response.json()
      if (!response.ok) { setError(data.message || 'E-mail ou senha inválidos.'); return }
      localStorage.setItem(tokenKey, data.token)
      localStorage.setItem(userKey, JSON.stringify(data.user))
      onLogin(data.user as AuthUser)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setLoading(false) }
  }
  const submitRegister = async () => {
    if (!name || !email || !password || !confirmPassword || !praticoSellerCode || !storeName || !managerName || !whatsappPhone) { setError('Preencha todos os campos.'); return }
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, praticoSellerCode, storeName, managerName, whatsappPhone }) })
      const data = await response.json()
      if (!response.ok) { setError(data.message || 'Não foi possível criar sua conta.'); return }
      localStorage.setItem(tokenKey, data.token)
      localStorage.setItem(userKey, JSON.stringify(data.user))
      onLogin(data.user as AuthUser)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setLoading(false) }
  }
  const isRegister = mode === 'register'
  const isForgot = mode === 'forgot'
  return <div className="login-screen"><div className="login-panel"><div className="login-brand"><img src="/logo_sc.jpg" alt="Sis-Cred" className="login-brand-logo" /></div><div className="login-copy"><p className="eyebrow">PORTAL INTERNO</p><h1>{isForgot ? 'Redefinir senha' : isRegister ? 'Crie seu acesso de vendedor' : 'Entre no seu espaço de trabalho'}</h1><p>{isForgot ? 'Informe seu e-mail cadastrado para receber um link seguro de redefinição.' : isRegister ? 'Cadastre seu usuário e senha para enviar fichas de crédito.' : 'Informe seu e-mail e senha. O sistema identifica automaticamente sua função de acesso.'}</p></div>
    {isForgot
      ? (forgotSent
          ? <div><p className="modal-copy">Se o e-mail informado estiver cadastrado, enviamos um link válido por 30 minutos para redefinir a senha. Confira também a caixa de spam.</p><button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={() => switchMode('login')}>Voltar para o login</button></div>
          : <form onSubmit={(event) => { event.preventDefault(); submitForgot() }}>
              <label className="login-label">E-mail cadastrado<input type="email" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} required autoFocus /></label>
              {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
              <button className="primary-btn login-btn" type="submit" disabled={loading}>{loading ? 'Enviando...' : 'Enviar link de redefinição'} <ArrowUpRight size={17} /></button>
              <button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={() => switchMode('login')}>Voltar para o login</button>
            </form>)
      : isRegister
      ? <form onSubmit={(event) => { event.preventDefault(); submitRegister() }}>
          <label className="login-label">Nome completo<input type="text" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label className="login-label">E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="login-label">Código do vendedor no Prático<input type="text" value={praticoSellerCode} onChange={(event) => setPraticoSellerCode(event.target.value)} placeholder="Ex.: 1234" required /></label>
          <label className="login-label">Loja<input type="text" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Loja onde você trabalha" required /></label>
          <label className="login-label">Nome do gerente<input type="text" value={managerName} onChange={(event) => setManagerName(event.target.value)} placeholder="Gerente responsável por você" required /></label>
          <label className="login-label">WhatsApp<input type="text" value={whatsappPhone} onChange={(event) => setWhatsappPhone(event.target.value)} placeholder="(00) 00000-0000" required /></label>
          <label className="login-label">Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label className="login-label">Confirmar senha<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          <small className="login-foot"><ShieldCheck size={13} /> {passwordHint}</small>
          {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
          <button className="primary-btn login-btn" type="submit" disabled={loading}>{loading ? 'Criando conta...' : 'Criar minha conta'} <ArrowUpRight size={17} /></button>
          <button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={() => switchMode('login')}>Já tenho conta, entrar</button>
        </form>
      : <form onSubmit={(event) => { event.preventDefault(); submitLogin() }}>
          <label className="login-label">E-mail corporativo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="login-label">Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
          <button className="primary-btn login-btn" type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar no sistema'} <ArrowUpRight size={17} /></button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>Esqueci minha senha</button>
            <button type="button" className="link-btn" onClick={() => switchMode('register')}>Ainda não tenho usuário e senha</button>
          </div>
        </form>}
    <small className="login-foot"><ShieldCheck size={13} /> Ambiente interno com acessos por função</small></div><div className="login-aside"><div className="login-aside-art"><div className="art-ring ring-one"></div><div className="art-ring ring-two"></div><FileCheck2 size={46} /></div><h2>Do cadastro à decisão.</h2><p>Um fluxo único para reduzir retrabalho, proteger informações e acelerar o crédito.</p><div className="login-stat"><strong>100%</strong><span>digital</span></div></div></div>
}

function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submit = async () => {
    if (!newPassword || !confirmPassword) { setError('Preencha os dois campos.'); return }
    if (newPassword !== confirmPassword) { setError('As senhas não coincidem.'); return }
    setSubmitting(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || 'Não foi possível redefinir a senha.'); return }
      setSuccess(true)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }
  return <div className="login-screen"><div className="login-panel"><div className="login-brand"><img src="/logo_sc.jpg" alt="Sis-Cred" className="login-brand-logo" /></div><div className="login-copy"><p className="eyebrow">SEGURANÇA DA CONTA</p><h1>Redefinir senha</h1><p>{success ? 'Sua senha foi redefinida com sucesso.' : 'Escolha uma nova senha para voltar a acessar sua conta.'}</p></div>
    {success
      ? <button className="primary-btn login-btn" type="button" onClick={onDone}>Ir para o login <ArrowUpRight size={17} /></button>
      : <form onSubmit={(event) => { event.preventDefault(); submit() }}>
          <label className="login-label">Nova senha<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required autoFocus /></label>
          <label className="login-label">Confirmar nova senha<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          <small className="login-foot"><ShieldCheck size={13} /> {passwordHint}</small>
          {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
          <button className="primary-btn login-btn" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Redefinir senha'} <ArrowUpRight size={17} /></button>
        </form>}
    <small className="login-foot"><ShieldCheck size={13} /> Ambiente interno com acessos por função</small></div><div className="login-aside"><div className="login-aside-art"><div className="art-ring ring-one"></div><div className="art-ring ring-two"></div><FileCheck2 size={46} /></div><h2>Do cadastro à decisão.</h2><p>Um fluxo único para reduzir retrabalho, proteger informações e acelerar o crédito.</p><div className="login-stat"><strong>100%</strong><span>digital</span></div></div></div>
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subheading">{subtitle}</p></div>{action}</div> }
function SellerRequestsView({ requests, onNew, onEdit }: { requests: Request[]; onNew: () => void; onEdit: (item: Request) => void }) {
  const [detail, setDetail] = useState<Request | null>(null)
  return <><PageHeader eyebrow="ÁREA DO VENDEDOR" title="Minhas solicitações" subtitle="Acompanhe o andamento dos clientes enviados. Clique em um cliente para ver o processo e o resultado." action={<button className="primary-btn" onClick={onNew}><Plus size={18} /> Nova ficha cadastral</button>} />
    <div className="seller-list">{requests.length ? requests.map((item) => <button type="button" className="seller-request" key={item.id} onClick={() => setDetail(item)} style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}><div className="case-avatar blue">{item.companyName.slice(0, 2)}</div><div><strong>{item.companyName}</strong><small>Código Prático: {item.clientCode} · {item.cnpj} · {item.protocol}</small></div><span className={'status ' + (item.status === 'APROVADA' ? 'green' : item.status === 'NEGADA' || item.status === 'DEVOLVIDA' ? 'red' : 'blue')}><i></i>{statusLabel[item.status]}</span></button>) : <p className="subheading">Nenhuma solicitação enviada ainda.</p>}</div>
    {detail && <SellerRequestDetailModal request={detail} onClose={() => setDetail(null)} onEdit={onEdit} />}
  </>
}

const sellerProcessSteps = [
  { key: 'RECEBIDA', label: 'Recebida' },
  { key: 'EM_ANALISE', label: 'Em análise' },
  { key: 'AGUARDANDO_GESTAO', label: 'Aguardando gestão' },
  { key: 'DECISAO', label: 'Decisão' },
]
const sellerStepIndex: Record<Status, number> = { RECEBIDA: 0, EM_ANALISE: 1, AGUARDANDO_GESTAO: 2, APROVADA: 3, NEGADA: 3, DEVOLVIDA: 0 }

function SellerRequestDetailModal({ request, onClose, onEdit }: { request: Request; onClose: () => void; onEdit: (item: Request) => void }) {
  const [decisionDetail, setDecisionDetail] = useState<DecisionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const isDecided = request.status === 'APROVADA' || request.status === 'NEGADA'
  const isReturned = request.status === 'DEVOLVIDA'
  useEffect(() => {
    if (!isDecided) { setDecisionDetail(null); return }
    setLoading(true)
    apiFetch(`/api/credit-requests/${request.id}/decision`).then((response) => (response.ok ? response.json() : null)).then(setDecisionDetail).finally(() => setLoading(false))
  }, [request.id, isDecided])
  const stepIndex = sellerStepIndex[request.status]

  return <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 520 }}>
    <div className="modal-head"><div><p className="eyebrow">SOLICITAÇÃO {request.protocol}</p><h2>{request.companyName}</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div>
    <p className="modal-copy">Código Prático: {request.clientCode} · {request.cnpj}</p>
    <div className="request-steps">{sellerProcessSteps.map((step, index) => {
      const isDanger = (index === 3 && request.status === 'NEGADA') || (index === 0 && isReturned)
      const stateClass = index < stepIndex ? 'done' : index === stepIndex ? `active${isDanger ? ' danger' : ''}` : ''
      return <div className={`request-step ${stateClass}`} key={step.key}><span className="request-step-dot">{index < stepIndex ? <Check size={12} /> : index + 1}</span><span>{index === 3 && isDecided ? statusLabel[request.status] : index === 0 && isReturned ? statusLabel[request.status] : step.label}</span></div>
    })}</div>
    {isDecided ? (
      loading ? <p className="modal-copy">Carregando...</p> : decisionDetail ? <>
        <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div><span>Resultado</span><strong className={decisionDetail.decision === 'APROVADA' ? 'success-text' : 'danger-text'}>{statusLabel[decisionDetail.decision]}</strong></div>
          <div><span>Limite aprovado</span><strong>{decisionDetail.decision === 'APROVADA' ? money(decisionDetail.approvedLimit) : '—'}</strong></div>
        </div>
        <div className="form-section-title">Justificativa</div>
        <p className="modal-copy">{decisionDetail.clientMessage || (decisionDetail.decision === 'APROVADA' ? 'Crédito aprovado pela gestão.' : 'Fale com a gestão para mais detalhes sobre a negativa.')}</p>
        <div className="check-line"><ShieldCheck size={16} /><div><strong>{decisionDetail.managerName}</strong><small>Decidido em {formatDateTime(decisionDetail.decidedAt)}</small></div></div>
      </> : <p className="modal-copy">Decisão registrada, mas os detalhes não estão disponíveis no momento.</p>
    ) : isReturned ? <>
      <div className="notice notice-error"><X size={17} /> A analista devolveu este cadastro para ajustes.</div>
      <div className="form-section-title">Motivo da devolução</div>
      <p className="modal-copy">{request.returnReason || '—'}</p>
      <button type="button" className="primary-btn full" onClick={() => onEdit(request)}><Pencil size={16} /> Editar e reenviar</button>
    </> : <p className="modal-copy">Sua solicitação está em andamento. Assim que a gestão decidir, o resultado e a justificativa aparecerão aqui.</p>}
    <div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Fechar</button></div>
  </div></div>
}
const splitMultiple = (value: string | null): string[] => {
  const parts = (value || '').split(';').map((part) => part.trim()).filter(Boolean)
  return parts.length ? parts : ['']
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// O Prático às vezes devolve vários e-mails numa única linha, separados por ";" ou ",".
const splitEmails = (value: string | null): string[] =>
  (value || '').split(/[;,]+/).map((part) => part.trim()).filter((part) => emailPattern.test(part))

function SellerForm({ onSubmit, initialRequest }: { onSubmit: (form: HTMLFormElement, contractFile: File | null) => Promise<string | null>; initialRequest?: Request | null }) {
  const isEditing = !!initialRequest
  const initialNames = splitMultiple(initialRequest?.contactName ?? null)
  const initialPhones = splitMultiple(initialRequest?.phone ?? null)
  const initialEmails = splitMultiple(initialRequest?.contactEmail ?? null)
  const [cnpj, setCnpj] = useState(() => (initialRequest ? formatDocument(initialRequest.cnpj) : ''))
  const [lookupMode, setLookupMode] = useState<'code' | 'document'>('code')
  const [lookupValue, setLookupValue] = useState('')
  const [lookupResults, setLookupResults] = useState<PraticoClient[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupFilled, setLookupFilled] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState(initialRequest?.deliveryLocation === 'Outro endereço' ? 'Outro endereço' : 'Endereço da empresa')
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [nameIds, setNameIds] = useState(() => initialNames.map((_, index) => index))
  const [phoneIds, setPhoneIds] = useState(() => initialPhones.map((_, index) => index))
  const [emailIds, setEmailIds] = useState(() => initialEmails.map((_, index) => index))
  const nextFieldId = useRef(Math.max(initialNames.length, initialPhones.length, initialEmails.length, 1))
  const addNameField = () => setNameIds((ids) => [...ids, nextFieldId.current++])
  const removeNameField = (id: number) => setNameIds((ids) => ids.filter((x) => x !== id))
  const addPhoneField = () => setPhoneIds((ids) => [...ids, nextFieldId.current++])
  const removePhoneField = (id: number) => setPhoneIds((ids) => ids.filter((x) => x !== id))
  const addEmailField = () => setEmailIds((ids) => [...ids, nextFieldId.current++])
  const removeEmailField = (id: number) => setEmailIds((ids) => ids.filter((x) => x !== id))
  const contractInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const pendingEmailFill = useRef<string[] | null>(null)

  // Quando o Prático manda mais e-mails do que a ficha tem campos abertos, cria campos extras
  // (o mesmo "+" que o vendedor usa manualmente) e preenche cada e-mail no seu próprio campo
  // assim que eles existirem no DOM.
  useEffect(() => {
    if (!pendingEmailFill.current) return
    const emails = pendingEmailFill.current
    pendingEmailFill.current = null
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>('[name="contactEmail"]')
    inputs?.forEach((input, index) => { if (!input.value.trim() && emails[index]) input.value = emails[index] })
  }, [emailIds])

  // Preenche os campos com o cadastro do Prático. Campos de contato só são preenchidos
  // quando ainda estão vazios, para não apagar o que o vendedor já digitou.
  const applyPraticoClient = (client: PraticoClient) => {
    const form = formRef.current
    if (!form) return
    const field = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)
    const set = (name: string, value: string | null) => { const input = field(name); if (input) input.value = value ?? '' }
    const setIfEmpty = (name: string, value: string | null) => { const input = field(name); if (input && !input.value.trim() && value) input.value = value }
    set('clientCode', client.clientCode)
    setCnpj(formatDocument(client.document ?? ''))
    set('companyName', client.companyName)
    set('tradeName', client.tradeName)
    set('stateRegistration', client.stateRegistration)
    set('address', client.address)
    setIfEmpty('phone', client.phones[0] ?? null)

    // O campo "contato" do cadastro no Prático às vezes vem com um e-mail digitado em vez de um
    // nome — nesse caso é o e-mail da cobrança/financeiro (ex.: tesouraria@...), não o nome do
    // contato nem mais um e-mail de contato, então vai direto para "E-mail financeiro".
    const contactNameTrimmed = client.contactName?.trim() ?? ''
    const contactNameIsEmail = emailPattern.test(contactNameTrimmed)
    setIfEmpty('contactName', contactNameIsEmail ? null : client.contactName)
    setIfEmpty('financeEmail', contactNameIsEmail ? contactNameTrimmed : null)

    const emails = [...new Set(splitEmails(client.email))]
    if (emails.length) {
      const existingEmailInputs = Array.from(form.querySelectorAll<HTMLInputElement>('[name="contactEmail"]'))
      existingEmailInputs.forEach((input, index) => { if (!input.value.trim() && emails[index]) input.value = emails[index] })
      const missing = emails.length - existingEmailInputs.length
      if (missing > 0) {
        for (let i = 0; i < missing; i++) addEmailField()
        pendingEmailFill.current = emails
      }
    }
    setIfEmpty('invoiceEmail', emails[0] ?? null)
    setLookupResults([]); setLookupError('')
    setLookupFilled(`Dados do cliente ${client.clientCode} — ${client.companyName ?? ''} carregados do Prático. Confira antes de enviar.`)
  }

  const searchPratico = async () => {
    if (lookupLoading) return
    const value = lookupValue.trim()
    if (lookupMode === 'code' && !/^\d+$/.test(value)) { setLookupError('Informe o código do cliente no Prático (somente números).'); return }
    if (lookupMode === 'document') {
      const length = value.replace(/[^A-Z0-9]/gi, '').length
      if (length !== 11 && length !== 14) { setLookupError('Informe um CPF (11 dígitos) ou CNPJ (14 caracteres) válido.'); return }
    }
    setLookupLoading(true); setLookupError(''); setLookupFilled(''); setLookupResults([])
    try {
      const response = await apiFetch(`/api/pratico/clients?by=${lookupMode}&value=${encodeURIComponent(value)}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) { setLookupError(data?.message || (response.status === 404 ? 'Rota de busca no Prático não encontrada — reinicie a API do Sis-Cred para carregar a atualização.' : `Não foi possível consultar o Prático (HTTP ${response.status}).`)); return }
      const clients = data as PraticoClient[]
      if (!clients.length) setLookupError(lookupMode === 'code' ? 'Nenhum cliente encontrado no Prático com esse código.' : 'Nenhum cliente encontrado no Prático com esse CPF/CNPJ.')
      else if (clients.length === 1) applyPraticoClient(clients[0])
      else setLookupResults(clients)
    } catch { setLookupError('Não foi possível consultar o Prático. Tente novamente ou preencha manualmente.')
    } finally { setLookupLoading(false) }
  }

  const resetForm = (form: HTMLFormElement) => {
    form.reset()
    setCnpj(initialRequest ? formatDocument(initialRequest.cnpj) : ''); setContractFile(null)
    setLookupValue(''); setLookupResults([]); setLookupError(''); setLookupFilled('')
    setDeliveryLocation(initialRequest?.deliveryLocation === 'Outro endereço' ? 'Outro endereço' : 'Endereço da empresa')
    setNameIds(initialNames.map((_, index) => index)); setPhoneIds(initialPhones.map((_, index) => index)); setEmailIds(initialEmails.map((_, index) => index))
  }

  const submit = async (form: HTMLFormElement) => {
    if (!contractFile && !isEditing) { setSubmitError('Anexe o contrato social ou certificado de empresário individual (PDF).'); return }
    setSubmitting(true); setSubmitError('')
    const error = await onSubmit(form, contractFile)
    if (error) setSubmitError(error); else if (!isEditing) resetForm(form)
    setSubmitting(false)
  }

  return <form className="form-page" ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget) }}>
    <PageHeader eyebrow="FICHA CADASTRAL DIGITAL" title={isEditing ? 'Corrigir e reenviar cadastro' : 'Novo cadastro de cliente'} subtitle={isEditing ? 'Ajuste as informações apontadas pela analista e reenvie para uma nova triagem.' : 'Para atender sua solicitação com rapidez e sem erros, preencha todos os campos abaixo.'} />
    {isEditing && initialRequest?.returnReason && <div className="notice notice-error"><X size={17} /> Motivo da devolução: {initialRequest.returnReason}</div>}

    <div className="form-section">
      <div className="form-section-head"><div className="form-section-icon"><Building2 size={16} /></div><div><h3>Identificação da empresa</h3><p>Dados cadastrais e localização do cliente</p></div></div>
      <div className="form-grid">
        <label>Buscar cadastro no Prático por<select value={lookupMode} onChange={(event) => { setLookupMode(event.target.value as 'code' | 'document'); setLookupValue(''); setLookupError(''); setLookupResults([]) }}><option value="code">Código do cliente</option><option value="document">CNPJ ou CPF</option></select></label>
        <label>{lookupMode === 'code' ? 'Código do cliente no Prático' : 'CNPJ ou CPF do cliente'}<input placeholder={lookupMode === 'code' ? 'Ex.: 258912' : '00.000.000/0000-00 ou 000.000.000-00'} inputMode={lookupMode === 'code' ? 'numeric' : undefined} maxLength={lookupMode === 'code' ? 9 : 18} value={lookupValue} onChange={(event) => setLookupValue(lookupMode === 'code' ? event.target.value.replace(/\D/g, '') : formatDocument(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchPratico() } }} /></label>
      </div>
      <button type="button" className="outline-btn" style={{ marginTop: 0, marginBottom: 13 }} onClick={searchPratico} disabled={lookupLoading}><Search size={15} /> {lookupLoading ? 'Consultando o Prático...' : 'Buscar no Prático e preencher'}</button>
      {lookupError && <div className="notice notice-error"><X size={17} /> {lookupError}</div>}
      {lookupFilled && <div className="notice" style={{ margin: '0 0 15px' }}><Check size={17} /> {lookupFilled}</div>}
      {lookupResults.length > 0 && <div style={{ marginBottom: 15 }}>
        <p className="field-label" style={{ marginBottom: 6 }}>Mais de um cadastro encontrado — selecione o cliente:</p>
        {lookupResults.map((client) => <button type="button" className="queue-item" style={{ width: '100%' }} key={`${client.companyCode}-${client.clientCode}`} onClick={() => applyPraticoClient(client)}>
          <div className="case-avatar blue">{(client.companyName ?? '?').slice(0, 2)}</div>
          <div><strong>{client.companyName ?? '—'}</strong><small>Código {client.clientCode}{client.companyCode != null ? ` · Empresa ${client.companyCode}` : ''} · {client.document ?? 'sem documento'}{client.address ? ` · ${client.address}` : ''}</small></div>
        </button>)}
      </div>}
      <div className="form-grid">
        <label>Código do cadastro (Prático)<span className="required-mark">*</span><input name="clientCode" required placeholder="Ex.: 258912" defaultValue={initialRequest?.clientCode ?? ''} /></label>
        <label>CNPJ ou CPF<span className="required-mark">*</span><input name="cnpj" required placeholder="00.000.000/0000-00" maxLength={18} value={cnpj} onChange={(event) => setCnpj(formatDocument(event.target.value))} /></label>
      </div>
      <label>Razão social<span className="required-mark">*</span><input name="companyName" required placeholder="Ex.: Nome da Empresa Ltda" defaultValue={initialRequest?.companyName ?? ''} /></label>
      <div className="form-grid">
        <label>Nome fantasia<input name="tradeName" placeholder="Nome comercial" defaultValue={initialRequest?.tradeName ?? ''} /></label>
        <label>Inscrição estadual<input name="stateRegistration" placeholder="Número da IE" defaultValue={initialRequest?.stateRegistration ?? ''} /></label>
      </div>
      <label>Endereço completo<input name="address" placeholder="Rua, número, bairro, cidade e UF" defaultValue={initialRequest?.address ?? ''} /></label>
    </div>

    <div className="form-section">
      <div className="form-section-head"><div className="form-section-icon"><MessageSquareText size={16} /></div><div><h3>O que você precisa?</h3><p>Explique o motivo da solicitação</p></div></div>
      <label>Explique com clareza o que você deseja<span className="required-mark">*</span><textarea name="requestPurpose" required rows={2} placeholder="Ex.: aprovação para faturamento, atualização de limite, novo cadastro..." defaultValue={initialRequest?.requestPurpose ?? ''}></textarea></label>
    </div>

    <div className="form-section">
      <div className="form-section-head"><div className="form-section-icon"><Phone size={16} /></div><div><h3>Contato do cliente ou responsável</h3><p>Quem vamos procurar para confirmar os dados</p></div></div>
      <div className="field-label-row"><span className="field-label">Nome do contato<span className="required-mark">*</span></span><button type="button" className="add-field-btn" onClick={addNameField}><Plus size={14} /></button></div>
      {nameIds.map((id, index) => <div className="dynamic-field-row" key={id}>
        <input name="contactName" required={index === 0} placeholder="Nome do responsável" defaultValue={initialNames[index] ?? ''} />
        {nameIds.length > 1 && <button type="button" className="remove-field-btn" onClick={() => removeNameField(id)}><X size={14} /></button>}
      </div>)}
      <div className="field-label-row" style={{ marginTop: 12 }}><span className="field-label">Telefone<span className="required-mark">*</span></span><button type="button" className="add-field-btn" onClick={addPhoneField}><Plus size={14} /></button></div>
      {phoneIds.map((id, index) => <div className="dynamic-field-row" key={id}>
        <input name="phone" required={index === 0} placeholder="(00) 0000-0000" defaultValue={initialPhones[index] ?? ''} />
        {phoneIds.length > 1 && <button type="button" className="remove-field-btn" onClick={() => removePhoneField(id)}><X size={14} /></button>}
      </div>)}
      <div className="field-label-row" style={{ marginTop: 12 }}><span className="field-label">E-mail de contato<span className="required-mark">*</span></span><button type="button" className="add-field-btn" onClick={addEmailField}><Plus size={14} /></button></div>
      {emailIds.map((id, index) => <div className="dynamic-field-row" key={id}>
        <input name="contactEmail" type="email" required={index === 0} placeholder="responsavel@cliente.com.br" defaultValue={initialEmails[index] ?? ''} />
        {emailIds.length > 1 && <button type="button" className="remove-field-btn" onClick={() => removeEmailField(id)}><X size={14} /></button>}
      </div>)}
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>E-mail para NFe e avisos de vencimento<span className="required-mark">*</span><input name="invoiceEmail" type="email" required placeholder="financeiro@cliente.com.br" defaultValue={initialRequest?.invoiceEmail ?? ''} /></label>
        <label>E-mail financeiro<input name="financeEmail" type="email" placeholder="contas@cliente.com.br" defaultValue={initialRequest?.financeEmail ?? ''} /></label>
      </div>
    </div>

    <div className="form-section">
      <div className="form-section-head"><div className="form-section-icon"><ClipboardList size={16} /></div><div><h3>Perguntas obrigatórias</h3><p>Ajudam a analista a validar a operação</p></div></div>
      <label>Como o cliente chegou até você?<span className="required-mark">*</span><select name="origin" required defaultValue={initialRequest?.origin ?? 'Prospecção'}><option>Prospecção</option><option>Indicação</option><option>Visita de vendedor externo</option><option>Cliente já conhecido</option></select></label>
      <div className="form-grid">
        <label>Forma de autorização de compra?<span className="required-mark">*</span><select name="purchaseAuthorization" required defaultValue={initialRequest?.purchaseAuthorization ?? 'E-mail formal'}><option>E-mail formal</option><option>Ligação telefônica</option><option>WhatsApp</option><option>Pedido de compra assinado</option><option>Outro</option></select></label>
        <label>Tipo de entrega?<span className="required-mark">*</span><select name="deliveryType" required defaultValue={initialRequest?.deliveryType ?? 'Transportadora'}><option>Transportadora</option><option>Retirada no local</option><option>Entrega própria</option><option>Outro</option></select></label>
      </div>
      <label>Local da entrega (empresa ou outro)?<span className="required-mark">*</span><select name="deliveryLocation" required value={deliveryLocation} onChange={(event) => setDeliveryLocation(event.target.value)}><option>Endereço da empresa</option><option>Outro endereço</option></select></label>
      {deliveryLocation === 'Outro endereço' && <label>Endereço de entrega<span className="required-mark">*</span><input name="deliveryAddress" required placeholder="Rua, número, bairro, cidade e UF" defaultValue={initialRequest?.deliveryAddress ?? ''} /></label>}
    </div>

    <div className="form-section">
      <div className="form-section-head"><div className="form-section-icon"><Paperclip size={16} /></div><div><h3>Documentos e observações</h3><p>Contrato social e informações finais</p></div></div>
      <button type="button" className={contractFile ? 'upload-dropzone filled' : 'upload-dropzone'} onClick={() => contractInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) setContractFile(file) }}>
        <div className="upload-dropzone-icon">{contractFile ? <FileCheck2 size={18} /> : <UploadCloud size={18} />}</div>
        <div><strong>{contractFile ? contractFile.name : isEditing ? 'Trocar contrato social ou certificado de empresário individual (opcional)' : <>Anexar contrato social ou certificado de empresário individual<span className="required-mark">*</span></>}</strong><small>{contractFile ? 'Clique para trocar o arquivo' : isEditing ? 'Só anexe se precisar substituir o arquivo já enviado' : 'Clique aqui ou arraste o PDF'}</small></div>
      </button>
      <input ref={contractInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(event) => setContractFile(event.target.files?.[0] || null)} />
      <label style={{ marginTop: 14 }}>Observações do vendedor<textarea name="sellerNotes" rows={3} placeholder="Contato negociado, responsáveis e outras informações relevantes" defaultValue={initialRequest?.sellerNotes ?? ''}></textarea></label>
    </div>

    {submitError && <div className="notice notice-error"><X size={17} /> {submitError}</div>}
    <div className="form-page-actions"><button type="button" className="cancel-btn" onClick={() => formRef.current && resetForm(formRef.current)}>Limpar formulário</button><button type="submit" className="primary-btn" disabled={submitting}><Send size={17} /> {submitting ? (isEditing ? 'Reenviando...' : 'Enviando...') : isEditing ? 'Reenviar para análise' : 'Enviar para análise'}</button></div>
  </form>
}
type DecisionDetail = { protocol: string; companyName: string; decision: 'APROVADA' | 'NEGADA'; approvedLimit: number | null; internalReason: string | null; clientMessage: string | null; decidedAt: string; managerName: string }
const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

// Cartão de dados do vendedor, reaproveitado na triagem da analista e nas duas telas da
// gestão (fila e negadas) para manter a mesma organização visual nos três lugares.
function SellerInfoCard({ request }: { request: Request }) {
  return <section className="review-card">
    <div className="form-section-head" style={{ marginBottom: 18 }}>
      <div className="form-section-icon"><Users size={16} /></div>
      <div><h2>Dados do vendedor</h2><p>Quem fez a solicitação</p></div>
    </div>
    <div className="data-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: 0 }}>
      <div><span>Nome</span><strong>{request.sellerName || '—'}</strong></div>
      <div><span>Código no Prático</span><strong>{request.sellerCode || '—'}</strong></div>
      <div><span>Loja</span><strong>{request.sellerStore || '—'}</strong></div>
      <div><span>Gerente responsável</span><strong>{request.sellerManagerName || '—'}</strong></div>
      <div><span>E-mail</span><strong>{request.sellerEmail || '—'}</strong></div>
      <div><span>WhatsApp</span><strong>{request.sellerWhatsapp ? <a href={whatsappLink(request.sellerWhatsapp)} target="_blank" rel="noreferrer">{request.sellerWhatsapp}</a> : '—'}</strong></div>
    </div>
  </section>
}

// Empresa, motivo do pedido, contato do cliente e perguntas obrigatórias — o conjunto de
// informações que tanto a analista quanto a gestão precisam ler antes de decidir. Um cartão
// por assunto, com ícone e título, em vez de uma lista corrida de campos.
function RequestOverviewCards({ request }: { request: Request }) {
  return <>
    <section className="review-card" style={{ marginTop: 16 }}>
      <div className="form-section-head" style={{ marginBottom: 18 }}>
        <div className="form-section-icon"><Building2 size={16} /></div>
        <div><h2>Identificação da empresa</h2><p>Dados cadastrais e localização do cliente</p></div>
      </div>
      <div className="data-grid" style={{ margin: 0 }}>
        <div><span>Código do cadastro (Prático)</span><strong>{request.clientCode || '—'}</strong></div>
        <div><span>CNPJ</span><strong>{request.cnpj || '—'}</strong></div>
        <div><span>Razão social</span><strong>{request.companyName || '—'}</strong></div>
        <div><span>Nome fantasia</span><strong>{request.tradeName || '—'}</strong></div>
        <div><span>Inscrição estadual</span><strong>{request.stateRegistration || '—'}</strong></div>
        <div><span>Endereço completo</span><strong>{request.address || '—'}</strong></div>
      </div>
    </section>

    <section className="review-card" style={{ marginTop: 16 }}>
      <div className="form-section-head" style={{ marginBottom: 14 }}>
        <div className="form-section-icon"><MessageSquareText size={16} /></div>
        <div><h2>O que o vendedor precisa</h2><p>Motivo da solicitação</p></div>
      </div>
      <p className="modal-copy" style={{ margin: 0 }}>{request.requestPurpose || '—'}</p>
    </section>

    <section className="review-card" style={{ marginTop: 16 }}>
      <div className="form-section-head" style={{ marginBottom: 18 }}>
        <div className="form-section-icon"><Phone size={16} /></div>
        <div><h2>Contato do cliente ou responsável</h2><p>Quem confirma os dados no cliente</p></div>
      </div>
      <div className="data-grid" style={{ margin: 0 }}>
        <div><span>Nome do contato</span><strong>{request.contactName || '—'}</strong></div>
        <div><span>Telefone</span><strong>{request.phone || '—'}</strong></div>
        <div><span>E-mail de contato</span><strong>{request.contactEmail || '—'}</strong></div>
        <div><span>E-mail para NFe e avisos de vencimento</span><strong>{request.invoiceEmail || '—'}</strong></div>
        <div><span>E-mail financeiro</span><strong>{request.financeEmail || '—'}</strong></div>
      </div>
    </section>

    <section className="review-card" style={{ marginTop: 16 }}>
      <div className="form-section-head" style={{ marginBottom: 18 }}>
        <div className="form-section-icon"><ClipboardList size={16} /></div>
        <div><h2>Perguntas obrigatórias</h2><p>Ajudam a validar a operação</p></div>
      </div>
      <div className="data-grid" style={{ margin: 0 }}>
        <div><span>Como o cliente chegou até você?</span><strong>{request.origin || '—'}</strong></div>
        <div><span>Forma de autorização de compra?</span><strong>{request.purchaseAuthorization || '—'}</strong></div>
        <div><span>Tipo de entrega?</span><strong>{request.deliveryType || '—'}</strong></div>
        <div><span>Local da entrega</span><strong>{request.deliveryLocation || '—'}</strong></div>
        {request.deliveryAddress && <div><span>Endereço de entrega</span><strong>{request.deliveryAddress}</strong></div>}
      </div>
    </section>

    {request.sellerNotes && <section className="review-card" style={{ marginTop: 16 }}>
      <div className="form-section-head" style={{ marginBottom: 14 }}>
        <div className="form-section-icon"><Paperclip size={16} /></div>
        <div><h2>Observações do vendedor</h2><p>Informações adicionais registradas no envio</p></div>
      </div>
      <p className="modal-copy" style={{ margin: 0 }}>{request.sellerNotes}</p>
    </section>}
  </>
}

function AnalystView({ requests, selected, setSelected, onSend, onReturned }: { requests: Request[]; selected: Request; setSelected: (item: Request) => void; onSend: () => void; onReturned: () => void }) {
  const serasaInputRef = useRef<HTMLInputElement>(null)
  const depsInputRef = useRef<HTMLInputElement>(null)
  const [requestDocuments, setRequestDocuments] = useState<DossierDocument[]>([])
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const pushToast = useToast()
  useEffect(() => { if (selected.id) listDocuments(selected.id).then(setRequestDocuments); else setRequestDocuments([]) }, [selected.id])
  const contractDoc = requestDocuments.find((d) => d.documentType === 'CONTRATO_SOCIAL')
  const serasaDoc = requestDocuments.find((d) => d.documentType === 'SERASA')
  const depsDoc = requestDocuments.find((d) => d.documentType === 'DEPS')
  const handleUpload = async (documentType: 'SERASA' | 'DEPS', file: File | undefined) => {
    if (!file || !selected.id) return
    setUploadingType(documentType); setUploadError('')
    try {
      const response = await uploadDocument(selected.id, documentType, file)
      if (!response.ok) { const body = await response.json().catch(() => null); setUploadError(body?.message || 'Não foi possível salvar o PDF.'); return }
      setRequestDocuments(await listDocuments(selected.id))
    } catch { setUploadError('Não foi possível salvar o PDF. Confira sua conexão e tente novamente.')
    } finally { setUploadingType(null) }
  }
  const handleRemove = async (documentType: 'SERASA' | 'DEPS', documentId: number) => {
    if (!selected.id) return
    setUploadingType(documentType); setUploadError('')
    try {
      const response = await apiFetch(`/api/documents/${documentId}`, { method: 'DELETE' })
      if (!response.ok) { const body = await response.json().catch(() => null); setUploadError(body?.message || 'Não foi possível remover o PDF.'); return }
      setRequestDocuments(await listDocuments(selected.id))
    } catch { setUploadError('Não foi possível remover o PDF. Confira sua conexão e tente novamente.')
    } finally { setUploadingType(null) }
  }
  const bothUploaded = !!serasaDoc && !!depsDoc

  return <>
    <PageHeader eyebrow="ÁREA DA ANALISTA" title="Triagem e montagem do dossiê" subtitle="Receba os cadastros, anexe os relatórios e envie uma análise completa para a gestão." />
    <div className="analyst-layout">
      <div className="queue-card">
        <div className="queue-header">
          <div><h2>Fila de solicitações</h2><p>{requests.length} cadastro(s) aguardando tratamento</p></div>
          <div className="search"><Search size={16} /><input placeholder="Buscar cliente" /></div>
        </div>
        {requests.length ? requests.map((item) => <button className={selected.id === item.id ? 'queue-item selected' : 'queue-item'} key={item.id} onClick={() => setSelected(item)}><div className="case-avatar blue">{item.companyName.slice(0, 2)}</div><div><strong>{item.companyName}</strong><small>{item.cnpj}</small></div><span className="queue-time">{statusLabel[item.status]}</span></button>) : <p className="subheading" style={{ padding: '17px' }}>Nenhum cadastro na fila.</p>}
      </div>
      <div className="dossier-panel">{!selected.id ? <div style={{ padding: '60px 30px', textAlign: 'center' }}><FileCheck2 size={34} style={{ color: '#b8cdfb', marginBottom: 14 }} /><p className="subheading">Selecione um cliente na fila ao lado para ver os dados do cadastro.</p></div> : <>
        <div className="dossier-head">
          <div><p className="eyebrow">DOSSIÊ {selected.protocol}</p><h2>{selected.companyName}</h2><span>Código Prático: {selected.clientCode} · {selected.cnpj} · solicitado por {selected.sellerName}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button type="button" className="deny-btn" style={{ padding: '9px 14px' }} onClick={() => setShowReturnModal(true)}><X size={15} /> Recusar cadastro</button><span className="status blue"><i></i>{statusLabel[selected.status]}</span></div>
        </div>
        {showReturnModal && <ReturnToSellerModal item={selected} onClose={() => setShowReturnModal(false)} onReturned={(emailSent) => { setShowReturnModal(false); onReturned(); pushToast('success', emailSent ? 'Cadastro devolvido ao vendedor. Ele foi avisado por e-mail.' : 'Cadastro devolvido ao vendedor.') }} />}

        <div style={{ marginTop: 18 }}><SellerInfoCard request={selected} /></div>
        <RequestOverviewCards request={selected} />

        <section className="review-card" style={{ marginTop: 16 }}>
          <div className="form-section-head" style={{ marginBottom: 18 }}>
            <div className="form-section-icon"><FileCheck2 size={16} /></div>
            <div><h2>Documentos enviados pelo vendedor</h2><p>Contrato social ou certificado de empresário individual</p></div>
          </div>
          <div className="report-files"><ReportFile icon="deps" name="Contrato social / Certificado MEI" detail={contractDoc ? `${contractDoc.originalName} · anexado pelo vendedor` : 'Não anexado pelo vendedor'} complete={!!contractDoc} onClick={() => contractDoc && viewDocument(contractDoc.id)} /></div>
        </section>

        <section className="review-card" style={{ marginTop: 16 }}>
          <div className="form-section-head" style={{ marginBottom: 18 }}>
            <div className="form-section-icon"><FileText size={16} /></div>
            <div><h2>Relatórios de crédito</h2><p>Clique em cada relatório abaixo para escolher o PDF correspondente</p></div>
          </div>
          {uploadError && <div className="notice notice-error"><X size={17} /> {uploadError}</div>}
          <div className="report-files">
            <ReportFile icon="serasa" name="Consulta Serasa" detail={serasaDoc ? `${serasaDoc.originalName} · PDF original anexado` : uploadingType === 'SERASA' ? 'Enviando...' : 'Clique para escolher o PDF'} complete={!!serasaDoc} onClick={() => (serasaDoc ? viewDocument(serasaDoc.id) : serasaInputRef.current?.click())} onRemove={serasaDoc ? () => handleRemove('SERASA', serasaDoc.id) : undefined} />
            <ReportFile icon="deps" name="Avaliação DEPS" detail={depsDoc ? `${depsDoc.originalName} · PDF original anexado` : uploadingType === 'DEPS' ? 'Enviando...' : 'Clique para escolher o PDF'} complete={!!depsDoc} onClick={() => (depsDoc ? viewDocument(depsDoc.id) : depsInputRef.current?.click())} onRemove={depsDoc ? () => handleRemove('DEPS', depsDoc.id) : undefined} />
          </div>
          <input ref={serasaInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(event) => handleUpload('SERASA', event.target.files?.[0])} />
          <input ref={depsInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(event) => handleUpload('DEPS', event.target.files?.[0])} />
          {bothUploaded && <div className="extracted">
            <div className="extracted-title"><Check size={16} /> Informações extraídas dos relatórios</div>
            {depsDoc?.extractedData ? <div className="data-grid compact"><div><span>Classificação DEPS</span><strong>{depsDoc.extractedData.classification}</strong></div><div><span>Limite sugerido</span><strong>{money(depsDoc.extractedData.suggestedLimit)}</strong></div><div><span>Risco</span><strong className="danger-text">{depsDoc.extractedData.risk || '—'}</strong></div><div><span>Protestos</span><strong className="danger-text">{depsDoc.extractedData.protests ? `${depsDoc.extractedData.protests.count} · ${money(depsDoc.extractedData.protests.value)}` : '—'}</strong></div><div><span>PEFIN</span><strong className="warning-text">{depsDoc.extractedData.pefin ? `${depsDoc.extractedData.pefin.count} · ${money(depsDoc.extractedData.pefin.value)}` : '—'}</strong></div><div><span>Histórico pontual</span><strong>{depsDoc.extractedData.paymentHistoryPercent != null ? `${depsDoc.extractedData.paymentHistoryPercent.toLocaleString('pt-BR')}%` : '—'}</strong></div></div> : <p className="modal-copy" style={{ margin: 0 }}>Não foi possível extrair os dados automaticamente deste PDF. Confira o arquivo original de Avaliação DEPS.</p>}
          </div>}
        </section>

        <button className="primary-btn send-management" disabled={!bothUploaded} onClick={onSend}><Send size={17} /> Enviar dossiê para gestão</button>
      </>}</div>
    </div>
  </>
}
function ReportFile({ icon, name, detail, complete, onClick, onRemove }: { icon: string; name: string; detail: string; complete: boolean; onClick: () => void; onRemove?: () => void }) {
  if (!complete) return <button type="button" className="report-file" onClick={onClick} style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}><div className={'report-icon ' + icon}><FileText size={18} /></div><div><strong>{name}</strong><small>{detail}</small></div><UploadCloud size={16} /></button>
  return <div className="report-file report-file-complete">
    <div className={'report-icon ' + icon}><FileText size={18} /></div>
    <div><strong>{name}</strong><small>{detail}</small></div>
    <div className="report-file-actions">
      <button type="button" className="report-file-action" title="Visualizar PDF" onClick={onClick}><FileCheck2 size={15} /></button>
      {onRemove && <button type="button" className="report-file-action danger" title="Remover PDF" onClick={onRemove}><Trash2 size={15} /></button>}
    </div>
  </div>
}

function ReturnToSellerModal({ item, onClose, onReturned }: { item: Request; onClose: () => void; onReturned: (emailSent: boolean) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reason.trim()) { setError('Informe a justificativa da devolução.'); return }
    setSubmitting(true); setError('')
    try {
      const response = await apiFetch(`/api/credit-requests/${item.id}/return-to-seller`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) { setError(body?.message || 'Não foi possível devolver o cadastro.'); return }
      onReturned(!!body?.emailSent)
    } catch { setError('Não foi possível conectar à API.')
    } finally { setSubmitting(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">RECUSAR CADASTRO</p><h2>{item.companyName}</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div>
    <p className="modal-copy">O cadastro volta para o vendedor em "Minhas solicitações" com o motivo abaixo, para ele corrigir e reenviar.</p>
    <label>Justificativa da devolução<textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} required autoFocus placeholder="O que precisa ser corrigido ou completado no cadastro"></textarea></label>
    {error && <div className="notice notice-error"><X size={17} /> {error}</div>}
    <div className="modal-actions"><button type="button" className="cancel-btn" onClick={onClose}>Cancelar</button><button type="submit" className="deny-btn" style={{ padding: '11px 16px' }} disabled={submitting}><X size={17} /> {submitting ? 'Devolvendo...' : 'Devolver ao vendedor'}</button></div>
  </form></div>
}

function DecisionsView({ pendingDecisions, historyDecisions, onConfirmPratico }: { pendingDecisions: Request[]; historyDecisions: Request[]; onConfirmPratico: (requestId: number) => Promise<void> }) {
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null)
  const [decisionDetail, setDecisionDetail] = useState<DecisionDetail | null>(null)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [subView, setSubView] = useState<'pendentes' | 'historico'>('pendentes')
  const viewDecision = async (item: Request) => {
    setSelectedRequest(item)
    setDecisionDetail(null)
    setViewingId(item.id)
    try {
      const response = await apiFetch(`/api/credit-requests/${item.id}/decision`)
      if (response.ok) setDecisionDetail(await response.json())
    } finally { setViewingId(null) }
  }
  const closeDetail = () => { setSelectedRequest(null); setDecisionDetail(null) }
  const confirmPratico = async (requestId: number) => {
    setConfirmingId(requestId)
    try { await onConfirmPratico(requestId) } finally { setConfirmingId(null) }
  }
  return <><PageHeader eyebrow="ÁREA DA ANALISTA" title="Decisões da gestão" subtitle="Atualize o limite no sistema Prático e confirme abaixo — a solicitação sai da fila pendente, vai para o histórico e o vendedor recebe a confirmação por e-mail." />
    <div className="subtabs">
      <button type="button" className={subView === 'pendentes' ? 'subtab active' : 'subtab'} onClick={() => setSubView('pendentes')}>Pendentes de confirmação{pendingDecisions.length > 0 && <span className="subtab-count">{pendingDecisions.length}</span>}</button>
      <button type="button" className={subView === 'historico' ? 'subtab active' : 'subtab'} onClick={() => setSubView('historico')}>Histórico</button>
    </div>
    {subView === 'pendentes' ? <>
      <div className="section-title"><div><h2>Pendentes de confirmação</h2><p>{pendingDecisions.length} decisão(ões) aguardando atualização no Prático</p></div></div>
      {pendingDecisions.length ? <section className="admin-card"><div className="user-table"><div className="user-head" style={{ gridTemplateColumns: '1.4fr .65fr .55fr .75fr 100px 190px' }}><span>CLIENTE</span><span>PROTOCOLO</span><span>DECISÃO</span><span>LIMITE APROVADO</span><span></span><span></span></div>{pendingDecisions.map((item) => <div className="user-row" key={item.id} style={{ gridTemplateColumns: '1.4fr .65fr .55fr .75fr 100px 190px' }}><div><strong>{item.companyName}</strong><small>Código Prático: {item.clientCode}</small></div><span className="user-role">{item.protocol}</span><span className={item.status === 'APROVADA' ? 'access-active' : 'access-inactive'}><i></i>{statusLabel[item.status]}</span><span className="user-role">{item.status === 'APROVADA' ? money(item.approvedLimit) : '—'}</span><button className="small-action" onClick={() => viewDecision(item)}>{viewingId === item.id ? '...' : 'Ver dossiê'}</button><button className="primary-btn" style={{ padding: '8px 12px', fontSize: 12, boxShadow: 'none' }} disabled={confirmingId === item.id} onClick={() => confirmPratico(item.id)}><Check size={14} /> {confirmingId === item.id ? 'Confirmando...' : 'Confirmar no Prático'}</button></div>)}</div></section> : <div style={{ padding: '40px 30px', textAlign: 'center', background: '#fff', border: '1px solid var(--line)', borderRadius: 8 }}><Check size={30} style={{ color: '#9adcb8', marginBottom: 10 }} /><p className="subheading">Nenhuma decisão pendente. Tudo em dia!</p></div>}
    </> : <>
      <div className="section-title"><div><h2>Histórico</h2><p>{historyDecisions.length} decisão(ões) já confirmada(s) no Prático</p></div></div>
      {historyDecisions.length ? <section className="admin-card"><div className="user-table"><div className="user-head" style={{ gridTemplateColumns: '1.4fr .65fr .55fr .75fr 1fr 100px' }}><span>CLIENTE</span><span>PROTOCOLO</span><span>DECISÃO</span><span>LIMITE APROVADO</span><span>CONFIRMADO</span><span></span></div>{historyDecisions.map((item) => <div className="user-row" key={item.id} style={{ gridTemplateColumns: '1.4fr .65fr .55fr .75fr 1fr 100px' }}><div><strong>{item.companyName}</strong><small>Código Prático: {item.clientCode}</small></div><span className="user-role">{item.protocol}</span><span className={item.status === 'APROVADA' ? 'access-active' : 'access-inactive'}><i></i>{statusLabel[item.status]}</span><span className="user-role">{item.status === 'APROVADA' ? money(item.approvedLimit) : '—'}</span><span className="time">{item.praticoConfirmedByName} · {item.praticoConfirmedAt ? formatDateTime(item.praticoConfirmedAt) : '—'}</span><button className="small-action" onClick={() => viewDecision(item)}>{viewingId === item.id ? '...' : 'Ver dossiê'}</button></div>)}</div></section> : <p className="subheading">Nenhum item no histórico ainda.</p>}
    </>}

    {selectedRequest && <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 560 }}>
      <div className="modal-head"><div><p className="eyebrow">DOSSIÊ {selectedRequest.protocol}</p><h2>{selectedRequest.companyName}</h2></div><button type="button" onClick={closeDetail}><X size={19} /></button></div>
      <div className="form-section-title">Dados para cadastro no Prático</div>
      <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><span>Código do cadastro (Prático)</span><strong>{selectedRequest.clientCode || '—'}</strong></div>
        <div><span>CNPJ</span><strong>{selectedRequest.cnpj || '—'}</strong></div>
        <div><span>Nome fantasia</span><strong>{selectedRequest.tradeName || '—'}</strong></div>
        <div><span>Inscrição estadual</span><strong>{selectedRequest.stateRegistration || '—'}</strong></div>
        <div><span>Endereço completo</span><strong>{selectedRequest.address || '—'}</strong></div>
        <div><span>Vendedor</span><strong>{selectedRequest.sellerName || '—'}</strong></div>
        <div><span>Código do vendedor no Prático</span><strong>{selectedRequest.sellerCode || '—'}</strong></div>
        <div><span>Loja do vendedor</span><strong>{selectedRequest.sellerStore || '—'}</strong></div>
        <div><span>Gerente do vendedor</span><strong>{selectedRequest.sellerManagerName || '—'}</strong></div>
        <div><span>WhatsApp do vendedor</span><strong>{selectedRequest.sellerWhatsapp ? <a href={whatsappLink(selectedRequest.sellerWhatsapp)} target="_blank" rel="noreferrer">{selectedRequest.sellerWhatsapp}</a> : '—'}</strong></div>
        <div><span>Contato</span><strong>{selectedRequest.contactName || '—'}</strong></div>
        <div><span>Telefone</span><strong>{selectedRequest.phone || '—'}</strong></div>
        <div><span>E-mail de contato</span><strong>{selectedRequest.contactEmail || '—'}</strong></div>
        <div><span>E-mail para NFe</span><strong>{selectedRequest.invoiceEmail || '—'}</strong></div>
        <div><span>E-mail financeiro</span><strong>{selectedRequest.financeEmail || '—'}</strong></div>
        <div><span>Tipo de entrega</span><strong>{selectedRequest.deliveryType || '—'}</strong></div>
        <div><span>Local da entrega</span><strong>{selectedRequest.deliveryLocation || '—'}</strong></div>
        {selectedRequest.deliveryAddress && <div><span>Endereço de entrega</span><strong>{selectedRequest.deliveryAddress}</strong></div>}
      </div>
      <div className="form-section-title">Resultado da decisão</div>
      <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><span>Decisão</span><strong className={selectedRequest.status === 'APROVADA' ? 'success-text' : 'danger-text'}>{statusLabel[selectedRequest.status]}</strong></div>
        <div><span>Limite aprovado</span><strong>{selectedRequest.status === 'APROVADA' ? money(selectedRequest.approvedLimit) : '—'}</strong></div>
      </div>
      <div className="form-section-title">Assinatura de confirmação</div>
      {viewingId === selectedRequest.id ? <p className="modal-copy">Carregando...</p> : decisionDetail ? <>
        <p className="modal-copy">{decisionDetail.internalReason || 'Nenhuma justificativa registrada.'}</p>
        <div className="check-line"><ShieldCheck size={16} /><div><strong>{decisionDetail.managerName}</strong><small>{selectedRequest.status === 'APROVADA' ? 'Aprovado' : 'Negado'} em {formatDateTime(decisionDetail.decidedAt)}</small></div></div>
      </> : <p className="modal-copy">Registro de decisão não encontrado.</p>}
      <div className="modal-actions"><button type="button" className="cancel-btn" onClick={closeDetail}>Fechar</button></div>
    </div></div>}
  </>
}
function ManagementView({ requests, deniedItems, onReloadRequests, selected, setSelected, decision, onDecision }: { requests: Request[]; deniedItems: Request[]; onReloadRequests: () => void; selected: Request; setSelected: (item: Request) => void; decision: 'APROVADA' | 'NEGADA' | null; onDecision: (status: Status, approvedLimit?: number, recipientEmail?: string, internalReason?: string, clientMessage?: string) => void }) {
  const [subView, setSubView] = useState<'fila' | 'negadas'>('fila')
  const pushToast = useToast()
  // Guardado como texto (não number) para não reformatar o campo a cada tecla digitada —
  // um <input type="number"> controlado por um valor numérico reconstrói o texto exibido a
  // cada onChange, o que embaralha a digitação em teclados numéricos. Convertemos para
  // número só na hora de validar/enviar (approvedLimitValue, abaixo).
  const [approvedLimit, setApprovedLimit] = useState('0')
  const approvedLimitValue = Number(approvedLimit.replace(',', '.')) || 0
  const [recipientEmail, setRecipientEmail] = useState(selected.sellerEmail)
  const [internalReason, setInternalReason] = useState('')
  const [clientMessage, setClientMessage] = useState('')
  const [requestDocuments, setRequestDocuments] = useState<DossierDocument[]>([])
  const [decisionDetail, setDecisionDetail] = useState<DecisionDetail | null>(null)
  const [reopenSubmitting, setReopenSubmitting] = useState(false)
  const [reopenError, setReopenError] = useState('')
  const [deniedSearch, setDeniedSearch] = useState('')
  const isQueued = requests.some((item) => item.id === selected.id)
  const isDenied = deniedItems.some((item) => item.id === selected.id)
  const deniedSearchQuery = deniedSearch.trim().toLowerCase()
  const deniedSearchDigits = deniedSearchQuery.replace(/\D/g, '')
  const filteredDeniedItems = !deniedSearchQuery ? deniedItems : deniedItems.filter((item) =>
    item.companyName.toLowerCase().includes(deniedSearchQuery) ||
    (item.tradeName ?? '').toLowerCase().includes(deniedSearchQuery) ||
    (item.clientCode ?? '').toLowerCase().includes(deniedSearchQuery) ||
    (deniedSearchDigits.length > 0 && item.cnpj.replace(/\D/g, '').includes(deniedSearchDigits)))
  useEffect(() => {
    setRecipientEmail(selected.sellerEmail); setInternalReason(''); setClientMessage(''); setReopenError('')
    setApprovedLimit(String(isDenied ? (selected.approvedLimit ?? 0) : 0))
    if (isQueued || isDenied) listDocuments(selected.id).then((docs) => { setRequestDocuments(docs); if (!isDenied) setApprovedLimit(String(docs.find((d) => d.documentType === 'DEPS')?.extractedData?.suggestedLimit ?? 0)) })
    else setRequestDocuments([])
  }, [selected.id, isQueued, isDenied, selected.sellerEmail, selected.approvedLimit])
  useEffect(() => {
    if (isDenied) apiFetch(`/api/credit-requests/${selected.id}/decision`).then((response) => (response.ok ? response.json() : null)).then(setDecisionDetail).catch(() => {})
    else setDecisionDetail(null)
  }, [selected.id, isDenied])
  const serasaDoc = requestDocuments.find((d) => d.documentType === 'SERASA')
  const depsDoc = requestDocuments.find((d) => d.documentType === 'DEPS')
  const deps = depsDoc?.extractedData ?? null

  const submitReopen = async () => {
    if (!approvedLimitValue || approvedLimitValue <= 0) { setReopenError('Informe o novo limite aprovado.'); return }
    if (!internalReason.trim()) { setReopenError('Informe a justificativa da reabertura.'); return }
    setReopenSubmitting(true); setReopenError('')
    try {
      const response = await apiFetch(`/api/credit-requests/${selected.id}/reopen`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvedLimit: approvedLimitValue, internalReason, clientMessage: clientMessage || null, recipientEmail: recipientEmail || null }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) { setReopenError(body?.message || 'Não foi possível reabrir a solicitação.'); return }
      await onReloadRequests()
      setSelected(emptyRequest)
      pushToast('success', body?.emailSent ? 'Solicitação reaberta e aprovada. O vendedor foi avisado por e-mail.' : 'Solicitação reaberta e aprovada.')
    } catch { setReopenError('Não foi possível conectar à API.')
    } finally { setReopenSubmitting(false) }
  }

  return <><PageHeader eyebrow="ÁREA DA GESTÃO" title="Decisão de crédito" subtitle="Selecione uma solicitação na fila para revisar o dossiê e registrar o parecer." action={(isQueued || isDenied) ? <button className="back-btn" onClick={() => setSelected(emptyRequest)}><ArrowLeft size={16} /> Voltar para fila</button> : undefined} />
    <div className="subtabs">
      <button type="button" className={subView === 'fila' ? 'subtab active' : 'subtab'} onClick={() => { setSubView('fila'); setSelected(emptyRequest) }}>Fila de decisão{requests.length > 0 && <span className="subtab-count">{requests.length}</span>}</button>
      <button type="button" className={subView === 'negadas' ? 'subtab active' : 'subtab'} onClick={() => { setSubView('negadas'); setSelected(emptyRequest) }}>Negadas{deniedItems.length > 0 && <span className="subtab-count">{deniedItems.length}</span>}</button>
    </div>
    {subView === 'negadas' ? <div className="analyst-layout">
      <div className="queue-card">
        <div className="queue-header">
          <div><h2>Solicitações negadas</h2><p>{deniedItems.length} solicitação(ões) negada(s)</p></div>
          <div className="search"><Search size={16} /><input placeholder="Buscar por nome, código Prático ou CNPJ" value={deniedSearch} onChange={(event) => setDeniedSearch(event.target.value)} /></div>
        </div>
        {filteredDeniedItems.length ? filteredDeniedItems.map((item) => <div className={isDenied && selected.id === item.id ? 'queue-item selected' : 'queue-item'} key={item.id} style={{ cursor: 'default', display: 'flex', flexDirection: 'column', gap: 10, width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, width: '100%' }}>
            <div className="case-avatar blue">{item.companyName.slice(0, 2)}</div>
            <div style={{ minWidth: 0, flex: '1 1 0%', overflow: 'hidden' }}>
              <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.companyName}>{item.companyName}</strong>
              <small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Código Prático: ${item.clientCode || '—'} · ${item.cnpj}`}>Código Prático: {item.clientCode || '—'} · {item.cnpj}</small>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
            <button type="button" className="small-action" style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setSelected(item)}><Eye size={14} /> Ver dossiê</button>
            <button type="button" className="primary-btn" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', padding: '7px 10px', fontSize: 12, boxShadow: 'none', whiteSpace: 'nowrap' }} onClick={() => setSelected(item)}><RotateCcw size={14} /> Reabrir</button>
          </div>
        </div>) : <p className="subheading" style={{ padding: '17px' }}>{deniedItems.length ? 'Nenhum resultado para essa busca.' : 'Nenhuma solicitação negada no momento.'}</p>}
      </div>
      <div className="dossier-panel">{!isDenied ? <div style={{ padding: '60px 30px', textAlign: 'center' }}><ShieldCheck size={34} style={{ color: '#b8cdfb', marginBottom: 14 }} /><p className="subheading">Selecione uma solicitação negada ao lado para ver o dossiê e reabrir a decisão.</p></div> : <>
        <div className="dossier-head"><div><p className="eyebrow">SOLICITAÇÃO {selected.protocol}</p><h2>{selected.companyName}</h2><div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><span className="user-role">Código Prático: {selected.clientCode}</span><span className="user-role">CNPJ: {selected.cnpj}</span></div></div></div>
        {decisionDetail && <div className="notice notice-error" style={{ marginBottom: 4 }}><X size={17} /> Negada por {decisionDetail.managerName} em {formatDateTime(decisionDetail.decidedAt)}{decisionDetail.internalReason ? ` — motivo registrado: "${decisionDetail.internalReason}"` : ''}</div>}

        <div style={{ marginTop: 4 }}><SellerInfoCard request={selected} /></div>
        <RequestOverviewCards request={selected} />

        <section className="review-card" style={{ marginTop: 16 }}>
          <div className="form-section-head" style={{ marginBottom: 4, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><div className="form-section-icon"><ClipboardCheck size={16} /></div><div><h2>Resumo da análise</h2><p>Dados extraídos pela analista a partir do Serasa e DEPS</p></div></div>
            <span className="tag">Dossiê completo</span>
          </div>
          {depsDoc && !deps && <div className="notice notice-error"><X size={17} /> Não foi possível extrair os dados automaticamente do PDF de Avaliação DEPS. Confira o arquivo original.</div>}
          <div className="score-row"><div className="score-main"><span>Classificação DEPS</span><strong>{deps?.classification ?? '—'}</strong><small>Limite sugerido: {deps ? money(deps.suggestedLimit) : '—'}</small></div><div className="score-item"><span>Pontuação positiva</span><strong className="success-text">{deps ? `${deps.positivePercent.toLocaleString('pt-BR')}%` : '—'}</strong></div><div className="score-item"><span>Pontuação negativa</span><strong className="danger-text">{deps ? `${deps.negativePercent.toLocaleString('pt-BR')}%` : '—'}</strong></div><div className="score-item"><span>Risco</span><strong className="danger-text">{deps?.risk ?? '—'}</strong></div></div>
          <div className="risk-table"><div><span>Protestos</span><strong>{deps?.protests ? `${deps.protests.count} ocorrências · ${money(deps.protests.value)}` : '—'}</strong><b className="danger-text">Atenção</b></div><div><span>PEFIN</span><strong>{deps?.pefin ? `${deps.pefin.count} ocorrências · ${money(deps.pefin.value)}` : '—'}</strong><b className="warning-text">Verificar</b></div><div><span>Histórico de pagamento</span><strong>{deps?.paymentHistoryPercent != null ? `${deps.paymentHistoryPercent.toLocaleString('pt-BR')}% pontual` : '—'}</strong><b className="success-text">Regular</b></div><div><span>Consultas recentes</span><strong>{deps?.consultationsCount != null ? `${deps.consultationsCount} registrada(s)` : '—'}</strong><b>Normal</b></div></div>
          <div className="original-files">{serasaDoc ? <span><FileText size={15} /> {serasaDoc.originalName} <a href="#" onClick={(event) => { event.preventDefault(); viewDocument(serasaDoc.id) }}>Visualizar</a></span> : <span><FileText size={15} /> Consulta Serasa <em style={{ color: '#b3bcc7', fontStyle: 'normal' }}>não anexada</em></span>}{depsDoc ? <span><FileText size={15} /> {depsDoc.originalName} <a href="#" onClick={(event) => { event.preventDefault(); viewDocument(depsDoc.id) }}>Visualizar</a></span> : <span><FileText size={15} /> Avaliação DEPS <em style={{ color: '#b3bcc7', fontStyle: 'normal' }}>não anexada</em></span>}</div>
        </section>

        <section className="decision-card" style={{ marginTop: 16 }}><p className="eyebrow">REABERTURA DA DECISÃO</p><h2>Novo limite e justificativa</h2><label>Novo limite aprovado<input type="number" min="0.01" step="0.01" value={approvedLimit} onChange={(event) => setApprovedLimit(event.target.value)} /></label><label>Justificativa da reabertura<textarea rows={3} value={internalReason} onChange={(event) => setInternalReason(event.target.value)} placeholder="Motivo da gestão para reverter a negativa"></textarea></label><label>Mensagem para o vendedor<textarea rows={3} value={clientMessage} onChange={(event) => setClientMessage(event.target.value)} placeholder="Explicação que o vendedor verá em Minhas solicitações"></textarea></label><label>E-mail para envio do resultado<input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="email@empresa.com.br" /></label>{reopenError && <div className="notice notice-error"><X size={17} /> {reopenError}</div>}<div className="decision-buttons" style={{ gridTemplateColumns: '1fr' }}><button className="approve-btn" disabled={reopenSubmitting} onClick={submitReopen}><RotateCcw size={17} /> {reopenSubmitting ? 'Reabrindo...' : 'Reabrir e aprovar'}</button></div><small className="decision-note"><Bell size={13} /> A justificativa fica registrada no histórico da solicitação e um e-mail com o resultado será enviado ao endereço confirmado acima.</small></section>
      </>}</div>
    </div> : <div className="analyst-layout">
      <div className="queue-card">
        <div className="queue-header"><div><h2>Fila de decisão</h2><p>{requests.length} solicitação(ões) aguardando parecer</p></div></div>
        {requests.length ? requests.map((item) => <button className={isQueued && selected.id === item.id ? 'queue-item selected' : 'queue-item'} key={item.id} onClick={() => setSelected(item)}><div className="case-avatar blue">{item.companyName.slice(0, 2)}</div><div><strong>{item.companyName}</strong><small>Código Prático: {item.clientCode} · {item.cnpj}</small></div></button>) : <p className="subheading" style={{ padding: '17px' }}>Nenhuma solicitação aguardando decisão.</p>}
      </div>
      <div className="dossier-panel">{!isQueued ? <div style={{ padding: '60px 30px', textAlign: 'center' }}><ShieldCheck size={34} style={{ color: '#b8cdfb', marginBottom: 14 }} /><p className="subheading">Selecione uma solicitação na fila ao lado para revisar e decidir.</p></div> : <>
        <div className="dossier-head"><div><p className="eyebrow">SOLICITAÇÃO {selected.protocol}</p><h2>{selected.companyName}</h2><div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><span className="user-role">Código Prático: {selected.clientCode}</span><span className="user-role">CNPJ: {selected.cnpj}</span></div></div></div>

        <div style={{ marginTop: 4 }}><SellerInfoCard request={selected} /></div>
        <RequestOverviewCards request={selected} />

        <section className="review-card" style={{ marginTop: 16 }}>
          <div className="form-section-head" style={{ marginBottom: 4, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><div className="form-section-icon"><ClipboardCheck size={16} /></div><div><h2>Resumo da análise</h2><p>Dados extraídos pela analista a partir do Serasa e DEPS</p></div></div>
            <span className="tag">Dossiê completo</span>
          </div>
          {depsDoc && !deps && <div className="notice notice-error"><X size={17} /> Não foi possível extrair os dados automaticamente do PDF de Avaliação DEPS. Confira o arquivo original.</div>}
          <div className="score-row"><div className="score-main"><span>Classificação DEPS</span><strong>{deps?.classification ?? '—'}</strong><small>Limite sugerido: {deps ? money(deps.suggestedLimit) : '—'}</small></div><div className="score-item"><span>Pontuação positiva</span><strong className="success-text">{deps ? `${deps.positivePercent.toLocaleString('pt-BR')}%` : '—'}</strong></div><div className="score-item"><span>Pontuação negativa</span><strong className="danger-text">{deps ? `${deps.negativePercent.toLocaleString('pt-BR')}%` : '—'}</strong></div><div className="score-item"><span>Risco</span><strong className="danger-text">{deps?.risk ?? '—'}</strong></div></div>
          <div className="risk-table"><div><span>Protestos</span><strong>{deps?.protests ? `${deps.protests.count} ocorrências · ${money(deps.protests.value)}` : '—'}</strong><b className="danger-text">Atenção</b></div><div><span>PEFIN</span><strong>{deps?.pefin ? `${deps.pefin.count} ocorrências · ${money(deps.pefin.value)}` : '—'}</strong><b className="warning-text">Verificar</b></div><div><span>Histórico de pagamento</span><strong>{deps?.paymentHistoryPercent != null ? `${deps.paymentHistoryPercent.toLocaleString('pt-BR')}% pontual` : '—'}</strong><b className="success-text">Regular</b></div><div><span>Consultas recentes</span><strong>{deps?.consultationsCount != null ? `${deps.consultationsCount} registrada(s)` : '—'}</strong><b>Normal</b></div></div>
          <div className="original-files">{serasaDoc ? <span><FileText size={15} /> {serasaDoc.originalName} <a href="#" onClick={(event) => { event.preventDefault(); viewDocument(serasaDoc.id) }}>Visualizar</a></span> : <span><FileText size={15} /> Consulta Serasa <em style={{ color: '#b3bcc7', fontStyle: 'normal' }}>não anexada</em></span>}{depsDoc ? <span><FileText size={15} /> {depsDoc.originalName} <a href="#" onClick={(event) => { event.preventDefault(); viewDocument(depsDoc.id) }}>Visualizar</a></span> : <span><FileText size={15} /> Avaliação DEPS <em style={{ color: '#b3bcc7', fontStyle: 'normal' }}>não anexada</em></span>}</div>
        </section>

        <section className="decision-card" style={{ marginTop: 16 }}><p className="eyebrow">PARECER FINAL</p><h2>Qual limite deve ser liberado?</h2><label>Limite aprovado<input type="number" min="0" step="0.01" value={approvedLimit} onChange={(event) => setApprovedLimit(event.target.value)} /></label><label>Justificativa interna<textarea rows={3} value={internalReason} onChange={(event) => setInternalReason(event.target.value)} placeholder="Observações visíveis apenas para a gestão e analista"></textarea></label><label>Mensagem para o vendedor<textarea rows={3} value={clientMessage} onChange={(event) => setClientMessage(event.target.value)} placeholder="Explicação que o vendedor verá em Minhas solicitações"></textarea></label><label>E-mail para envio do resultado<input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="email@empresa.com.br" /></label><div className="decision-buttons"><button className={decision === 'NEGADA' ? 'deny-btn chosen' : 'deny-btn'} onClick={() => onDecision('NEGADA', undefined, recipientEmail, internalReason, clientMessage)}><X size={17} /> Negar crédito</button><button className={decision === 'APROVADA' ? 'approve-btn chosen' : 'approve-btn'} onClick={() => onDecision('APROVADA', approvedLimitValue, recipientEmail, internalReason, clientMessage)}><Check size={17} /> Aprovar crédito</button></div><small className="decision-note"><Bell size={13} /> Ao decidir, um e-mail com o resultado será enviado para o endereço confirmado acima.</small></section>
      </>}</div>
    </div>}
  </>
}

export default function AppRoot() { return <ToastProvider><App /></ToastProvider> }

