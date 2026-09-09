import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import { createHash, randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import mariadb from 'mariadb'
import multer from 'multer'
import nodemailer from 'nodemailer'

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

// Em produção a API roda atrás de um proxy reverso (Nginx/IIS); isso garante que o
// limitador de tentativas identifique o IP real do cliente, e não o do proxy.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY)
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } })
const strictAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } })
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
  const { name, email, password } = request.body
  if (!name || typeof name !== 'string' || !email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: 'Informe nome e e-mail válidos.' })
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
      'INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)',
      [name.trim(), normalizedEmail, 'VENDEDOR', passwordHash],
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
        r.requested_limit AS requestedLimit, r.approved_limit AS approvedLimit, r.origin, r.seller_notes AS sellerNotes,
        r.status, r.submitted_at AS submittedAt,
        r.pratico_confirmed_at AS praticoConfirmedAt, pc.name AS praticoConfirmedByName,
        u.name AS sellerName, u.email AS sellerEmail
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
      `SELECT id, name, email, role, active, created_at AS createdAt FROM users WHERE role IN (${roles.map(() => '?').join(',')}) ORDER BY name`,
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
  const { name, email, role, password } = request.body
  const allowedRoles = manageableRoles(authUser!.role)
  if (!name || !email || !allowedRoles.includes(role)) {
    response.status(400).json({ message: 'Nome, e-mail e função são obrigatórios.' })
    return
  }
  const passwordError = validatePassword(password)
  if (passwordError) { response.status(400).json({ message: passwordError }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await connection.query('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)', [name, email, role, passwordHash])
    response.status(201).json({ id: Number(result.insertId), name, email, role, active: 1 })
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
    broadcast('requests-changed', { requestId, reason: 'created' })
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
  let connection
  try {
    connection = await pool.getConnection()
    if (!(await ensureRequestAccess(connection, requestId, authUser))) { response.status(404).json({ message: 'Solicitação não encontrada.' }); return }
    await connection.beginTransaction()
    const result = await connection.query(
      'INSERT INTO dossier_documents (request_id, document_type, original_name, file_data, file_size, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [requestId, documentType, file.originalname, file.buffer, file.size, file.mimetype, authUser?.id],
    )
    await logAuditEvent(connection, requestId, authUser?.id, 'DOCUMENTO_ENVIADO', { documentType, originalName: file.originalname })
    await connection.commit()
    response.status(201).json({ id: Number(result.insertId), documentType, originalName: file.originalname, fileSize: file.size, uploadedAt: new Date().toISOString() })
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
        d.uploaded_at AS uploadedAt, u.name AS uploadedByName
       FROM dossier_documents d
       INNER JOIN users u ON u.id = d.uploaded_by
       WHERE d.request_id = ?
       ORDER BY d.uploaded_at DESC`,
      [requestId],
    )
    response.json(rows)
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
    const [requestRow] = await connection.query('SELECT protocol, company_name AS companyName FROM credit_requests WHERE id = ?', [requestId])
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
    broadcast('requests-changed', { requestId, reason: 'decision' })

    let emailSent = false
    let emailError: string | null = null
    if (recipientEmail && mailer) {
      const subject = `Resultado da análise de crédito - ${requestRow.protocol}`
      const text = decision === 'APROVADA'
        ? `Olá,\n\nA solicitação de crédito ${requestRow.protocol} (${requestRow.companyName}) foi APROVADA.\nLimite aprovado: ${Number(approvedLimit || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n\nEste limite ainda não foi atualizado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando a liberação.\n\nSis-Cred Cadastro e Crédito`
        : `Olá,\n\nA solicitação de crédito ${requestRow.protocol} (${requestRow.companyName}) foi NEGADA.\n\nEste resultado ainda não foi registrado no sistema Prático e está aguardando a analista realizar essa atualização. Assim que o Prático for atualizado, você receberá um novo e-mail confirmando o registro.\n\nSis-Cred Cadastro e Crédito`
      try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipientEmail, subject, text })
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

app.patch('/api/credit-requests/:id/pratico-confirm', authorize('ANALISTA', 'ADMIN'), async (request, response) => {
  const requestId = Number(request.params.id)
  const authUser = (request as AuthRequest).user
  if (!requestId) { response.status(400).json({ message: 'Solicitação inválida.' }); return }
  let connection
  try {
    connection = await pool.getConnection()
    const rows = await connection.query(
      `SELECT r.protocol, r.company_name AS companyName, r.status, r.approved_limit AS approvedLimit,
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
    broadcast('requests-changed', { requestId, reason: 'pratico-confirm' })

    let emailSent = false
    let emailError: string | null = null
    if (mailer) {
      const subject = `Limite atualizado no sistema Prático - ${requestRow.protocol}`
      const text = requestRow.status === 'APROVADA'
        ? `Olá,\n\nO limite de crédito aprovado da solicitação ${requestRow.protocol} (${requestRow.companyName}) já foi atualizado no sistema Prático.\nLimite: ${Number(requestRow.approvedLimit || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n\nSis-Cred Cadastro e Crédito`
        : `Olá,\n\nA negativa de crédito da solicitação ${requestRow.protocol} (${requestRow.companyName}) já foi registrada no sistema Prático.\n\nSis-Cred Cadastro e Crédito`
      try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: requestRow.sellerEmail, subject, text })
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
