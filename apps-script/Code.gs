/**
 * Pendências — API de sincronização (Google Apps Script)
 *
 * Script VINCULADO à planilha "pendencias.app" (Extensões → Apps Script).
 * Publicado como App da Web: executar como "Eu", acesso "Qualquer pessoa".
 *
 * Protocolo (somente POST, corpo JSON enviado como text/plain para evitar preflight CORS):
 *   { token, action: "pull", since }       → linhas com servidorEm > since, e serverTime
 *   { token, action: "push", ops: [...] }  → upsert por id, last-write-wins por atualizadoEm
 *
 * Nenhum segredo neste arquivo: o token fica em Propriedades do script (chave TOKEN),
 * gerado por setupToken().
 *
 * Funções para rodar no editor: setupSheets(), setupToken(), trocarToken(), testarApi().
 */

/** @OnlyCurrentDoc */

const TABELAS = {
  // aguardandoEm: acrescentada depois (planilhas antigas recebem a coluna no fim via setupSheets;
  // as colunas são localizadas pelo nome, então a posição não importa).
  pendencias: ['id', 'titulo', 'tags', 'foco', 'feito', 'feitoEm', 'prazo', 'aguardando',
    'aguardandoEm', 'ordem', 'criadoEm', 'atualizadoEm', 'excluido', 'servidorEm'],
  observacoes: ['id', 'pendenciaId', 'data', 'tipo', 'texto', 'ordem', 'atualizadoEm',
    'excluido', 'servidorEm'],
  tags: ['id', 'nome', 'cor', 'ordem', 'atualizadoEm', 'excluido', 'servidorEm'],
};
const BOOLEANOS = ['foco', 'feito', 'aguardando', 'excluido'];
const NUMEROS = ['ordem', 'atualizadoEm', 'servidorEm'];
const MAX_OPS = 500;
const MAX_TEXTO = 50000;        // limite de caracteres de uma célula do Sheets
const ESPERA_LOCK_MS = 30000;
const LIMITE_REGRAVAR_TUDO = 20; // acima disso, regrava o bloco inteiro de uma vez

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    let req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (_) {
      throw erroApi_('Corpo da requisição não é um JSON válido.');
    }
    if (!req || typeof req !== 'object') throw erroApi_('Corpo da requisição deve ser um objeto JSON.');

    validarToken_(req.token);

    if (req.action === 'pull') return responder_(comLock_(() => pull_(req)));
    if (req.action === 'push') return responder_(comLock_(() => push_(req)));
    throw erroApi_('Ação desconhecida: "' + req.action + '". Use "pull" ou "push".');
  } catch (err) {
    const msg = err && err.api ? err.message : 'Erro interno: ' + (err && err.message ? err.message : err);
    return responder_({ ok: false, erro: msg });
  }
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function erroApi_(mensagem) {
  const e = new Error(mensagem);
  e.api = true;
  return e;
}

function validarToken_(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw erroApi_('Token não configurado no servidor. Rode setupToken() no editor.');
  if (typeof token !== 'string' || !iguais_(token, esperado)) throw erroApi_('Token inválido.');
}

// Comparação em tempo constante (não revela quantos caracteres coincidem).
function iguais_(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function comLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ESPERA_LOCK_MS)) throw erroApi_('Servidor ocupado. Tente de novo em instantes.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

function pull_(req) {
  const since = Number(req.since) || 0;
  // Um milissegundo antes de "agora": uma gravação no mesmo milissegundo, logo após este pull,
  // ainda terá servidorEm > serverTime e virá no próximo pull (repetir uma linha é inofensivo).
  const serverTime = Date.now() - 1;
  const resposta = { ok: true, serverTime: serverTime };

  Object.keys(TABELAS).forEach(nome => {
    const t = lerTabela_(nome);
    resposta[nome] = t.linhas
      .filter(linha => String(linha[t.col.id]).trim() !== '')
      .map(linha => paraObjeto_(nome, t.col, linha))
      .filter(obj => obj.servidorEm > since);
  });
  return resposta;
}

function push_(req) {
  const ops = req.ops;
  if (!Array.isArray(ops)) throw erroApi_('"ops" deve ser uma lista.');
  if (ops.length > MAX_OPS) throw erroApi_('Máximo de ' + MAX_OPS + ' operações por envio.');

  const agora = Date.now();
  const abertas = {}; // nome da tabela → dados lidos + controle de escrita

  const results = ops.map(op => {
    const table = op && op.table;
    const row = op && op.row;
    const id = row && row.id;
    try {
      if (!Object.prototype.hasOwnProperty.call(TABELAS, table)) throw erroApi_('Tabela desconhecida: "' + table + '".');
      if (!row || typeof row !== 'object') throw erroApi_('Operação sem "row".');
      if (typeof id !== 'string' || !id.trim() || id.length > 64) throw erroApi_('id inválido.');
      const atualizadoEm = Number(row.atualizadoEm);
      if (!isFinite(atualizadoEm) || atualizadoEm <= 0) throw erroApi_('atualizadoEm inválido.');

      const t = abertas[table] || (abertas[table] = abrirParaEscrita_(table));
      const pos = t.indice[id];
      const atual = pos === undefined ? null : t.linhas[pos];

      // Last-write-wins: só grava se não for mais antiga que a existente.
      if (atual && lerCelula_('atualizadoEm', atual[t.col.atualizadoEm]) > atualizadoEm) {
        return { table: table, id: id, status: 'ignorado' };
      }

      const linha = atual ? atual.slice() : new Array(t.largura).fill('');
      TABELAS[table].forEach(campo => {
        if (campo === 'servidorEm') linha[t.col[campo]] = String(agora);
        else if (campo in row) linha[t.col[campo]] = escreverCelula_(campo, row[campo]);
        else if (!atual) linha[t.col[campo]] = escreverCelula_(campo, '');
        // campo ausente numa linha existente: mantém o valor atual
      });

      if (atual) {
        t.linhas[pos] = linha;
        if (pos < t.primeiraNova) t.alteradas.add(pos);
      } else {
        t.indice[id] = t.linhas.length;
        t.linhas.push(linha);
      }
      return { table: table, id: id, status: 'aplicado' };
    } catch (err) {
      return { table: table, id: id, status: 'erro', erro: err && err.message ? err.message : String(err) };
    }
  });

  Object.keys(abertas).forEach(nome => gravar_(abertas[nome]));
  SpreadsheetApp.flush();

  return { ok: true, serverTime: agora, results: results };
}

// ---------------------------------------------------------------------------
// Leitura e escrita na planilha
// ---------------------------------------------------------------------------

function lerTabela_(nome) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!sheet) throw erroApi_('Aba "' + nome + '" não encontrada. Rode setupSheets() no editor.');
  const ultimaLinha = sheet.getLastRow();
  const ultimaColuna = sheet.getLastColumn();
  if (ultimaLinha < 1 || ultimaColuna < 1) throw erroApi_('Aba "' + nome + '" sem cabeçalho. Rode setupSheets() no editor.');

  const valores = sheet.getRange(1, 1, ultimaLinha, ultimaColuna).getValues();
  const col = {};
  valores[0].forEach((titulo, i) => {
    const t = String(titulo).trim();
    if (t && !(t in col)) col[t] = i;
  });
  const faltando = TABELAS[nome].filter(c => !(c in col));
  if (faltando.length) {
    throw erroApi_('Aba "' + nome + '" sem a(s) coluna(s): ' + faltando.join(', ') + '. Rode setupSheets() no editor.');
  }
  return { sheet: sheet, col: col, largura: ultimaColuna, linhas: valores.slice(1) };
}

function abrirParaEscrita_(nome) {
  const t = lerTabela_(nome);
  t.indice = {};
  t.linhas.forEach((linha, i) => {
    const id = String(linha[t.col.id]).trim();
    if (id) t.indice[id] = i;
  });
  t.primeiraNova = t.linhas.length; // posições a partir daqui são linhas novas
  t.alteradas = new Set();
  return t;
}

function gravar_(t) {
  // Posição p em t.linhas corresponde à linha p + 2 da aba (linha 1 é o cabeçalho).
  if (t.alteradas.size > LIMITE_REGRAVAR_TUDO) {
    t.sheet.getRange(2, 1, t.primeiraNova, t.largura).setValues(t.linhas.slice(0, t.primeiraNova));
  } else {
    t.alteradas.forEach(pos => t.sheet.getRange(pos + 2, 1, 1, t.largura).setValues([t.linhas[pos]]));
  }

  const novas = t.linhas.slice(t.primeiraNova);
  if (!novas.length) return;
  const inicio = t.primeiraNova + 2;
  const faltam = inicio + novas.length - 1 - t.sheet.getMaxRows();
  if (faltam > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), faltam);
  t.sheet.getRange(inicio, 1, novas.length, t.largura).setNumberFormat('@').setValues(novas);
}

function paraObjeto_(nome, col, linha) {
  const obj = {};
  TABELAS[nome].forEach(campo => { obj[campo] = lerCelula_(campo, linha[col[campo]]); });
  return obj;
}

function lerCelula_(campo, v) {
  if (BOOLEANOS.indexOf(campo) >= 0) return v === true || String(v).trim().toUpperCase() === 'TRUE';
  if (NUMEROS.indexOf(campo) >= 0) {
    const n = Number(v);
    return v === '' || v == null || !isFinite(n) ? 0 : n;
  }
  if (v instanceof Date) return v.toISOString(); // célula editada à mão e convertida pelo Sheets
  const s = v == null ? '' : String(v);
  return s.indexOf("'=") === 0 ? s.slice(1) : s;
}

function escreverCelula_(campo, v) {
  if (BOOLEANOS.indexOf(campo) >= 0) {
    return v === true || String(v).trim().toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  }
  if (NUMEROS.indexOf(campo) >= 0) {
    const n = Number(v);
    return v === '' || v == null || !isFinite(n) ? '' : String(n);
  }
  if (campo === 'tags' && Array.isArray(v)) v = v.join(';');
  let s = v == null ? '' : String(v);
  if (s.length > MAX_TEXTO) throw erroApi_('Campo "' + campo + '" passa de ' + MAX_TEXTO + ' caracteres.');
  if (s.charAt(0) === '=') s = "'" + s; // impede o Sheets de interpretar o texto como fórmula
  return s;
}

// ---------------------------------------------------------------------------
// Instalação (rodar no editor)
// ---------------------------------------------------------------------------

/**
 * Cria as abas pendencias / observacoes / tags e os cabeçalhos, se não existirem.
 * Pode ser rodada de novo sem risco: só acrescenta o que falta (ex.: a coluna servidorEm)
 * e nunca apaga dados.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABELAS).forEach(nome => {
    const colunas = TABELAS[nome];
    const sheet = ss.getSheetByName(nome) || ss.insertSheet(nome);

    const ultimaColuna = sheet.getLastColumn();
    const existentes = ultimaColuna
      ? sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0].map(v => String(v).trim())
      : [];
    const faltando = colunas.filter(c => existentes.indexOf(c) < 0);
    if (faltando.length) sheet.getRange(1, ultimaColuna + 1, 1, faltando.length).setValues([faltando]);

    const largura = sheet.getLastColumn();
    sheet.getRange(1, 1, sheet.getMaxRows(), largura).setNumberFormat('@'); // texto puro
    sheet.getRange(1, 1, 1, largura).setFontWeight('bold');
    sheet.setFrozenRows(1);

    Logger.log('Aba "' + nome + '": ' + (faltando.length ? 'colunas criadas: ' + faltando.join(', ') : 'já estava completa') + '.');
  });
  Logger.log('Pronto. Se houver uma aba vazia padrão (ex.: "Página1"), pode apagá-la.');
}

/**
 * Gera o token secreto e guarda em Propriedades do script (chave TOKEN).
 * O token aparece no Registro de execução: copie e guarde no seu gerenciador de senhas.
 * Se já existir um token, NÃO troca (para trocar, rode trocarToken()).
 * Para ver o token depois: Configurações do projeto (engrenagem) → Propriedades do script.
 */
function setupToken() {
  if (PropertiesService.getScriptProperties().getProperty('TOKEN')) {
    Logger.log('Já existe um token; ele NÃO foi alterado. Veja em Configurações do projeto → ' +
      'Propriedades do script. Para gerar outro, rode trocarToken().');
    return;
  }
  trocarToken();
}

/**
 * Gera um token novo (64 caracteres hexadecimais, ~244 bits aleatórios) e substitui o atual.
 * Depois de trocar, atualize o token em Configurações do app em cada aparelho.
 */
function trocarToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('Novo token (copie e guarde no gerenciador de senhas):\n' + token);
}

/**
 * Teste de ponta a ponta da API, rodando doPost() aqui mesmo no editor.
 * Grava uma tag de teste com excluido=TRUE (o app a ignora; pode apagar a linha à mão).
 */
function testarApi() {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token) throw new Error('Rode setupToken() antes.');

  const chamar = corpo => JSON.parse(doPost({ postData: { contents: corpo } }).getContent());
  const json = obj => JSON.stringify(obj);
  const conferir = (condicao, descricao, r) => {
    if (!condicao) throw new Error('FALHOU: ' + descricao + '\nResposta: ' + JSON.stringify(r));
    Logger.log('✓ ' + descricao);
  };
  let r;

  r = chamar(json({ token: 'token-errado', action: 'pull', since: 0 }));
  conferir(r.ok === false && r.erro === 'Token inválido.', 'token inválido é recusado', r);

  r = chamar(json({ action: 'pull', since: 0 }));
  conferir(r.ok === false && r.erro === 'Token inválido.', 'requisição sem token é recusada', r);

  r = chamar('isto não é json');
  conferir(r.ok === false, 'corpo que não é JSON é recusado', r);

  r = chamar(json({ token: token, action: 'apagarTudo' }));
  conferir(r.ok === false, 'ação desconhecida é recusada', r);

  const id = 'teste-' + Utilities.getUuid();
  const agora = Date.now();
  const tag = { id: id, nome: 'teste da API', cor: 'c1', ordem: 0, atualizadoEm: agora, excluido: true };
  const push = row => chamar(json({ token: token, action: 'push', ops: [{ table: 'tags', row: row }] }));

  r = push(tag);
  conferir(r.ok && r.results[0].status === 'aplicado', 'push grava linha nova', r);

  r = push(Object.assign({}, tag, { nome: 'versão antiga', atualizadoEm: agora - 1000 }));
  conferir(r.ok && r.results[0].status === 'ignorado', 'push mais antigo é ignorado (last-write-wins)', r);

  r = push(Object.assign({}, tag, { nome: 'teste da API (editado)', atualizadoEm: agora + 1 }));
  conferir(r.ok && r.results[0].status === 'aplicado', 'push mais novo atualiza a linha', r);

  r = chamar(json({ token: token, action: 'push', ops: [{ table: 'naoExiste', row: { id: 'x', atualizadoEm: 1 } }] }));
  conferir(r.ok && r.results[0].status === 'erro', 'op com tabela desconhecida volta como erro (sem derrubar o envio)', r);

  r = chamar(json({ token: token, action: 'pull', since: agora - 60000 }));
  const achada = r.ok && r.tags.filter(t => t.id === id)[0];
  conferir(achada && achada.nome === 'teste da API (editado)' && achada.excluido === true,
    'pull devolve a versão mais nova, com tipos corretos', r);

  r = chamar(json({ token: token, action: 'pull', since: r.serverTime }));
  conferir(r.ok && !r.tags.some(t => t.id === id), 'pull desde o último serverTime não repete a linha', r);

  Logger.log('Todos os testes passaram. A tag de teste "' + id + '" ficou na aba "tags" com ' +
    'excluido=TRUE (pode apagar a linha à mão).');
}
