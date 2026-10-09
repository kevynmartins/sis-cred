// Deixa um registro de exemplo na fila da atualização de dados para você ver a tela
// da analista preenchida. Usa as contas de desenvolvimento (senha admin123) e um
// cliente fictício — some com os registros ao final.
import 'dotenv/config'
import mariadb from 'mariadb'

const base = 'http://127.0.0.1:3001'
const pool = mariadb.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  connectionLimit: 2, acquireTimeout: 10000,
})

const login = async (email: string) => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'admin123' }),
  })
  const body = await response.json().catch(() => null) as { token?: string; message?: string }
  if (!response.ok || !body?.token) throw new Error(`login de ${email} falhou: ${body?.message}`)
  return body.token
}

const api = async (path: string, token: string, options: RequestInit = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  })
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> }
}

const sellerToken = await login('andre.martins@empresa.com.br')
const created: number[] = []

const exemplos = [
  {
    clientCode: '258912', companyName: 'Distribuidora Exemplo Ltda', cnpj: '12345678000199',
    email: 'financeiro@exemplo.com.br', invoiceEmail: 'fiscal@exemplo.com.br',
    financeEmail: 'contas@exemplo.com.br', contactName: 'Roberto Almeida',
    phone: '(11) 3255-8800', phoneMobile: '(11) 99811-4477',
    street: 'Av. das Nações', streetNumber: '1250', streetComplement: 'Galpão 3',
    district: 'Jardim Industrial', city: 'São Paulo', state: 'SP', zipCode: '04795000',
    notes: 'Cliente trocou o e-mail do financeiro e mudou para o galpão novo. O limite de crédito continua o mesmo.',
  },
  {
    clientCode: '314507', companyName: 'Comércio Exemplo ME', cnpj: '98765432000188',
    email: 'compras@exemplo.com.br', contactName: 'Ana Beatriz',
    phone: '(41) 3022-1199',
    street: 'Rua das Acácias', streetNumber: '340', district: 'Centro',
    city: 'Curitiba', state: 'PR', zipCode: '80010200',
    notes: 'E-mail anterior estava devolvendo, por favor corrigir.',
  },
]

for (const exemplo of exemplos) {
  const result = await api('/api/client-data-updates', sellerToken, { method: 'POST', body: JSON.stringify(exemplo) })
  if (result.status !== 201) {
    console.log(`  falhou: ${JSON.stringify(result.body)}`)
    continue
  }
  created.push(Number(result.body.id))
  console.log(`  ${result.body.reference} — ${exemplo.companyName}`)
}

console.log(`\n${created.length} registro(s) de exemplo na fila da analista.`)
console.log('Para remover depois:')
console.log(created.length ? `  DELETE FROM audit_events WHERE data_update_id IN (${created.join(',')}); DELETE FROM client_data_updates WHERE id IN (${created.join(',')});` : '  (nada a remover)')
await pool.end()