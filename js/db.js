// Wrapper mínimo de IndexedDB, com promessas.

const NOME = 'pendencias';
const VERSAO = 1;

let conexao;

const promessa = req => new Promise((ok, falha) => {
  req.onsuccess = () => ok(req.result);
  req.onerror = () => falha(req.error);
});

export function abrir() {
  if (conexao) return conexao;
  const req = indexedDB.open(NOME, VERSAO);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('pendencias', { keyPath: 'id' });
    db.createObjectStore('observacoes', { keyPath: 'id' }).createIndex('pendenciaId', 'pendenciaId');
    db.createObjectStore('tags', { keyPath: 'id' });
    db.createObjectStore('outbox', { keyPath: 'key' });
    db.createObjectStore('meta', { keyPath: 'key' });
  };
  conexao = promessa(req);
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

// Apaga tudo deste aparelho: as três tabelas, a outbox e os metadados (lastSync).
export async function limparTudo() {
  const db = await abrir();
  const stores = ['pendencias', 'observacoes', 'tags', 'outbox', 'meta'];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
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
