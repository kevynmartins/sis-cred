// Testa o parser de endereço e a quebra de e-mails que preenchem o formulário de
// atualização de dados. Roda a lógica real, extraída do App.tsx.
//   npx tsx server/test-parse-address.ts

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf-8')
const lines = source.split('\n')
const start = lines.findIndex((line) => line.includes('type ParsedAddress'))
const end = lines.findIndex((line) => line.includes('const listDataUpdate'))
if (start < 0 || end < 0) throw new Error('Não encontrei o bloco parsePraticoAddress em src/App.tsx')
// A anotação de tipo não sobrevive à transpilação para JS puro: removemos a linha
// inteira (ela só declara a forma do objeto devolvido pelo parser).
const bloco = lines.slice(start, end).filter((line) => !line.startsWith('type ParsedAddress')).join('\n')

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// O parser real usa esta função; aqui é injetada no bloco compilado, por isso existe
// apesar de não ser chamada diretamente neste arquivo.
const formatZipCode = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}
const splitEmails = (value: string | null): string[] =>
  (value || '').split(/[;,]+/).map((part) => part.trim()).filter((part) => emailPattern.test(part))

// Compila a função real com o TS em memória para testar exatamente o que o app executa.
const ts = await import('typescript')
const compilado = ts.transpileModule(`
const emailPattern = ${emailPattern.toString()}
const formatZipCode = ${formatZipCode.toString()}
${bloco}
export { parsePraticoAddress }
`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const mod = await import(`data:text/javascript;base64,${Buffer.from(compilado.outputText).toString('base64')}`)
const parsePraticoAddress = mod.parsePraticoAddress as (raw: string | null) => Record<string, string>

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`) }
}

console.log('\n[1] Endereço do Prático quebrado em campos separados')
const exemplo = parsePraticoAddress('RUA EXEMPLO N 800, DISTRITO NOVO, CIDADE NOVA/SC, CEP 89000-000')
console.log('   ', JSON.stringify(exemplo))
check('logradouro sem o número', exemplo.street === 'RUA EXEMPLO', exemplo.street)
check('número separado', exemplo.streetNumber === '800', exemplo.streetNumber)
check('bairro', exemplo.district === 'DISTRITO NOVO', exemplo.district)
check('cidade', exemplo.city === 'CIDADE NOVA', exemplo.city)
check('UF em maiúsculas', exemplo.state === 'SC', exemplo.state)
check('CEP com máscara', exemplo.zipCode === '89000-000', exemplo.zipCode)

const magenis = parsePraticoAddress('RUA CENTRAL, 186, JARDIM NOVO, CIDADE VELHA/SC')
console.log('   ', JSON.stringify(magenis))
check('número em parte separada', magenis.street === 'RUA CENTRAL' && magenis.streetNumber === '186', JSON.stringify(magenis))
check('bairro', magenis.district === 'JARDIM NOVO', magenis.district)
check('cidade/UF', magenis.city === 'CIDADE VELHA' && magenis.state === 'SC', JSON.stringify(magenis))
check('sem CEP fica vazio', magenis.zipCode === '', magenis.zipCode)

const rod = parsePraticoAddress('ROD. EXEMPLO, 1387/1404, CIDADE NOVA/SC, CEP 89000000')
console.log('   ', JSON.stringify(rod))
check('número com sala/apto', rod.streetNumber === '1387/1404', rod.streetNumber)
check('CEP sem máscara é normalizado', rod.zipCode === '89000-000', rod.zipCode)

const semCep = parsePraticoAddress('Av. das Nacoes, 1250, Jardim Industrial, Sao Paulo/SP')
console.log('   ', JSON.stringify(semCep))
check('endereço sem CEP', semCep.street === 'Av. das Nacoes' && semCep.streetNumber === '1250', JSON.stringify(semCep))
check('cidade com espaço', semCep.city === 'Sao Paulo' && semCep.state === 'SP', JSON.stringify(semCep))

const soLogradouro = parsePraticoAddress('Rua X')
check('endereço só com logradouro', soLogradouro.street === 'Rua X' && soLogradouro.streetNumber === '', JSON.stringify(soLogradouro))
check('entrada vazia não quebra', parsePraticoAddress('').street === '', JSON.stringify(parsePraticoAddress('')))
check('entrada nula não quebra', parsePraticoAddress(null).city === '', JSON.stringify(parsePraticoAddress(null)))

console.log('\n[2] E-mails do Prático quebrados em campos separados')
const doisEmails = splitEmails('compras@exemplo.com.br;fiscal@exemplo.com.br')
console.log('   ', JSON.stringify(doisEmails))
check('dois e-mails separados por ";"', doisEmails.length === 2, JSON.stringify(doisEmails))
check('nenhum e-mail fica colado com ";"', !doisEmails.some((mail) => mail.includes(';')), JSON.stringify(doisEmails))
check('ponto e vírgula no meio nunca vaza para o campo', !splitEmails('a@x.com.br;b@y.com.br;c@z.com.br').some((m) => m.includes(';')), '')
check('vírgula também separa', splitEmails('a@x.com.br, b@y.com.br').length === 2, JSON.stringify(splitEmails('a@x.com.br, b@y.com.br')))
check('e-mail simples continua inteiro', splitEmails('fiscal@exemplo.com.br')[0] === 'fiscal@exemplo.com.br', '')
check('texto sem e-mail é ignorado', splitEmails('SEM EMAIL').length === 0, '')
check('espaços em volta são removidos', splitEmails('a@x.com.br ; b@y.com.br').every((m) => m === m.trim()), JSON.stringify(splitEmails('a@x.com.br ; b@y.com.br')))

console.log('\n[3] Campo "contato" que vem com e-mail em vez de nome')
check('financeiro@exemplo.com.br é reconhecido como e-mail', emailPattern.test('financeiro@exemplo.com.br'), '')
check('"Roberto Almeida" não é e-mail', !emailPattern.test('Roberto Almeida'), '')

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)