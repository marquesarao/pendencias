// Wrapper mínimo de IndexedDB, com promessas.

const NOME = 'pendencias';
// v1: pendencias, observacoes, tags, outbox, meta.
// v2: + comentarios. A atualização só CRIA o que falta — nunca apaga nem reescreve as outras stores.
const VERSAO = 2;
const STORES = ['pendencias', 'observacoes', 'tags', 'comentarios', 'outbox', 'meta'];

let conexao;

const promessa = req => new Promise((ok, falha) => {
  req.onsuccess = () => ok(req.result);
  req.onerror = () => falha(req.error);
});

export function abrir() {
  if (conexao) return conexao;
  const req = indexedDB.open(NOME, VERSAO);
  req.onupgradeneeded = e => {
    const db = req.result;
    const criar = (nome, keyPath) => {
      if (!db.objectStoreNames.contains(nome)) return db.createObjectStore(nome, { keyPath });
      return null;
    };
    criar('pendencias', 'id');
    criar('observacoes', 'id')?.createIndex('pendenciaId', 'pendenciaId');
    criar('tags', 'id');
    criar('outbox', 'key');
    criar('meta', 'key');
    criar('comentarios', 'id')?.createIndex('pendenciaId', 'pendenciaId');
    // Vindo da v1: este aparelho nunca guardou comentários, mas o cursor (lastSync) pode já ter
    // passado por comentários gravados na planilha por outro aparelho. Zerar o cursor faz o
    // próximo pull trazer tudo uma vez (o last-write-wins torna a repetição inofensiva).
    if (e.oldVersion >= 1 && e.oldVersion < 2) {
      req.transaction.objectStore('meta').put({ key: 'lastSync', value: 0 });
    }
  };
  // Outra aba ainda na versão antiga segura o banco: a atualização espera ela fechar.
  req.onblocked = () => {
    console.warn('[Pendências] Atualização do banco aguardando outra aba fechar.');
    window.dispatchEvent(new CustomEvent('pend-banco-bloqueado'));
  };
  conexao = promessa(req).then(db => {
    // Uma versão mais nova do app (outra aba) quer atualizar o banco: solta e recarrega.
    db.onversionchange = () => { db.close(); location.reload(); };
    return db;
  });
  return conexao;
}

export async function todos(store) {
  const db = await abrir();
  return promessa(db.transaction(store).objectStore(store).getAll());
}

export async function obterMeta(key) {
  const db = await abrir();
  const r = await promessa(db.transaction('meta').objectStore('meta').get(key));
  return r ? r.value : undefined;
}

export async function gravarMeta(key, value) {
  return gravar([['meta', { key, value }]]);
}

const concluir = tx => new Promise((ok, falha) => {
  tx.oncomplete = () => ok();
  tx.onerror = () => falha(tx.error);
  tx.onabort = () => falha(tx.error);
});

/**
 * Tira da outbox as entradas confirmadas pelo servidor — mas só as que não mudaram durante o
 * envio (mesmo atualizadoEm). Uma edição feita no meio do caminho continua na fila.
 * @param {Array<{key: string, atualizadoEm: number}>} confirmadas
 * @returns {Promise<string[]>} chaves efetivamente removidas
 */
export async function removerDaOutbox(confirmadas) {
  const db = await abrir();
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  const removidas = [];
  for (const { key, atualizadoEm } of confirmadas) {
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result && req.result.row.atualizadoEm === atualizadoEm) {
        store.delete(key);
        removidas.push(key);
      }
    };
  }
  await concluir(tx);
  return removidas;
}

// Apaga tudo deste aparelho: as tabelas, a outbox e os metadados (lastSync).
export async function limparTudo() {
  const db = await abrir();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return concluir(tx);
}

/**
 * Grava várias linhas numa única transação (tudo ou nada).
 * @param {Array<[string, object]>} pares [nomeDaStore, valor]
 */
export async function gravar(pares) {
  const db = await abrir();
  const stores = [...new Set(pares.map(p => p[0]))];
  const tx = db.transaction(stores, 'readwrite');
  for (const [store, valor] of pares) tx.objectStore(store).put(valor);
  return concluir(tx);
}

// Remove chaves da outbox incondicionalmente (entrada superada por uma versão remota mais nova).
export async function descartarDaOutbox(chaves) {
  if (!chaves.length) return;
  const db = await abrir();
  const tx = db.transaction('outbox', 'readwrite');
  for (const k of chaves) tx.objectStore('outbox').delete(k);
  return concluir(tx);
}
