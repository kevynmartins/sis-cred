import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import mariadb from 'mariadb'
import multer from 'multer'
import nodemailer from 'nodemailer'
import { PDFParse } from 'pdf-parse'

const documentTypes = ['CNPJ', 'CONTRATO_SOCIAL', 'INSCRICAO_ESTADUAL', 'SERASA', 'DEPS', 'OUTRO'] as const
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype === 'application/pdf'),
})
const avatarMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, avatarMimeTypes.includes(file.mimetype)),
})

// O nome do arquivo (Content-Type) enviado pelo navegador não garante o conteúdo real —
// por isso conferimos os bytes mágicos antes de aceitar o upload.
const isPdfBuffer = (buffer: Buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-'
const isValidImageBuffer = (buffer: Buffer, mimetype: string) => {
  if (mimetype === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimetype === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}
const sanitizeFilename = (name: string) => Array.from(name).filter((ch) => ch.charCodeAt(0) >= 32 && ch !== String.fromCharCode(34) && ch.charCodeAt(0) !== 127).join('').slice(0, 200) || 'documento'

// Extrai os campos do relatório de Avaliação DEPS diretamente do texto do PDF enviado,
// em vez de exibir sempre os mesmos valores de um relatório de exemplo.
type DepsExtractedData = {
  classification: string
  suggestedLimit: number
  positivePercent: number
  negativePercent: number
  risk: string | null
  protests: { count: number; value: number } | null
  pefin: { count: number; value: number } | null
  paymentHistoryPercent: number | null
  consultationsCount: number | null
}
const parseBrNumber = (raw: string) => Number(raw.replace(/\./g, '').replace(',', '.'))

// Cada fator (Protesto, Pefin, Histórico de Pagamentos etc.) pode aparecer tanto na
// seção "Pontos positivos" quanto em "Pontos negativos", dependendo se o resultado
// daquele cliente foi favorável ou não — por isso não dá pra assumir uma seção fixa.
// O texto extraído do PDF traz primeiro o bloco de valores (uma linha por fator, na
// ordem da tabela) e só depois o bloco com os nomes dos fatores, na mesma ordem —
// então associamos os dois blocos pela posição em vez de tentar casar por nome.
type SectionRow = { label: string; complement: string }
const parseSectionRows = (text: string, totalMarker: string, sectionEndMarker: string): SectionRow[] => {
  const sectionStart = text.indexOf(totalMarker)
  const headerStart = sectionStart >= 0 ? text.indexOf('Descrição', sectionStart) : -1
  const sectionEnd = sectionStart >= 0 ? text.indexOf(sectionEndMarker, sectionStart) : -1
  if (sectionStart < 0 || headerStart < 0 || sectionEnd < 0 || headerStart > sectionEnd) return []
  const totalLineEnd = text.indexOf('\n', sectionStart)
  const values = text.slice(totalLineEnd + 1, headerStart).split('\n').map((line) => line.trim()).filter(Boolean)
  const headerLineEnd = text.indexOf('\n', headerStart)
  const labels = text.slice(headerLineEnd + 1, sectionEnd).split('\n').map((line) => line.trim()).filter(Boolean)
  return labels.map((label, index) => ({ label, complement: values[index] ?? '' }))
}
const extractDepsData = (text: string): DepsExtractedData | null => {
  const summaryMatch = text.match(
    /Política:\s*\n?Atingido:\s*\n?Positivo:\s*\n?Negativo:\s*\n?Classificação:\s*\n?Limite sugerido:\s*\n?[^\n]+\n(-?[\d.,]+)%\n(-?[\d.,]+)%\n(-?[\d.,]+)%\n([^\n]+)\n([\d.,]+)\nFaturamento presumido/,
  )
  if (!summaryMatch) return null
  const [, , positivePercent, negativePercent, classification, suggestedLimit] = summaryMatch

  let risk: string | null = null
  const riskSectionMatch = text.match(/Limite adotado padrão[\s\S]*?Risco\n([^\n]+)/)
  if (riskSectionMatch) {
    const cells = riskSectionMatch[1].split(/\t| {2,}/).map((cell) => cell.trim()).filter(Boolean)
    risk = cells.length ? cells[cells.length - 1] : null
  }

  const rows = [
    ...parseSectionRows(text, 'Pontos positivos - Total:', 'Pontos negativos - Total:'),
    ...parseSectionRows(text, 'Pontos negativos - Total:', 'Limite adotado padrão'),
  ]
  const findRow = (label: string) => rows.find((row) => row.label === label)
  const parseDebt = (row: SectionRow | undefined) => {
    const match = row?.complement.match(/Vlr\. total: ([\d.,]+), Qtde: (\d+)/)
    return match ? { value: parseBrNumber(match[1]), count: Number(match[2]) } : null
  }
  const protests = parseDebt(findRow('Protesto'))
  const pefin = parseDebt(findRow('Pefin'))
  const historyMatch = findRow('Histórico de Pagamentos')?.complement.match(/Pontual \(%\): ([\d.,]+)/)
  const paymentHistoryPercent = historyMatch ? parseBrNumber(historyMatch[1]) : null

  let consultationsCount: number | null = null
  const consultasSectionMatch = text.match(/\nConsultas\n([\s\S]*)$/)
  if (consultasSectionMatch) {
    const consultaLines = [...consultasSectionMatch[1].matchAll(/^\S.*\t\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/gm)]
    consultationsCount = consultaLines.length || null
  }

  return {
    classification: classification.trim(),
    suggestedLimit: parseBrNumber(suggestedLimit),
    positivePercent: parseBrNumber(positivePercent),
    negativePercent: parseBrNumber(negativePercent),
    risk,
    protests,
    pefin,
    paymentHistoryPercent,
    consultationsCount,
  }
}
const extractDepsFromPdf = async (buffer: Buffer): Promise<DepsExtractedData | null> => {
  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return extractDepsData(result.text)
  } catch (error) {
    console.error('Falha ao extrair dados do PDF de Avaliação DEPS.', error)
    return null
  }
}

const app = express()
const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) throw new Error('JWT_SECRET não configurado.')
const pool = mariadb.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  acquireTimeout: 10000,
  bigIntAsNumber: true,
  decimalAsNumber: true,
})

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null

// Logo embutida como anexo inline (cid) em vez de referenciada por URL — assim ela aparece
// corretamente no e-mail mesmo quando o cliente de e-mail bloqueia imagens externas, e
// independe do domínio público estar acessível no momento do envio.
const emailLogo = (() => {
  try {
    return readFileSync(path.join(process.cwd(), 'public', 'logo_sc.jpg'))
  } catch {
    return null
  }
})()
const emailAttachments = emailLogo ? [{ filename: 'logo_sc.jpg', content: emailLogo, cid: 'siscred-logo' }] : []

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Quebras de linha do texto original viram parágrafos no HTML, preservando o mesmo conteúdo
// das versões em texto puro (mantidas como fallback em `text`) sem duplicar cada mensagem.
const paragraphs = (text: string) =>
  text.split('\n\n').map((block) => `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`).join('')

// Caixa de destaque em laranja — usada nas mensagens de decisão para deixar claro que o
// resultado ainda não está valendo no Prático, evitando que o vendedor informe o cliente cedo demais.
const warningCallout = (text: string) =>
  `<div style="margin:0 0 16px;padding:14px 16px;background:#fff6e5;border-left:4px solid #d98324;border-radius:6px;"><p style="margin:0;font-size:13px;color:#8a5300;font-weight:700;line-height:1.55;">⚠ ${escapeHtml(text)}</p></div>`

const successCallout = (text: string) =>
  `<div style="margin:0 0 16px;padding:14px 16px;background:#e9f8f2;border-left:4px solid #16966b;border-radius:6px;"><p style="margin:0;font-size:13px;color:#0f6b4c;font-weight:700;line-height:1.55;">✓ ${escapeHtml(text)}</p></div>`

const emailLayout = ({ eyebrow, title, bodyHtml }: { eyebrow: string; title: string; bodyHtml: string }) => `<!DOCTYPE html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(23,23,23,.08);">
          <tr><td style="background:#171717;padding:22px 32px;">
            ${emailLogo ? '<img src="cid:siscred-logo" alt="Sis-Cred" height="34" style="display:block;height:34px;width:auto;border:0;" />' : '<strong style="color:#fff;font-size:18px;font-family:Arial,Helvetica,sans-serif;">Sis-Cred</strong>'}
          </td></tr>
          <tr><td style="padding:30px 32px 8px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;color:#d98324;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
            <h1 style="margin:0 0 18px;font-size:20px;color:#171717;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(title)}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px 30px;">
            <hr style="border:none;border-top:1px solid #e7ecf2;margin:0 0 18px;" />
            <p style="margin:0;font-size:12px;color:#9aa6b4;">Este é um e-mail automático — não é necessário responder.</p>
            <p style="margin:8px 0 0;font-size:13px;color:#415168;font-weight:700;">Sis-Cred Cadastro e Crédito</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

// Em produção a API roda atrás de um proxy reverso (Nginx/IIS); isso garante que o
// limitador de tentativas identifique o IP real do cliente, e não o do proxy.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY)
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

// Limita por conta (e-mail, token de redefinição ou usuário autenticado) em vez de por IP:
// várias pessoas costumam acessar de trás do mesmo IP (rede da empresa), então um limite por
// IP faz uma senha errada de uma pessoa travar o login de todo mundo. Cai para o IP só quando
// nenhuma dessas informações está disponível na requisição.
const accountRateLimitKey = (request: Request) => {
  const body = request.body as Record<string, unknown> | undefined
  if (typeof body?.email === 'string' && body.email.trim()) return `email:${body.email.toLowerCase().trim()}`
  if (typeof body?.token === 'string' && body.token.trim()) return `token:${body.token}`
  const authUser = (request as AuthRequest).user
  if (authUser?.id) return `user:${authUser.id}`
  return ipKeyGenerator(request.ip || '')
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: accountRateLimitKey, message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } })
const strictAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, keyGenerator: accountRateLimitKey, message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } })
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { message: 'Muitas requisições. Aguarde um momento e tente novamente.' } })
app.use('/api', apiLimiter)

type UserRole = 'VENDEDOR' | 'ANALISTA' | 'GESTORA' | 'ADMIN'
type AuthUser = { id: number; name: string; email: string; role: UserRole }
type AuthRequest = Request & { user?: AuthUser }
type SseTicket = AuthUser & { purpose: 'sse' }

const authenticate = (request: Request, response: Response, next: NextFunction) => {
  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) { response.status(401).json({ message: 'Autenticação necessária.' }); return }
  try {
    const user = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as AuthUser & { purpose?: string }
    if (user.purpose) { response.status(401).json({ message: 'Sessão inválida ou expirada.' }); return }
    ;(request as AuthRequest).user = user
    next()
  } catch { response.status(401).json({ message: 'Sessão inválida ou expirada.' }) }
}

const authenticateSseTicket = (request: Request, response: Response, next: NextFunction) => {
  const token = typeof request.query.ticket === 'string' ? request.query.ticket : null
  if (!token) { response.status(401).json({ message: 'Autenticação necessária.' }); return }
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as SseTicket
    if (payload.purpose !== 'sse') { response.status(401).json({ message: 'Sessão inválida ou expirada.' }); return }
    ;(request as AuthRequest).user = payload
    next()
  } catch { response.status(401).json({ message: 'Sessão inválida ou expirada.' }) }
}

const sseClients = new Set<Response>()
const broadcast = (event: string, data: Record<string, unknown> = {}) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) client.write(payload)
}

const authorize = (...roles: UserRole[]) => (request: Request, response: Response, next: NextFunction) => {
  const user = (request as AuthRequest).user
  if (!user || !roles.includes(user.role)) { response.status(403).json({ message: 'Você não tem permissão para esta operação.' }); return }
  next()
}

const ensureRequestAccess = async (connection: Awaited<ReturnType<typeof pool.getConnection>>, requestId: number, authUser?: AuthUser): Promise<boolean> => {
  if (authUser?.role !== 'VENDEDOR') return true
  const rows = await connection.query('SELECT seller_id AS sellerId FROM credit_requests WHERE id = ?', [requestId])
  return rows[0]?.sellerId === authUser.id
}

const logAuditEvent = (
  connection: Awaited<ReturnType<typeof pool.getConnection>>,
  requestId: number,
  actorId: number | undefined,
  eventType: string,
  eventData: Record<string, unknown> | null = null,
) => connection.query(
  'INSERT INTO audit_events (request_id, actor_id, event_type, event_data) VALUES (?, ?, ?, ?)',
  [requestId, actorId ?? null, eventType, eventData ? JSON.stringify(eventData) : null],
)

app.get('/api/health', async (_request, response) => {
  let connection
  try {
    connection = await pool.getConnection()
    await connection.query('SELECT 1 AS connected')
    response.json({ status: 'ok', database: 'mariadb' })
  } catch (error) {
    console.error(error)
    response.status(503).json({ status: 'error', database: 'unavailable' })
  } finally {
    connection?.release()
  }
})

const validatePassword = (password: unknown): string | null => {
  if (typeof password !== 'string' || password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'A senha deve ter letras e números.'
  return null
}

app.post('/api/auth/register', authLimiter, async (request, response) => {
  const { name, email, password, praticoSellerCode, storeName, managerName, whatsappPhone } = request.body
  if (!name || typeof name !== 'string' || !email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: 'Informe nome e e-mail válidos.' })
    return
  }
  if (!praticoSellerCode || !storeName || !managerName || !whatsappPhone) {
    response.status(400).json({ message: 'Informe código no Prático, loja, gerente e WhatsApp.' })
    return
  }
  const passwordError = validatePassword(password)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const passwordHash = await bcrypt.hash(password, 12)
    const normalizedEmail = email.toLowerCase().trim()
    const result = await connection.query(
      'INSERT INTO users (name, email, role, pratico_seller_code, store_name, manager_name, whatsapp_phone, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), normalizedEmail, 'VENDEDOR', praticoSellerCode, storeName, managerName, whatsappPhone, passwordHash],
    )
    const authUser: AuthUser = { id: Number(result.insertId), name: name.trim(), email: normalizedEmail, role: 'VENDEDOR' }
    const token = jwt.sign(authUser, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as jwt.SignOptions)
    response.status(201).json({ token, user: { ...authUser, avatarUrl: null } })
  } catch (error) {
    console.error(error)
    response.status(409).json({ message: 'Não foi possível criar a conta. Verifique se o e-mail já está cadastrado.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/auth/login', strictAuthLimiter, async (request, response) => {
  const { email, password } = request.body
  if (!email || !password) { response.status(400).json({ message: 'E-mail e senha são obrigatórios.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query('SELECT id, name, email, role, password_hash AS passwordHash, active, (avatar_data IS NOT NULL) AS hasAvatar FROM users WHERE email = ? LIMIT 1', [email.toLowerCase().trim()])
    const user = rows[0]
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) { response.status(401).json({ message: 'E-mail ou senha inválidos.' }); return }
    const authUser: AuthUser = { id: Number(user.id), name: user.name, email: user.email, role: user.role }
    const token = jwt.sign(authUser, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as jwt.SignOptions)
    const avatarUrl = user.hasAvatar ? `/api/users/${user.id}/avatar` : null
    response.json({ token, user: { ...authUser, avatarUrl } })
  } catch (error) { console.error(error); response.status(500).json({ message: 'Não foi possível iniciar a sessão.' })
  } finally { connection?.release() }
})

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

app.post('/api/auth/forgot-password', authLimiter, async (request, response) => {
  const { email } = request.body
  if (!email || typeof email !== 'string') { response.status(400).json({ message: 'Informe o e-mail cadastrado.' }); return }
  const normalizedEmail = email.toLowerCase().trim()
  const confirmation = { message: 'Se o e-mail estiver cadastrado, enviaremos instruções para redefinir a senha.' }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query('SELECT id, name, active FROM users WHERE email = ? LIMIT 1', [normalizedEmail])
    const user = rows[0]
    if (user && user.active) {
      const recent = await connection.query(
        'SELECT id FROM password_resets WHERE user_id = ? AND created_at > (NOW() - INTERVAL 1 MINUTE) LIMIT 1',
        [user.id],
      )
      if (!recent[0]) {
        const rawToken = randomBytes(32).toString('hex')
        await connection.query(
          'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
          [user.id, hashToken(rawToken)],
        )
        const resetLink = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/?resetToken=${rawToken}`
        if (mailer) {
          try {
            await mailer.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: normalizedEmail,
              subject: 'Redefinição de senha - Sis-Cred',
              text: `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha no Sis-Cred.\nSe foi você, defina uma nova senha em até 30 minutos pelo link abaixo:\n${resetLink}\n\nSe não foi você, ignore este e-mail — sua senha continua a mesma.`,
              html: emailLayout({
                eyebrow: 'Segurança da conta',
                title: 'Redefinição de senha',
                bodyHtml: `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">Olá, ${escapeHtml(user.name)}.</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#3a4756;line-height:1.6;">Recebemos um pedido para redefinir sua senha no Sis-Cred. Se foi você, defina uma nova senha em até 30 minutos clicando no botão abaixo:</p>
                  <p style="margin:0 0 22px;"><a href="${resetLink}" style="display:inline-block;background:#fbba00;color:#171717;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">Redefinir senha</a></p>
                  <p style="margin:0;font-size:13px;color:#8190a1;line-height:1.55;">Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`,
              }),
              attachments: emailAttachments,
            })
          } catch (error) { console.error(error) }
        } else {
          console.warn('SMTP não configurado. Link de redefinição gerado:', resetLink)
        }
      }
    }
    response.json(confirmation)
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível processar a solicitação.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/auth/reset-password', strictAuthLimiter, async (request, response) => {
  const { token, newPassword } = request.body
  if (!token || typeof token !== 'string') { response.status(400).json({ message: 'Link inválido ou expirado.' }); return }
  const passwordError = validatePassword(newPassword)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query(
      'SELECT id, user_id AS userId FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [hashToken(token)],
    )
    const reset = rows[0]
    if (!reset) { response.status(400).json({ message: 'Link inválido ou expirado. Solicite a redefinição novamente.' }); return }
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await connection.beginTransaction()
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, reset.userId])
    await connection.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [reset.id])
    await connection.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [reset.userId])
    await connection.commit()
    response.json({ message: 'Senha redefinida com sucesso. Você já pode entrar com a nova senha.' })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível redefinir a senha.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/auth/me', authenticate, (request, response) => response.json((request as AuthRequest).user))

// Ticket de curta duração (60s) só para abrir a conexão de eventos — o EventSource do navegador
// não permite enviar o cabeçalho Authorization, então evitamos colocar o token de sessão na URL.
app.get('/api/auth/sse-ticket', authenticate, (request, response) => {
  const { id, name, email, role } = (request as AuthRequest).user!
  const ticket = jwt.sign({ id, name, email, role, purpose: 'sse' }, jwtSecret, { expiresIn: '60s', algorithm: 'HS256' })
  response.json({ ticket })
})

app.get('/api/events', authenticateSseTicket, (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.write('retry: 3000\n\n')
  sseClients.add(response)
  const heartbeat = setInterval(() => response.write(': ping\n\n'), 25000)
  request.on('close', () => { clearInterval(heartbeat); sseClients.delete(response) })
})

app.use('/api', authenticate)

app.post('/api/auth/change-password', strictAuthLimiter, async (request, response) => {
  const authUser = (request as AuthRequest).user
  const { currentPassword, newPassword } = request.body
  if (!currentPassword || !newPassword) { response.status(400).json({ message: 'Informe a senha atual e a nova senha.' }); return }
  const passwordError = validatePassword(newPassword)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  if (newPassword === currentPassword) { response.status(400).json({ message: 'A nova senha deve ser diferente da senha atual.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query('SELECT password_hash AS passwordHash FROM users WHERE id = ? LIMIT 1', [authUser?.id])
    const user = rows[0]
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      response.status(401).json({ message: 'Senha atual incorreta.' })
      return
    }
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, authUser?.id])
    response.json({ message: 'Senha atualizada com sucesso.' })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível atualizar a senha.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/auth/profile', async (request, response) => {
  const authUser = (request as AuthRequest).user
  const { name } = request.body
  if (!name || typeof name !== 'string' || !name.trim()) { response.status(400).json({ message: 'Informe um nome válido.' }); return }
  const trimmedName = name.trim()
  if (trimmedName.length > 150) { response.status(400).json({ message: 'O nome deve ter no máximo 150 caracteres.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    await connection.query('UPDATE users SET name = ? WHERE id = ?', [trimmedName, authUser?.id])
    response.json({ name: trimmedName })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível atualizar o nome.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/auth/avatar', avatarUpload.single('file'), async (request, response) => {
  const authUser = (request as AuthRequest).user
  const file = request.file
  if (!file) { response.status(400).json({ message: 'Selecione uma imagem JPG, PNG ou WEBP de até 3MB.' }); return }
  if (!isValidImageBuffer(file.buffer, file.mimetype)) { response.status(400).json({ message: 'O arquivo enviado não é uma imagem válida.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    await connection.query('UPDATE users SET avatar_mime = ?, avatar_data = ? WHERE id = ?', [file.mimetype, file.buffer, authUser?.id])
    response.json({ avatarUrl: `/api/users/${authUser?.id}/avatar?v=${Date.now()}` })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível salvar a foto.' })
  } finally {
    connection?.release()
  }
})

app.delete('/api/auth/avatar', async (request, response) => {
  const authUser = (request as AuthRequest).user
  let connection
  try {
    connection = await pool.getConnection()
    await connection.query('UPDATE users SET avatar_mime = NULL, avatar_data = NULL WHERE id = ?', [authUser?.id])
    response.json({ message: 'Foto removida.' })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível remover a foto.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/users/:id/avatar', async (request, response) => {
  const userId = Number(request.params.id)
  if (!userId) { response.status(400).end(); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query('SELECT avatar_mime AS avatarMime, avatar_data AS avatarData FROM users WHERE id = ?', [userId])
    const target = rows[0]
    if (!target || !target.avatarData) { response.status(404).end(); return }
    response.setHeader('Content-Type', target.avatarMime || 'image/jpeg')
    response.setHeader('Cache-Control', 'private, max-age=300')
    response.send(target.avatarData)
  } catch (error) {
    console.error(error)
    response.status(500).end()
  } finally {
    connection?.release()
  }
})

app.get('/api/credit-requests', async (request, response) => {
  let connection
  try {
    connection = await pool.getConnection()
    const authUser = (request as AuthRequest).user
    const status = typeof request.query.status === 'string' ? request.query.status : null
    const sellerFilter = authUser?.role === 'VENDEDOR' ? authUser.id : null
    const rows = await connection.query(
      `SELECT r.id, r.protocol, r.client_code AS clientCode, r.company_name AS companyName, r.trade_name AS tradeName,
        r.cnpj, r.state_registration AS stateRegistration, r.phone, r.address,
        r.invoice_email AS invoiceEmail, r.finance_email AS financeEmail, r.contact_name AS contactName, r.contact_email AS contactEmail,
        r.request_purpose AS requestPurpose, r.purchase_authorization AS purchaseAuthorization,
        r.delivery_type AS deliveryType, r.delivery_location AS deliveryLocation, r.delivery_address AS deliveryAddress,
        r.requested_limit AS requestedLimit, r.approved_limit AS approvedLimit, r.origin, r.seller_notes AS sellerNotes, r.return_reason AS returnReason,
        r.status, r.submitted_at AS submittedAt,
        r.pratico_confirmed_at AS praticoConfirmedAt, pc.name AS praticoConfirmedByName,
        u.name AS sellerName, u.email AS sellerEmail, u.pratico_seller_code AS sellerCode,
        u.store_name AS sellerStore, u.manager_name AS sellerManagerName, u.whatsapp_phone AS sellerWhatsapp
       FROM credit_requests r
       INNER JOIN users u ON u.id = r.seller_id
       LEFT JOIN users pc ON pc.id = r.pratico_confirmed_by
       WHERE (? IS NULL OR r.status = ?) AND (? IS NULL OR r.seller_id = ?)
       ORDER BY r.updated_at DESC`,
      [status, status, sellerFilter, sellerFilter],
    )
    response.json(rows)
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível consultar as solicitações.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/admin/overview', authorize('ADMIN'), async (_request, response) => {
  let connection
  try {
    connection = await pool.getConnection()
    const [users, requests, documents, audit] = await Promise.all([
      connection.query('SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM users'),
      connection.query('SELECT status, COUNT(*) AS total FROM credit_requests GROUP BY status'),
      connection.query('SELECT COUNT(*) AS total FROM dossier_documents'),
      connection.query('SELECT COUNT(*) AS total FROM audit_events'),
    ])
    response.json({ users: users[0], requests, documents: documents[0], audit: audit[0] })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível carregar a conferência administrativa.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/audit-events', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  let connection
  try {
    connection = await pool.getConnection()
    const { eventType, from, to, protocol } = request.query
    const conditions: string[] = []
    const params: unknown[] = []
    if (typeof eventType === 'string' && eventType) { conditions.push('e.event_type = ?'); params.push(eventType) }
    if (typeof from === 'string' && from) { conditions.push('e.created_at >= ?'); params.push(`${from} 00:00:00`) }
    if (typeof to === 'string' && to) { conditions.push('e.created_at <= ?'); params.push(`${to} 23:59:59`) }
    if (typeof protocol === 'string' && protocol) { conditions.push('(r.protocol LIKE ? OR r.company_name LIKE ? OR r.client_code LIKE ?)'); params.push(`%${protocol}%`, `%${protocol}%`, `%${protocol}%`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = await connection.query(
      `SELECT e.id, e.request_id AS requestId, e.event_type AS eventType, e.event_data AS eventData, e.created_at AS createdAt,
        u.name AS actorName, u.role AS actorRole, r.protocol, r.company_name AS companyName, r.client_code AS clientCode
       FROM audit_events e
       INNER JOIN users u ON u.id = e.actor_id
       INNER JOIN credit_requests r ON r.id = e.request_id
       ${where}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1000`,
      params,
    )
    response.json(rows)
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível consultar a trilha de auditoria.' })
  } finally {
    connection?.release()
  }
})

const manageableRoles = (actorRole: UserRole): UserRole[] =>
  actorRole === 'ADMIN' ? ['VENDEDOR', 'ANALISTA', 'GESTORA', 'ADMIN'] : ['VENDEDOR', 'ANALISTA', 'GESTORA']

app.get('/api/admin/users', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const authUser = (request as AuthRequest).user
  let connection
  try {
    connection = await pool.getConnection()
    const roles = manageableRoles(authUser!.role)
    const rows = await connection.query(
      `SELECT id, name, email, role, pratico_seller_code AS praticoSellerCode, store_name AS storeName,
        manager_name AS managerName, whatsapp_phone AS whatsappPhone, active, created_at AS createdAt
       FROM users WHERE role IN (${roles.map(() => '?').join(',')}) ORDER BY name`,
      roles,
    )
    response.json(rows)
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível listar os usuários.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/admin/users', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const authUser = (request as AuthRequest).user
  const { name, email, role, password, praticoSellerCode, storeName, managerName, whatsappPhone } = request.body
  const allowedRoles = manageableRoles(authUser!.role)
  if (!name || !email || !allowedRoles.includes(role)) {
    response.status(400).json({ message: 'Nome, e-mail e função são obrigatórios.' })
    return
  }
  if (role === 'VENDEDOR' && (!praticoSellerCode || !storeName || !managerName || !whatsappPhone)) {
    response.status(400).json({ message: 'Para vendedores, informe código no Prático, loja, gerente e WhatsApp.' })
    return
  }
  const passwordError = validatePassword(password)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  const sellerFields = role === 'VENDEDOR' ? [praticoSellerCode, storeName, managerName, whatsappPhone] : [null, null, null, null]
  let connection
  try {
    connection = await pool.getConnection()
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await connection.query(
      'INSERT INTO users (name, email, role, pratico_seller_code, store_name, manager_name, whatsapp_phone, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, role, ...sellerFields, passwordHash],
    )
    response.status(201).json({ id: Number(result.insertId), name, email, role, praticoSellerCode: sellerFields[0], storeName: sellerFields[1], managerName: sellerFields[2], whatsappPhone: sellerFields[3], active: 1 })
  } catch (error) {
    console.error(error)
    response.status(409).json({ message: 'Não foi possível criar o usuário. Verifique se o e-mail já existe.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/admin/users/:id/toggle', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const userId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!userId) { response.status(400).json({ message: 'Usuário inválido.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const target = await connection.query('SELECT role FROM users WHERE id = ?', [userId])
    if (!target[0] || !manageableRoles(authUser!.role).includes(target[0].role)) {
      response.status(404).json({ message: 'Usuário não encontrado.' })
      return
    }
    await connection.query('UPDATE users SET active = NOT active WHERE id = ?', [userId])
    const rows = await connection.query('SELECT id, active FROM users WHERE id = ?', [userId])
    response.json(rows[0])
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível alterar o acesso.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/admin/users/:id/reset-password', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const userId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { newPassword } = request.body
  if (!userId) { response.status(400).json({ message: 'Usuário inválido.' }); return }
  const passwordError = validatePassword(newPassword)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const target = await connection.query('SELECT role FROM users WHERE id = ?', [userId])
    if (!target[0] || !manageableRoles(authUser!.role).includes(target[0].role)) {
      response.status(404).json({ message: 'Usuário não encontrado.' })
      return
    }
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
    response.json({ message: 'Senha redefinida com sucesso.' })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível redefinir a senha.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/admin/users/:id', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const userId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { name, email, role, praticoSellerCode, storeName, managerName, whatsappPhone } = request.body
  const allowedRoles = manageableRoles(authUser!.role)
  if (!userId) { response.status(400).json({ message: 'Usuário inválido.' }); return }
  if (!name || !email || !allowedRoles.includes(role)) {
    response.status(400).json({ message: 'Nome, e-mail e função são obrigatórios.' })
    return
  }
  if (role === 'VENDEDOR' && (!praticoSellerCode || !storeName || !managerName || !whatsappPhone)) {
    response.status(400).json({ message: 'Para vendedores, informe código no Prático, loja, gerente e WhatsApp.' })
    return
  }
  const sellerFields = role === 'VENDEDOR' ? [praticoSellerCode, storeName, managerName, whatsappPhone] : [null, null, null, null]
  let connection
  try {
    connection = await pool.getConnection()
    const target = await connection.query('SELECT role FROM users WHERE id = ?', [userId])
    if (!target[0] || !allowedRoles.includes(target[0].role)) {
      response.status(404).json({ message: 'Usuário não encontrado.' })
      return
    }
    await connection.query(
      'UPDATE users SET name = ?, email = ?, role = ?, pratico_seller_code = ?, store_name = ?, manager_name = ?, whatsapp_phone = ? WHERE id = ?',
      [name, email, role, ...sellerFields, userId],
    )
    const rows = await connection.query(
      `SELECT id, name, email, role, pratico_seller_code AS praticoSellerCode, store_name AS storeName,
        manager_name AS managerName, whatsapp_phone AS whatsappPhone, active
       FROM users WHERE id = ?`,
      [userId],
    )
    response.json(rows[0])
  } catch (error) {
    console.error(error)
    response.status(409).json({ message: 'Não foi possível salvar as alterações. Verifique se o e-mail já está em uso.' })
  } finally {
    connection?.release()
  }
})

app.delete('/api/admin/users/:id', authorize('ADMIN', 'GESTORA'), async (request, response) => {
  const userId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!userId) { response.status(400).json({ message: 'Usuário inválido.' }); return }
  if (userId === authUser!.id) {
    response.status(400).json({ message: 'Você não pode excluir a própria conta.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    const target = await connection.query('SELECT role FROM users WHERE id = ?', [userId])
    if (!target[0] || !manageableRoles(authUser!.role).includes(target[0].role)) {
      response.status(404).json({ message: 'Usuário não encontrado.' })
      return
    }
    await connection.query('DELETE FROM users WHERE id = ?', [userId])
    response.json({ message: 'Usuário excluído com sucesso.' })
  } catch (error: any) {
    if (error?.errno === 1451 || error?.code === 'ER_ROW_IS_REFERENCED_2') {
      response.status(409).json({ message: 'Este usuário possui solicitações ou registros vinculados e não pode ser excluído. Suspenda o acesso em vez de excluir.' })
      return
    }
    console.error(error)
    response.status(500).json({ message: 'Não foi possível excluir o usuário.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/credit-requests', authorize('VENDEDOR', 'ADMIN'), async (request, response) => {
  const authUser = (request as AuthRequest).user
  const {
    clientCode, companyName, tradeName, cnpj, stateRegistration, phone, address,
    invoiceEmail, financeEmail, contactName, contactEmail, requestPurpose, purchaseAuthorization,
    deliveryType, deliveryLocation, deliveryAddress, sellerId, origin, sellerNotes,
  } = request.body
  const effectiveSellerId = authUser?.role === 'VENDEDOR' ? authUser.id : sellerId
  if (!clientCode || !companyName || !cnpj || !effectiveSellerId || !requestPurpose || !contactName || !contactEmail || !purchaseAuthorization || !deliveryType || !deliveryLocation) {
    response.status(400).json({ message: 'Código, motivo da solicitação, contato, autorização de compra, tipo e local de entrega são obrigatórios.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    const protocol = `CR-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
    await connection.beginTransaction()
    const result = await connection.query(
      `INSERT INTO credit_requests (protocol, client_code, company_name, trade_name, cnpj, state_registration, phone, address, invoice_email, finance_email, contact_name, contact_email, request_purpose, purchase_authorization, delivery_type, delivery_location, delivery_address, seller_id, origin, seller_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [protocol, clientCode, companyName, tradeName || null, cnpj, stateRegistration || null, phone || null, address || null, invoiceEmail || null, financeEmail || null, contactName, contactEmail, requestPurpose, purchaseAuthorization, deliveryType, deliveryLocation, deliveryAddress || null, effectiveSellerId, origin || null, sellerNotes || null],
    )
    const requestId = Number(result.insertId)
    await logAuditEvent(connection, requestId, effectiveSellerId, 'SOLICITACAO_CRIADA', { protocol, companyName })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'created', actorId: effectiveSellerId, sellerId: effectiveSellerId, protocol, companyName, status: 'RECEBIDA' })
    response.status(201).json({ id: requestId, protocol })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível criar a solicitação.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id/status', authorize('ANALISTA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { status } = request.body
  if (!requestId || !['EM_ANALISE', 'AGUARDANDO_GESTAO'].includes(status)) {
    response.status(400).json({ message: 'Status inválido.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await connection.query('UPDATE credit_requests SET status = ? WHERE id = ?', [status, requestId])
    await logAuditEvent(connection, requestId, authUser?.id, 'STATUS_ATUALIZADO', { status })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'status' })
    response.json({ status })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível atualizar o status.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id/return-to-seller', authorize('ANALISTA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { reason } = request.body
  if (!requestId || !reason || typeof reason !== 'string' || !reason.trim()) {
    response.status(400).json({ message: 'Informe a justificativa da devolução.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    const [requestRow] = await connection.query(
      `SELECT r.protocol, r.company_name AS companyName, r.status, r.seller_id AS sellerId, u.email AS sellerEmail
       FROM credit_requests r INNER JOIN users u ON u.id = r.seller_id WHERE r.id = ?`,
      [requestId],
    )
    if (!requestRow) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    if (!['RECEBIDA', 'EM_ANALISE'].includes(requestRow.status)) {
      response.status(400).json({ message: 'Só é possível devolver cadastros que ainda estão em triagem.' })
      return
    }
    await connection.beginTransaction()
    await connection.query('UPDATE credit_requests SET status = ?, return_reason = ? WHERE id = ?', ['DEVOLVIDA', reason.trim(), requestId])
    await logAuditEvent(connection, requestId, authUser?.id, 'SOLICITACAO_DEVOLVIDA', { reason: reason.trim() })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'return-to-seller', actorId: authUser?.id, sellerId: requestRow.sellerId, protocol: requestRow.protocol, companyName: requestRow.companyName, status: 'DEVOLVIDA' })

    let emailSent = false
    if (mailer) {
      try {
        await mailer.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: requestRow.sellerEmail,
          subject: `Cadastro devolvido para ajustes - ${requestRow.protocol}`,
          text: `Olá,\n\nO cadastro ${requestRow.protocol} (${requestRow.companyName}) foi devolvido pela analista e precisa de ajustes antes de continuar a análise.\n\nMotivo: ${reason.trim()}\n\nAcesse "Minhas solicitações" para editar e reenviar o cadastro.\n\nSis-Cred Cadastro e Crédito`,
          html: emailLayout({
            eyebrow: `Protocolo ${requestRow.protocol}`,
            title: 'Cadastro devolvido para ajustes',
            bodyHtml: `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
              <p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">O cadastro <strong>${escapeHtml(requestRow.protocol)}</strong> (${escapeHtml(requestRow.companyName)}) foi devolvido pela analista e precisa de ajustes antes de continuar a análise.</p>
              <div style="margin:0 0 18px;padding:14px 16px;background:#f5f7fa;border-left:4px solid #fbba00;border-radius:6px;"><p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#96660a;text-transform:uppercase;">Motivo da devolução</p><p style="margin:0;font-size:14px;color:#3a4756;line-height:1.55;">${escapeHtml(reason.trim())}</p></div>
              <p style="margin:0;font-size:14px;color:#3a4756;line-height:1.6;">Acesse <strong>"Minhas solicitações"</strong> no Sis-Cred para editar e reenviar o cadastro.</p>`,
          }),
          attachments: emailAttachments,
        })
        emailSent = true
      } catch (error) {
        console.error(error)
      }
    }
    response.json({ status: 'DEVOLVIDA', emailSent })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível devolver o cadastro.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id', authorize('VENDEDOR', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const {
    clientCode, companyName, tradeName, cnpj, stateRegistration, phone, address,
    invoiceEmail, financeEmail, contactName, contactEmail, requestPurpose, purchaseAuthorization,
    deliveryType, deliveryLocation, deliveryAddress, origin, sellerNotes,
  } = request.body
  if (!requestId || !clientCode || !companyName || !cnpj || !requestPurpose || !contactName || !contactEmail || !purchaseAuthorization || !deliveryType || !deliveryLocation) {
    response.status(400).json({ message: 'Código, motivo da solicitação, contato, autorização de compra, tipo e local de entrega são obrigatórios.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    if (!(await ensureRequestAccess(connection, requestId, authUser))) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    const [requestRow] = await connection.query('SELECT status, protocol FROM credit_requests WHERE id = ?', [requestId])
    if (!requestRow) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    if (requestRow.status !== 'DEVOLVIDA') { response.status(400).json({ message: 'Só é possível editar cadastros devolvidos para ajustes.' }); return }
    await connection.beginTransaction()
    await connection.query(
      `UPDATE credit_requests SET
        client_code = ?, company_name = ?, trade_name = ?, cnpj = ?, state_registration = ?, phone = ?, address = ?,
        invoice_email = ?, finance_email = ?, contact_name = ?, contact_email = ?, request_purpose = ?, purchase_authorization = ?,
        delivery_type = ?, delivery_location = ?, delivery_address = ?, origin = ?, seller_notes = ?,
        status = 'RECEBIDA', return_reason = NULL
       WHERE id = ?`,
      [clientCode, companyName, tradeName || null, cnpj, stateRegistration || null, phone || null, address || null, invoiceEmail || null, financeEmail || null, contactName, contactEmail, requestPurpose, purchaseAuthorization, deliveryType, deliveryLocation, deliveryAddress || null, origin || null, sellerNotes || null, requestId],
    )
    await logAuditEvent(connection, requestId, authUser?.id, 'SOLICITACAO_REENVIADA', { protocol: requestRow.protocol })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'resent', actorId: authUser?.id, protocol: requestRow.protocol, companyName, status: 'RECEBIDA' })
    response.json({ status: 'RECEBIDA' })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível reenviar o cadastro.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/credit-requests/:id/decision', async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!requestId) { response.status(400).json({ message: 'Solicitação inválida.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    if (!(await ensureRequestAccess(connection, requestId, authUser))) { response.status(404).json({ message: 'Nenhuma decisão registrada para esta solicitação.' }); return }
    const rows = await connection.query(
      `SELECT r.protocol, r.company_name AS companyName, d.decision, d.approved_limit AS approvedLimit,
        d.internal_reason AS internalReason, r.client_message AS clientMessage, d.decided_at AS decidedAt, u.name AS managerName
       FROM credit_decisions d
       INNER JOIN credit_requests r ON r.id = d.request_id
       INNER JOIN users u ON u.id = d.manager_id
       WHERE d.request_id = ?
       ORDER BY d.decided_at DESC LIMIT 1`,
      [requestId],
    )
    if (!rows[0]) { response.status(404).json({ message: 'Nenhuma decisão registrada para esta solicitação.' }); return }
    if (authUser?.role === 'VENDEDOR') rows[0].internalReason = null
    response.json(rows[0])
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível consultar a decisão.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/credit-requests/:id/documents', authorize('VENDEDOR', 'ANALISTA', 'ADMIN'), upload.single('file'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const documentType = request.body.documentType
  const file = request.file
  if (!requestId || !file) { response.status(400).json({ message: 'Arquivo PDF é obrigatório.' }); return }
  if (!documentTypes.includes(documentType)) { response.status(400).json({ message: 'Tipo de documento inválido.' }); return }
  if (!isPdfBuffer(file.buffer)) { response.status(400).json({ message: 'O arquivo enviado não é um PDF válido.' }); return }
  const extractedData = documentType === 'DEPS' ? await extractDepsFromPdf(file.buffer) : null
  let connection
  try {
    connection = await pool.getConnection()
    if (!(await ensureRequestAccess(connection, requestId, authUser))) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    await connection.beginTransaction()
    const result = await connection.query(
      'INSERT INTO dossier_documents (request_id, document_type, original_name, file_data, file_size, extracted_data, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [requestId, documentType, file.originalname, file.buffer, file.size, extractedData ? JSON.stringify(extractedData) : null, file.mimetype, authUser?.id],
    )
    await logAuditEvent(connection, requestId, authUser?.id, 'DOCUMENTO_ENVIADO', { documentType, originalName: file.originalname })
    await connection.commit()
    response.status(201).json({ id: Number(result.insertId), documentType, originalName: file.originalname, fileSize: file.size, extractedData, uploadedAt: new Date().toISOString() })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível salvar o documento.' })
  } finally {
    connection?.release()
  }
})

app.delete('/api/documents/:id', authorize('ANALISTA', 'ADMIN'), async (request, response) => {
  const documentId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!documentId) { response.status(400).json({ message: 'Documento inválido.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query('SELECT request_id AS requestId, document_type AS documentType, original_name AS originalName FROM dossier_documents WHERE id = ?', [documentId])
    const doc = rows[0]
    if (!doc) { response.status(404).json({ message: 'Documento não encontrado.' }); return }
    await connection.query('DELETE FROM dossier_documents WHERE id = ?', [documentId])
    await logAuditEvent(connection, doc.requestId, authUser?.id, 'DOCUMENTO_REMOVIDO', { documentType: doc.documentType, originalName: doc.originalName })
    response.status(204).end()
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível remover o documento.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/credit-requests/:id/documents', async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!requestId) { response.status(400).json({ message: 'Solicitação inválida.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    if (!(await ensureRequestAccess(connection, requestId, authUser))) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    const rows = await connection.query(
      `SELECT d.id, d.document_type AS documentType, d.original_name AS originalName, d.file_size AS fileSize,
        d.extracted_data AS extractedData, d.uploaded_at AS uploadedAt, u.name AS uploadedByName
       FROM dossier_documents d
       INNER JOIN users u ON u.id = d.uploaded_by
       WHERE d.request_id = ?
       ORDER BY d.uploaded_at DESC`,
      [requestId],
    )
    response.json(rows.map((row: Record<string, unknown>) => ({
      ...row,
      extractedData: typeof row.extractedData === 'string' ? JSON.parse(row.extractedData) : row.extractedData,
    })))
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível consultar os documentos.' })
  } finally {
    connection?.release()
  }
})

app.get('/api/documents/:id/file', async (request, response) => {
  const documentId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!documentId) { response.status(400).json({ message: 'Documento inválido.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query(
      `SELECT d.original_name AS originalName, d.file_data AS fileData, d.mime_type AS mimeType, r.seller_id AS sellerId
       FROM dossier_documents d INNER JOIN credit_requests r ON r.id = d.request_id WHERE d.id = ?`,
      [documentId],
    )
    const doc = rows[0]
    if (!doc || !doc.fileData) { response.status(404).json({ message: 'Documento não encontrado.' }); return }
    if (authUser?.role === 'VENDEDOR' && doc.sellerId !== authUser.id) { response.status(404).json({ message: 'Documento não encontrado.' }); return }
    response.setHeader('Content-Type', doc.mimeType || 'application/pdf')
    response.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(doc.originalName || 'documento.pdf')}"`)
    response.send(doc.fileData)
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível abrir o documento.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id/decision', authorize('GESTORA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { decision, approvedLimit, internalReason, clientMessage, recipientEmail } = request.body
  const managerId = authUser?.id
  if (!requestId || !managerId || !['APROVADA', 'NEGADA'].includes(decision)) {
    response.status(400).json({ message: 'Dados da decisão inválidos.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    const [requestRow] = await connection.query('SELECT protocol, company_name AS companyName, seller_id AS sellerId FROM credit_requests WHERE id = ?', [requestId])
    if (!requestRow) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    await connection.beginTransaction()
    const status = decision === 'APROVADA' ? 'APROVADA' : 'NEGADA'
    await connection.query(
      'INSERT INTO credit_decisions (request_id, manager_id, decision, approved_limit, internal_reason) VALUES (?, ?, ?, ?, ?)',
      [requestId, managerId, decision, decision === 'APROVADA' ? approvedLimit : null, internalReason || null],
    )
    await connection.query(
      'UPDATE credit_requests SET status = ?, approved_limit = ?, client_message = ? WHERE id = ?',
      [status, decision === 'APROVADA' ? approvedLimit : null, clientMessage || null, requestId],
    )
    await logAuditEvent(connection, requestId, managerId, 'DECISAO_REGISTRADA', { decision, approvedLimit: approvedLimit || null })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'decision', actorId: managerId, sellerId: requestRow.sellerId, protocol: requestRow.protocol, companyName: requestRow.companyName, status })

    let emailSent = false
    let emailError: string | null = null
    if (recipientEmail && mailer) {
      const subject = `Resultado da análise de crédito - ${requestRow.protocol}`
      const formattedLimit = Number(approvedLimit || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const text = decision === 'APROVADA'
        ? `Olá,\n\nA solicitação de crédito ${requestRow.protocol} (${requestRow.companyName}) foi APROVADA.\nLimite aprovado: ${formattedLimit}\n\nEste limite ainda não foi atualizado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando a liberação.\n\nSis-Cred Cadastro e Crédito`
        : `Olá,\n\nA solicitação de crédito ${requestRow.protocol} (${requestRow.companyName}) foi NEGADA.\n\nEste resultado ainda não foi registrado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando o registro.\n\nSis-Cred Cadastro e Crédito`
      const html = emailLayout({
        eyebrow: `Protocolo ${requestRow.protocol}`,
        title: decision === 'APROVADA' ? 'Crédito aprovado' : 'Crédito negado',
        bodyHtml: decision === 'APROVADA'
          ? `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
            <p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">A solicitação de crédito <strong>${escapeHtml(requestRow.protocol)}</strong> (${escapeHtml(requestRow.companyName)}) foi <strong style="color:#16966b;">APROVADA</strong>.</p>
            <div style="margin:0 0 18px;padding:14px 16px;background:#e9f8f2;border-radius:8px;"><p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#0f6b4c;text-transform:uppercase;">Limite aprovado</p><p style="margin:0;font-size:22px;font-weight:800;color:#0f6b4c;">${formattedLimit}</p></div>
            ${warningCallout('Este limite ainda não foi atualizado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando a liberação.')}`
          : `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
            <p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">A solicitação de crédito <strong>${escapeHtml(requestRow.protocol)}</strong> (${escapeHtml(requestRow.companyName)}) foi <strong style="color:#c0392b;">NEGADA</strong>.</p>
            ${warningCallout('Este resultado ainda não foi registrado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando o registro.')}`,
      })
      try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipientEmail, subject, text, html, attachments: emailAttachments })
        emailSent = true
      } catch (error) {
        console.error(error)
        emailError = 'Não foi possível enviar o e-mail.'
      }
    }
    response.json({ status, emailSent, emailError })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível registrar a decisão.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id/reopen', authorize('GESTORA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  const { approvedLimit, internalReason, clientMessage, recipientEmail } = request.body
  const managerId = authUser?.id
  if (!requestId || !managerId || approvedLimit == null || Number(approvedLimit) <= 0 || !internalReason) {
    response.status(400).json({ message: 'Informe o novo limite aprovado e a justificativa da reabertura.' })
    return
  }
  let connection
  try {
    connection = await pool.getConnection()
    const [requestRow] = await connection.query('SELECT protocol, company_name AS companyName, status, seller_id AS sellerId FROM credit_requests WHERE id = ?', [requestId])
    if (!requestRow) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    if (requestRow.status !== 'NEGADA') { response.status(400).json({ message: 'Só é possível reabrir solicitações negadas.' }); return }
    await connection.beginTransaction()
    await connection.query(
      'INSERT INTO credit_decisions (request_id, manager_id, decision, approved_limit, internal_reason) VALUES (?, ?, ?, ?, ?)',
      [requestId, managerId, 'APROVADA', approvedLimit, internalReason],
    )
    // Reabrir devolve a solicitação para a fila de "pendentes de confirmação" da analista,
    // já que o Prático ainda reflete a negativa (ou o limite antigo) e precisa ser atualizado de novo.
    await connection.query(
      'UPDATE credit_requests SET status = ?, approved_limit = ?, client_message = ?, pratico_confirmed_at = NULL, pratico_confirmed_by = NULL WHERE id = ?',
      ['APROVADA', approvedLimit, clientMessage || null, requestId],
    )
    await logAuditEvent(connection, requestId, managerId, 'DECISAO_REABERTA', { approvedLimit, internalReason })
    await connection.commit()
    broadcast('requests-changed', { requestId, reason: 'reopen', actorId: managerId, sellerId: requestRow.sellerId, protocol: requestRow.protocol, companyName: requestRow.companyName, status: 'APROVADA' })

    let emailSent = false
    let emailError: string | null = null
    if (recipientEmail && mailer) {
      const subject = `Solicitação reaberta e aprovada - ${requestRow.protocol}`
      const formattedLimit = Number(approvedLimit).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const text = `Olá,\n\nA solicitação de crédito ${requestRow.protocol} (${requestRow.companyName}), que havia sido negada, foi REABERTA pela gestão e agora está APROVADA.\nNovo limite aprovado: ${formattedLimit}\n\nEste novo limite ainda não foi atualizado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando a liberação.\n\nSis-Cred Cadastro e Crédito`
      const html = emailLayout({
        eyebrow: `Protocolo ${requestRow.protocol}`,
        title: 'Solicitação reaberta e aprovada',
        bodyHtml: `<p style="margin:0 0 14px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
          <p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">A solicitação de crédito <strong>${escapeHtml(requestRow.protocol)}</strong> (${escapeHtml(requestRow.companyName)}), que havia sido negada, foi <strong>REABERTA</strong> pela gestão e agora está <strong style="color:#16966b;">APROVADA</strong>.</p>
          <div style="margin:0 0 18px;padding:14px 16px;background:#e9f8f2;border-radius:8px;"><p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#0f6b4c;text-transform:uppercase;">Novo limite aprovado</p><p style="margin:0;font-size:22px;font-weight:800;color:#0f6b4c;">${formattedLimit}</p></div>
          ${warningCallout('Este novo limite ainda não foi atualizado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando a liberação.')}`,
      })
      try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipientEmail, subject, text, html, attachments: emailAttachments })
        emailSent = true
      } catch (error) {
        console.error(error)
        emailError = 'Não foi possível enviar o e-mail.'
      }
    }
    response.json({ status: 'APROVADA', emailSent, emailError })
  } catch (error) {
    await connection?.rollback()
    console.error(error)
    response.status(500).json({ message: 'Não foi possível reabrir a solicitação.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/credit-requests/:id/pratico-confirm', authorize('ANALISTA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!requestId) { response.status(400).json({ message: 'Solicitação inválida.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query(
      `SELECT r.protocol, r.company_name AS companyName, r.status, r.approved_limit AS approvedLimit, r.seller_id AS sellerId,
        r.pratico_confirmed_at AS praticoConfirmedAt, u.name AS sellerName, u.email AS sellerEmail
       FROM credit_requests r INNER JOIN users u ON u.id = r.seller_id WHERE r.id = ?`,
      [requestId],
    )
    const requestRow = rows[0]
    if (!requestRow) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    if (!['APROVADA', 'NEGADA'].includes(requestRow.status)) { response.status(400).json({ message: 'Esta solicitação ainda não tem uma decisão registrada.' }); return }
    if (requestRow.praticoConfirmedAt) { response.status(409).json({ message: 'Esta atualização já havia sido confirmada.' }); return }
    await connection.query('UPDATE credit_requests SET pratico_confirmed_at = NOW(), pratico_confirmed_by = ? WHERE id = ?', [authUser?.id, requestId])
    await logAuditEvent(connection, requestId, authUser?.id, 'PRATICO_CONFIRMADO', { status: requestRow.status })
    broadcast('requests-changed', { requestId, reason: 'pratico-confirm', actorId: authUser?.id, sellerId: requestRow.sellerId, protocol: requestRow.protocol, companyName: requestRow.companyName, status: requestRow.status })

    let emailSent = false
    let emailError: string | null = null
    if (mailer) {
      const subject = `Limite atualizado no sistema Prático - ${requestRow.protocol}`
      const formattedLimit = Number(requestRow.approvedLimit || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const text = requestRow.status === 'APROVADA'
        ? `Olá,\n\nO limite de crédito aprovado da solicitação ${requestRow.protocol} (${requestRow.companyName}) já foi atualizado no sistema Prático.\nLimite: ${formattedLimit}\n\nSis-Cred Cadastro e Crédito`
        : `Olá,\n\nA negativa de crédito da solicitação ${requestRow.protocol} (${requestRow.companyName}) já foi registrada no sistema Prático.\n\nSis-Cred Cadastro e Crédito`
      const html = emailLayout({
        eyebrow: `Protocolo ${requestRow.protocol}`,
        title: 'Atualização confirmada no Prático',
        bodyHtml: requestRow.status === 'APROVADA'
          ? `<p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
            <p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">O limite de crédito aprovado da solicitação <strong>${escapeHtml(requestRow.protocol)}</strong> (${escapeHtml(requestRow.companyName)}) já foi atualizado no sistema Prático.</p>
            <div style="margin:0 0 6px;padding:14px 16px;background:#e9f8f2;border-radius:8px;"><p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#0f6b4c;text-transform:uppercase;">Limite liberado</p><p style="margin:0;font-size:22px;font-weight:800;color:#0f6b4c;">${formattedLimit}</p></div>`
          : `<p style="margin:0 0 16px;font-size:14px;color:#3a4756;line-height:1.6;">Olá,</p>
            ${successCallout(`A negativa de crédito da solicitação ${requestRow.protocol} (${requestRow.companyName}) já foi registrada no sistema Prático.`)}`,
      })
      try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: requestRow.sellerEmail, subject, text, html, attachments: emailAttachments })
        emailSent = true
      } catch (error) {
        console.error(error)
        emailError = 'Não foi possível enviar o e-mail.'
      }
    }
    response.json({ praticoConfirmedAt: new Date().toISOString(), emailSent, emailError })
  } catch (error) {
    console.error(error)
    response.status(500).json({ message: 'Não foi possível confirmar a atualização no Prático.' })
  } finally {
    connection?.release()
  }
})

// Handler de erro global: garante que nenhuma falha inesperada (ex.: JSON malformado no corpo
// da requisição, ou limite de tamanho de upload do Multer) devolva detalhes internos ao cliente.
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error)
  if (response.headersSent) return
  const status = typeof (error as { status?: number; statusCode?: number })?.status === 'number'
    ? (error as { status: number }).status
    : typeof (error as { statusCode?: number })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
  const safeStatus = status >= 400 && status < 500 ? status : 500
  response.status(safeStatus).json({ message: safeStatus === 500 ? 'Erro interno do servidor.' : 'Requisição inválida.' })
})

app.listen(port, () => console.log(`API de crédito ouvindo em http://localhost:${port}`))
