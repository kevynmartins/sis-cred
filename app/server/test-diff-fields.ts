// Testa a comparação campo a campo que destaca em vermelho o que difere do Prático.
// Usa os dados reais do cliente 269 (INDUSTRIA EXEMPLO SA) e o registro de exemplo.
//   npx tsx server/test-diff-fields.ts
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const lines = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf-8').split('\n')
const start = lines.findIndex((line) => line.includes('type DataUpdateField'))
const end = lines.findIndex((line) => line.includes('const listDataUpdate ='))
if (start < 0 || end < 0) throw new Error('Não encontrei o bloco dataUpdateFieldsOf em src/App.tsx')
const bloco = lines.slice(start, end)
  .filter((line) => !line.startsWith('type DataUpdateField'))
  .join('\n')
  .replace('export function', 'function')

const ts = await import('typescript')
const compilado = ts.transpileModule(`
${bloco}
export { dataUpdateFieldsOf, dataUpdateChangeCount, dataUpdateGroupOrder }
`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const mod = await import(`data:text/javascript;base64,${Buffer.from(compilado.outputText).toString('base64')}`)
const dataUpdateFieldsOf = mod.dataUpdateFieldsOf as (item: Record<string, unknown>, current: Record<string, unknown> | null) => Array<{ key: string; label: string; group: string; pedido: string | null; atual: string; difere: boolean }>
const dataUpdateChangeCount = mod.dataUpdateChangeCount as (fields: Array<{ difere: boolean }>) => number
const dataUpdateGroupOrder = mod.dataUpdateGroupOrder as string[]

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\n[1] Registro do Exemplo contra o Prático (mesmos dados)')
const registro = {
  clientCode: '269', companyName: 'INDUSTRIA EXEMPLO SA',
  contactName: null, phone: '4834000000', phoneMobile: '4834000001',
  email: 'compras@exemplo.com.br', invoiceEmail: 'fiscal@exemplo.com.br',
  financeEmail: 'financeiro@exemplo.com.br',
  street: 'RUA EXEMPLO', streetNumber: '800', streetComplement: null,
  district: 'DISTRITO NOVO', city: 'CIDADE NOVA', state: 'SC', zipCode: '89000-000',
}
// O Prático grava o número DENTRO do logradouro — é esse o caso real do cliente 269.
const igual = {
  contactName: 'financeiro@exemplo.com.br', phones: ['4834000000', '4834000001'],
  email: 'compras@exemplo.com.br;fiscal@exemplo.com.br',
  street: 'RUA EXEMPLO N 800', district: 'DISTRITO NOVO', city: 'CIDADE NOVA', state: 'SC', zipCode: '89000-000',
}
const camposIguais = dataUpdateFieldsOf(registro, igual)
console.log('   ', camposIguais.filter((row) => row.difere).map((row) => row.key).join(', ') || '(nenhuma diferença)')
check('e-mail diferente do campo único do Prático é marcado', camposIguais.find((row) => row.key === 'invoiceEmail')?.difere === true, 'deveria diferir: o Prático guarda os dois juntos')
check('telefone igual (mesmo número) não é marcado', camposIguais.find((row) => row.key === 'phone')?.difere === false, '')
check('celular igual não é marcado', camposIguais.find((row) => row.key === 'phoneMobile')?.difere === false, '')
check('endereço igual não é marcado', camposIguais.find((row) => row.key === 'city')?.difere === false, '')
check('logradouro com número embutido no Prático NÃO é marcado à toa', camposIguais.find((row) => row.key === 'street')?.difere === false, 'o Prático tem "RUA EXEMPLO N 800" e o pedido é "RUA EXEMPLO" + 800')
check('número extraído do logradouro do Prático NÃO é marcado', camposIguais.find((row) => row.key === 'streetNumber')?.difere === false, '800 == 800')

console.log('\n[2] Número/complemento: casos reais do Prático')
const comNumeroEmbutido = dataUpdateFieldsOf(
  { ...registro, street: 'ROD. EXEMPLO', streetNumber: '1387', streetComplement: '1404' },
  { ...igual, street: 'ROD. EXEMPLO, 1387/1404' },
)
check('logradouro igual com 1387/1404 embutido não é marcado', comNumeroEmbutido.find((row) => row.key === 'street')?.difere === false, '')
check('número 1387 bate com o que está embutido', comNumeroEmbutido.find((row) => row.key === 'streetNumber')?.difere === false, '')
check('complemento 1404 bate com o que está embutido', comNumeroEmbutido.find((row) => row.key === 'streetComplement')?.difere === false, '')

const numeroDiferente = dataUpdateFieldsOf(
  { ...registro, street: 'RUA EXEMPLO', streetNumber: '801' },
  igual,
)
check('número realmente diferente (801 vs 800) É marcado', numeroDiferente.find((row) => row.key === 'streetNumber')?.difere === true, '')
check('logradouro com número diferente É marcado', numeroDiferente.find((row) => row.key === 'street')?.difere === true, '')

const ruaMudou = dataUpdateFieldsOf(
  { ...registro, street: 'RUA OUTRA LUGAR', streetNumber: '800' },
  igual,
)
check('logradouro diferente com mesmo número É marcado', ruaMudou.find((row) => row.key === 'street')?.difere === true, '')

const numeroSoNoFormulario = dataUpdateFieldsOf(
  { ...registro, street: 'AV. DAS NACOES', streetNumber: '1250' },
  { ...igual, street: 'AV. DAS NACOES' },
)
check('número que não está no Prático e logradouro igual: não é alteração', numeroSoNoFormulario.find((row) => row.key === 'street')?.difere === false, '')
check('número que só existe no formulário ainda é alteração a fazer', numeroSoNoFormulario.find((row) => row.key === 'streetNumber')?.difere === true, 'o Prático não traz número nenhum nessa rua')

const caixaEEspacos = dataUpdateFieldsOf(
  { ...registro, street: 'r. exemplo', streetNumber: '0800' },
  igual,
)
check('caixa e espaços diferentes não viram alteração', caixaEEspacos.find((row) => row.key === 'street')?.difere === false, '')
check('número com zero à esquerda bate', caixaEEspacos.find((row) => row.key === 'streetNumber')?.difere === false, '')

console.log('\n[3] Formatação diferente não deve virar diferença')
const comMascara = { ...registro, phone: '(48) 3400-0000', zipCode: '89000000' }
const camposMascara = dataUpdateFieldsOf(comMascara, igual)
check('telefone com máscara é visto como igual', camposMascara.find((row) => row.key === 'phone')?.difere === false, '')
check('CEP sem máscara é visto como igual', camposMascara.find((row) => row.key === 'zipCode')?.difere === false, '')
const caixaDiferente = dataUpdateFieldsOf({ ...registro, city: 'Nova Venezia' }, igual)
check('cidade com caixa diferente é marcada', caixaDiferente.find((row) => row.key === 'city')?.difere === true, '')

console.log('\n[4] Valor novo em campo vazio é diferença')
const vazio = { contactName: null, phones: [], email: null, street: null, district: null, city: null, state: null, zipCode: null }
const camposVazio = dataUpdateFieldsOf(registro, vazio)
check('e-mail novo (Prático vazio) é marcado', camposVazio.find((row) => row.key === 'email')?.difere === true, '')
check('logradouro novo é marcado', camposVazio.find((row) => row.key === 'street')?.difere === true, '')
// 13 campos no total: contato(1) + telefones(2) + e-mails(3) + endereço(7).
// O registro do Exemplo deixa "contato" e "complemento" vazios — 11 preenchidos.
check('todo campo preenchido conta como alteração', dataUpdateChangeCount(camposVazio) === 11, String(dataUpdateChangeCount(camposVazio)))
check('campos vazios não contam como alteração',
  !dataUpdateFieldsOf(registro, vazio).find((row) => row.key === 'contactName')?.difere
  && !dataUpdateFieldsOf(registro, vazio).find((row) => row.key === 'streetComplement')?.difere, '')

console.log('\n[5] Registro sem a leitura do Prático (tela do vendedor)')
const camposSemAtual = dataUpdateFieldsOf(registro, null)
check('com current=null todo campo preenchido aparece como enviado', dataUpdateChangeCount(camposSemAtual) === 11, String(dataUpdateChangeCount(camposSemAtual)))
const soUm = dataUpdateFieldsOf({ email: 'a@b.com.br' }, null)
check('campo não preenchido não é contado', soUm.length === 13 && dataUpdateChangeCount(soUm) === 1, `${soUm.length} campos, ${dataUpdateChangeCount(soUm)} preenchido`)
// A tela do vendedor filtra por grupo os que têm campo preenchido, então o grupo
// "Contato" some do registro do Exemplo (contato vazio) — o resto mantém a ordem.
check('grupos na ordem: Contato, Telefones, E-mails, Endereço',
  JSON.stringify([...new Set(camposSemAtual.map((row) => row.group))]) === JSON.stringify(['Contato', 'Telefones', 'E-mails', 'Endereço']),
  JSON.stringify([...new Set(camposSemAtual.map((row) => row.group))]))
check('grupo Contato não aparece na lista quando o contato está vazio',
  dataUpdateGroupOrder.filter((group) => dataUpdateFieldsOf(registro, null).some((row) => row.group === group && row.pedido)).length === 3,
  JSON.stringify(dataUpdateGroupOrder.filter((group) => dataUpdateFieldsOf(registro, null).some((row) => row.group === group && row.pedido))))

console.log('\n[6] Campos com rótulo e agrupamento')
const rotulos = dataUpdateFieldsOf(registro, null)
check('todo campo tem rótulo legível', rotulos.every((row) => row.label && row.group), '')
check('total de campos conhecidos é 13 (contato, 2 telefones, 3 e-mails, 7 de endereço)', rotulos.length === 13, String(rotulos.length))
check('cada grupo tem os campos esperados',
  JSON.stringify(['Contato', 'Telefones', 'E-mails', 'Endereço'].map((group) => rotulos.filter((row) => row.group === group).length)) === JSON.stringify([1, 2, 3, 7]),
  JSON.stringify(['Contato', 'Telefones', 'E-mails', 'Endereço'].map((group) => rotulos.filter((row) => row.group === group).length)))

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)