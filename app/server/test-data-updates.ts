// Exercita a área de atualização de dados ponta a ponta contra a API real.
// Cria usuários de teste se preciso, registra uma atualização, valida as regras e
// a conferência da analista — e limpa tudo no final.
// Exercita a área de atualização de dados contra a API REAL em execução
// (mesmo processo que roda em produção). Sobe nada: só conversa por HTTP.
//   PORT=3399 npm run api  ->  em outro terminal: npx tsx server/test-data-updates.ts
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mariadb from 'mariadb'

const port = Number(process.env.TEST_PORT || 3399)
const base = `http://127.0.0.1:${port}`
const pool = mariadb.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 4,
  acquireTimeout: 10000, bigIntAsNumber: true, decimalAsNumber: true,
})

const health = await fetch(`${base}/api/health`).then((r) => r.status).catch(() => 0)
if (health !== 200) {
  console.log(`A API precisa estar rodando em ${base} (rode "PORT=${port} npm run api" em outro terminal).`)
  process.exit(1)
}

let pass = 0, fail = 0
const check = (name: string, condition: boolean, detail = '') => {
  if (condition) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const stamp = Date.now()
const sellerEmail = `test.vendedor.${stamp}@empresa.com.br`
const analystEmail = `test.analista.${stamp}@empresa.com.br`
const hash = await bcrypt.hash('Teste12345', 4)

const connection = await pool.getConnection()
try {
  // INSERT devolve o pacote de resultado direto (não é lista de linhas como um SELECT).
  const seller = await connection.query(
    `INSERT INTO users (name, email, role, pratico_seller_code, store_name, manager_name, whatsapp_phone, password_hash)
     VALUES (?, ?, 'VENDEDOR', 'T1', 'Loja Teste', 'Gerente', '11999999999', ?)`,
    ['Vendedor Teste', sellerEmail, hash]) as { insertId: number }
  const analyst = await connection.query(
    `INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, 'ANALISTA', ?)`,
    ['Analista Teste', analystEmail, hash]) as { insertId: number }
  const sellerId = Number(seller.insertId)
  const analystId = Number(analyst.insertId)
  console.log(`  (usuários de teste: vendedor ${sellerId}, analista ${analystId})`)

  // Login real: exercita também a rota de autenticação e devolve o token como o navegador recebe.
  const login = async (email: string) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Teste12345' }),
    })
    const body = await response.json().catch(() => null) as { token?: string; message?: string }
    if (!response.ok || !body?.token) throw new Error(`login de ${email} falhou: ${body?.message}`)
    return body.token
  }
  const sellerToken = await login(sellerEmail)
  const analystToken = await login(analystEmail)
  check('login do vendedor devolve token', !!sellerToken)
  check('login da analista devolve token', !!analystToken)

  const call = async (path: string, options: RequestInit = {}, auth = sellerToken) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...(options.headers || {}) },
    })
    const body = await response.json().catch(() => null)
    return { status: response.status, body: body as Record<string, unknown> }
  }

  console.log('\n[1] Criação da atualização pelo vendedor')
  const valid = {
    clientCode: String(900000 + (stamp % 900)), companyName: 'Cliente Teste Ltda',
    cnpj: '12345678000199', email: 'novo@cliente.com.br', phone: '(11) 3333-4444',
    contactName: 'Maria Souza', street: 'Rua Nova', streetNumber: '250', district: 'Centro',
    city: 'Campinas', state: 'sp', zipCode: '13010000',
    notes: 'Cliente mudou o e-mail do financeiro.',
  }
  const created = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify(valid) })
  check('registro criado com 201', created.status === 201, JSON.stringify(created.body))
  check('referência gerada no formato AT-AAAA-NNNNNN', /^AT-\d{4}-\d{6}$/.test(String(created.body?.reference)), String(created.body?.reference))
  const updateId = Number(created.body?.id)

  console.log('\n[2] O servidor normaliza os dados')
  const [stored] = await connection.query(
    'SELECT state, zip_code AS zipCode, cnpj, reference, status FROM client_data_updates WHERE id = ?', [updateId])
  check('UF gravada em maiúsculas', stored.state === 'SP', String(stored.state))
  check('CEP gravado com máscara', stored.zipCode === '13010-000', String(stored.zipCode))
  check('CNPJ gravado só com dígitos', stored.cnpj === '12345678000199', String(stored.cnpj))
  check('status inicial é REGISTRADA', stored.status === 'REGISTRADA', String(stored.status))

  console.log('\n[3] Validações da API')
  const semEmail = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ clientCode: '1234', companyName: 'X', phone: '1' }) })
  check('recusa atualização sem nenhum e-mail', semEmail.status === 400, String(semEmail.body?.message))
  const emailRuim = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ ...valid, clientCode: '9991', email: 'nao-e-email' }) })
  check('recusa e-mail inválido', emailRuim.status === 400, String(emailRuim.body?.message))
  const ufRuim = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ ...valid, clientCode: '9992', state: 'XYZ' }) })
  check('recusa UF inválida', ufRuim.status === 400, String(ufRuim.body?.message))
  const cepRuim = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ ...valid, clientCode: '9993', zipCode: '123' }) })
  check('recusa CEP inválido', cepRuim.status === 400, String(cepRuim.body?.message))
  const semCodigo = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ ...valid, clientCode: '', email: 'a@b.com.br' }) })
  check('recusa atualização sem código do cliente', semCodigo.status === 400, String(semCodigo.body?.message))
  const duplicada = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify(valid) })
  check('bloqueia segunda atualização pendente do mesmo cliente', duplicada.status === 409, String(duplicada.body?.message))

  console.log('\n[4] Permissões')
  const vendedorRevisa = await call(`/api/client-data-updates/${updateId}/review`, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMADA' }) }, sellerToken)
  check('vendedor não pode conferir a própria atualização', vendedorRevisa.status === 403, String(vendedorRevisa.status))
  const listaVendedor = await call('/api/client-data-updates')
  check('vendedor vê os próprios registros', Array.isArray(listaVendedor.body) && listaVendedor.body.length === 1, JSON.stringify(listaVendedor.body).slice(0, 120))
  const semAuth = await fetch(`${base}/api/client-data-updates`).then((r) => r.status)
  check('rota exige autenticação', semAuth === 401, String(semAuth))

  console.log('\n[5] Conferência da analista')
  const statusRuim = await call(`/api/client-data-updates/${updateId}/review`, { method: 'PATCH', body: JSON.stringify({ status: 'APROVADA' }) }, analystToken)
  check('recusa situação fora da lista', statusRuim.status === 400, String(statusRuim.body?.message))
  const descarteSemMotivo = await call(`/api/client-data-updates/${updateId}/review`, { method: 'PATCH', body: JSON.stringify({ status: 'DESCARTADA' }) }, analystToken)
  check('exige motivo ao descartar', descarteSemMotivo.status === 400, String(descarteSemMotivo.body?.message))
  const confirmado = await call(`/api/client-data-updates/${updateId}/review`, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMADA', reviewNotes: 'Alterado no Prático.' }) }, analystToken)
  check('analista confirma com sucesso', confirmado.status === 200, JSON.stringify(confirmado.body))
  check('resposta traz a nova situação', confirmado.body?.status === 'CONFIRMADA', String(confirmado.body?.status))
  const [revisado] = await connection.query('SELECT status, reviewed_by AS reviewedBy, review_notes AS notes FROM client_data_updates WHERE id = ?', [updateId])
  check('situação gravada como CONFIRMADA', revisado.status === 'CONFIRMADA', String(revisado.status))
  check('quem confers fica registrado', Number(revisado.reviewedBy) === analystId, String(revisado.reviewedBy))
  const segundaVez = await call(`/api/client-data-updates/${updateId}/review`, { method: 'PATCH', body: JSON.stringify({ status: 'DESCARTADA', rejectionReason: 'tente de novo' }) }, analystToken)
  check('não permite reconferir um registro já encerrado', segundaVez.status === 409, String(segundaVez.body?.message))

  console.log('\n[6] Auditoria')
  const eventos = await connection.query(
    'SELECT event_type AS eventType, request_id AS requestId, data_update_id AS dataUpdateId FROM audit_events WHERE data_update_id = ? ORDER BY id',
    [updateId]) as Array<{ eventType: string; requestId: number | null; dataUpdateId: number | null }>
  check('dois eventos gravados (registro + confirmação)', eventos.length === 2, String(eventos.length))
  check('evento de registro existe', eventos.some((e) => e.eventType === 'ATUALIZACAO_DADOS_REGISTRADA'), JSON.stringify(eventos))
  check('evento de confirmação existe', eventos.some((e) => e.eventType === 'ATUALIZACAO_DADOS_CONFIRMADA'), JSON.stringify(eventos))
  check('eventos não dependem de uma solicitação de crédito', eventos.every((e) => e.requestId === null && Number(e.dataUpdateId) === updateId), JSON.stringify(eventos))

  console.log('\n[7] Um segundo cliente pode ser registrado depois do descarte do primeiro')
  await connection.query("UPDATE client_data_updates SET status = 'DESCARTADA', reviewed_at = NOW() WHERE id = ?", [updateId])
  const depois = await call('/api/client-data-updates', { method: 'POST', body: JSON.stringify({ ...valid, clientCode: valid.clientCode, email: 'outro@cliente.com.br' }) })
  check('nova atualização do mesmo cliente é aceita após encerrar a anterior', depois.status === 201, JSON.stringify(depois.body))
  const segundoId = Number(depois.body?.id)

  // limpeza
  await connection.query('DELETE FROM audit_events WHERE data_update_id IN (?, ?)', [updateId, segundoId])
  await connection.query('DELETE FROM client_data_updates WHERE id IN (?, ?)', [updateId, segundoId])
  console.log('\n[limpeza] registros de teste removidos')
} finally {
  await connection.query('DELETE FROM users WHERE email IN (?, ?)', [sellerEmail, analystEmail])
  connection.release()
  await pool.end()
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)