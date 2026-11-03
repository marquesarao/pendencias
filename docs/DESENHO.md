# Pendências — Desenho (fonte da verdade)

> Este documento descreve o que o app faz e como. Se algo mudar durante as fatias, ele é
> atualizado junto com o código. Histórico de alterações no fim.

## 0. Princípios

- PWA offline-first, HTML + CSS + JS puro (ES modules), sem frameworks e sem build.
- Hospedagem: GitHub Pages (`marquesarao/pendencias`, público). API: Google Apps Script vinculado
  à planilha `pendencias.app`.
- Nenhum segredo no repositório. URL do Web App e token ficam só no `localStorage` do aparelho.
- Interface em PT-BR. Uma fonte web local (Manrope variável, woff2, OFL).
- Pasta local: `C:\Users\leand\OneDrive\Desktop\IA\APP Pendências`.

## 1. Árvore de arquivos

```
index.html               casca única: cabeçalho, captura, chips, seções, painéis
manifest.webmanifest     (fatia 5)
sw.js                    (fatia 5)
css/app.css              tokens (:root claro/escuro), base, componentes, animações
js/app.js                inicialização, estado em memória, render, atalhos
js/db.js                 wrapper mínimo de IndexedDB
js/store.js              ações de domínio: grava local + enfileira na outbox
js/sync.js               (fatia 4) push/pull, LWW, status, agendamento
js/util.js               uuid, datas, normalização de texto, ordem fracionária
js/parse.js              captura "tag: texto", observação "ok …"
js/ui/list.js            seções Em foco / Todas, agrupamento, estados vazios
js/ui/row.js             linha compacta + expansão inline
js/ui/chips.js           chips de filtro com contagem
js/ui/drag.js            reordenação com Pointer Events (mouse e toque)
js/ui/panels.js          gaveta/folha: Concluídas, Tags, Configurações
js/ui/search.js          busca rápida
js/ui/toast.js           avisos discretos com ação
js/ui/dom.js             helpers de DOM: h(), ícones, reconciliação sem perder foco, realce de busca
js/resumo-dados.js       cálculos do Resumo/Relatório (sem DOM)
js/ui/resumo.js          painel Resumo (abas Resumo e Relatório)
js/pwa.js                service worker, aviso de nova versão, instalação
js/rascunhos.js          rascunho do comentário por item (localStorage, gravado a cada 0,4 s)
js/ui/comentarios.js     comentários: texto com links (sem innerHTML), datas, lista só leitura
fonts/manrope-var.woff2, fonts/OFL.txt
icons/icon.svg, icon-192.png, icon-512.png, maskable-512.png
tools/                   (fatia 5) geração dos PNGs a partir do SVG — fora do app
apps-script/Code.gs      API (colado manualmente no editor do Apps Script)
docs/DESENHO.md          este documento
README.md, .gitignore
```

## 2. Planilha (linha 1 = cabeçalho)

| Aba | Colunas |
|---|---|
| `pendencias` | id, titulo, tags, foco, feito, feitoEm, prazo, aguardando, **aguardandoEm**, ordem, criadoEm, atualizadoEm, excluido, **servidorEm** |
| `observacoes` | id, pendenciaId, data, tipo, texto, ordem, atualizadoEm, excluido, **servidorEm** |
| `tags` | id, nome, cor, ordem, atualizadoEm, excluido, **servidorEm** |
| `comentarios` | id, pendenciaId, **criadoEm**, texto, **editadoEm**, atualizadoEm, excluido, servidorEm |

- `id`: UUID gerado no app. `tags`: ids separados por `;` (ordem importa; a 1ª é a principal).
- `foco/feito/aguardando/excluido`: `TRUE`/`FALSE`.
- `feitoEm`, `criadoEm`, `data`, `editadoEm`: ISO 8601 completo (UTC). `prazo`: só data (`AAAA-MM-DD`).
- Comentário: `criadoEm` é **imutável** (o app nunca o reescreve); `editadoEm` vazio = nunca
  editado, preenchido só quando o texto muda de fato (excluir/desfazer não conta). `texto` guarda
  as quebras de linha; até 50.000 caracteres (limite da célula).
- `atualizadoEm`: epoch ms, **definido pelo app** (base do last-write-wins).
- `servidorEm`: epoch ms, **carimbado pelo servidor** a cada gravação (base do pull incremental).
- `tipo` (observação): `ok` ou `falta`. `cor` (tag): `c1`…`c8`.
- Exclusão sempre lógica (`excluido=TRUE`).
- Todas as colunas formatadas como texto puro (`@`) para o Sheets não converter datas/números.
  O script converte por esquema ao ler e ao gravar. Texto iniciado por `=` é gravado com `'`
  na frente (para não virar fórmula) e o `'` é removido na leitura.
- O script lê o cabeçalho e localiza as colunas por nome (colunas extras são toleradas).

## 3. Modelo de dados local (IndexedDB `pendencias`, versão 2)

Tudo é carregado em memória ao abrir; a tela renderiza da memória; cada ação grava no
IndexedDB imediatamente.

| Store | Chave | Conteúdo |
|---|---|---|
| `pendencias` | `id` | `{id, titulo, tags:[id…], foco, feito, feitoEm, prazo, aguardando, aguardandoEm, ordem, criadoEm, atualizadoEm, excluido}` |
| `observacoes` | `id` (índice `pendenciaId`) | `{id, pendenciaId, data, tipo, texto, ordem, atualizadoEm, excluido}` |
| `tags` | `id` | `{id, nome, cor, ordem, atualizadoEm, excluido}` |
| `comentarios` | `id` (índice `pendenciaId`) | `{id, pendenciaId, criadoEm, texto, editadoEm, atualizadoEm, excluido}` |
| `outbox` | `"tabela:id"` | `{table, row}` — foto completa e mais recente da linha |
| `meta` | `key` | `lastSync` |

- **Versão 1 → 2 (cache v8):** a atualização só **cria** a store `comentarios` (nunca apaga nem
  reescreve as outras) e zera `lastSync` uma vez: o próximo pull traz tudo, para um aparelho que
  passou um tempo na v7 receber comentários escritos por outro aparelho nesse meio-tempo (o
  last-write-wins torna a repetição inofensiva). A fila (outbox) é preservada. Outra aba aberta na
  versão antiga segura a atualização → aviso "Há outra aba do Pendências aberta…". Uma aba v8
  que recebe `versionchange` (versão futura) fecha o banco e recarrega.
- Local: booleanos JS e `tags` como array. Conversão para o formato de rede em `sync.js`.
- `servidorEm` não precisa ser guardado localmente (só o servidor usa).
- Outbox chaveada por `tabela:id`: várias edições offline do mesmo item viram uma única op
  (upsert da linha inteira).
- **`atualizadoEm` monotônico por linha:** ao editar, `atualizadoEm = max(Date.now(),
  atualizadoEmAtual + 1)`. Evita que um aparelho com relógio atrasado perca a própria edição.
- `ordem` fracionária (uma única coluna para foco e lista): ao arrastar, média dos vizinhos;
  só a linha movida muda. Novos itens entram no topo (`menor ordem − 1000`).
- Preferências (agrupar/lista corrida, tema) e URL/token: `localStorage`.
- UUID: `crypto.randomUUID()` com fallback via `crypto.getRandomValues`.

### Regras de domínio

- **Concluir:** `feito=true`, `feitoEm=agora`, `foco=false`. Fica riscado na lista enquanto
  `feitoEm` for hoje (fuso local); depois aparece só em Concluídas.
- **Reabrir:** `feito=false`, `feitoEm=""` (foco não volta).
- **Termo:** na interface as observações se chamam **Etapas**. Dados, abas, colunas e stores
  continuam `observacoes` (sem mudança de esquema).
- **Excluir pendência:** `excluido=true`; etapas e comentários ficam órfãos e são ignorados (sem cascata).
- **Comentários ≠ etapas:** tabela própria. Não entram no contador feitas/total, na reordenação,
  no ○/✓ nem na lista de etapas do relatório.
- **Excluir tag:** `excluido=true` na tag + remove o id dela de cada item (cada item vira uma op).
  Ids de tags inexistentes/excluídas são ignorados na tela.
- **Captura com prefixo:** regex `^([^:/]{1,24}):\s*(.+)$`, comparação sem maiúsculas/acentos
  (NFD). Tag existente → vincula e remove o prefixo do título. Tag inexistente → cria o item
  com o **texto original completo** e mostra "Tag 'X' não existe · Criar tag X"; ao aceitar,
  cria a tag, vincula e remove o prefixo do título.
- **Captura sem prefixo:** se há filtro de tag ativo, nasce com essa tag; senão, sem tag.
- **Etapa:** começa com `ok ` ou `✓ ` → `tipo=ok` (prefixo removido); senão `falta`.
- **Aguardando:** ligar grava `aguardandoEm` = agora (ISO); desligar limpa. Itens marcados antes
  da coluna existir (sem data) aparecem como "aguardando" sem contador.
  Clique no ícone alterna. Data automática (exibida dd/mm).

## 4. Protocolo de sincronização

`POST` para a URL `/exec`, `Content-Type: text/plain`, corpo JSON. O Apps Script sempre
responde HTTP 200; o resultado está em `ok`.

```
→ { token, action: "pull", since: <epoch ms> }
← { ok: true, serverTime, pendencias: [...], observacoes: [...], tags: [...], comentarios: [...] }
   (linhas com servidorEm > since; booleanos JSON, números JSON, tags como "id1;id2")

→ { token, action: "push", ops: [ { table, row }, ... ] }      (máx. 500 ops)
← { ok: true, serverTime, results: [ { table, id, status: "aplicado"|"ignorado"|"erro", erro? } ] }

← { ok: false, erro: "mensagem" }      (token inválido, JSON inválido, ação desconhecida, etc.)
```

Servidor:
- Token em Propriedades do script (`TOKEN`), comparado em tempo constante.
- `LockService` (lock do script) em push **e** pull.
- Push: upsert por `id`; grava se `row.atualizadoEm >= atualizadoEm existente` (senão
  `ignorado`); carimba `servidorEm = Date.now()`. Campos ausentes na op mantêm o valor atual.
  Erros de validação afetam só a op.
- Pull: `serverTime = Date.now() − 1` (uma gravação no mesmo milissegundo logo depois ainda cai
  no próximo pull; repetir uma linha é inofensivo).

Cliente — `sincronizar()` (uma execução por vez):
1. **Push** da outbox em lotes de até 200. `aplicado`/`ignorado` → remove da outbox (só se a
   entrada não mudou durante o envio). `erro` → fica para a próxima.
2. **Pull** desde `lastSync`.
3. **Aplicar**: grava a remota se não existe local ou `remoto.atualizadoEm >= local.atualizadoEm`
   — exceto se houver op na outbox para o mesmo id com `atualizadoEm` maior (a local vence).
4. `lastSync = serverTime` do pull; re-render.

Gatilhos: ao abrir; `visibilitychange` (visível); evento `online`; a cada 60 s (online e
visível); botão "Sincronizar agora"; push com debounce de 2 s após a última edição.

Status no cabeçalho: Sincronizado · Pendente (n) · Sincronizando · Offline · Erro (toque abre
Configurações com a mensagem) · Só local (sem URL/token).

### Implementação (fatia 4)

- `js/sync.js`: configuração (`pend.url`, `pend.token` no localStorage), conversão de formato
  (tags array ↔ `"a;b"`; `servidorEm` descartado no cliente), `chamar()` com tempo limite de 30 s
  e mensagens claras (rede, URL errada, resposta não-JSON, `ok:false`), ciclo
  `sincronizar()` e gatilhos. Pedidos durante uma execução são reagendados (uma de cada vez).
- `store.js` mantém em memória o espelho da outbox (`tabela:id → atualizadoEm`) para o contador
  "Pendente (n)"; `aplicarRemoto()` faz o LWW e descarta da fila entradas superadas;
  `confirmarEnvio()` remove da fila só o que não mudou durante o envio.
- Uma op recusada pela planilha (erro de validação) **não trava** o resto: fica na fila, vira
  "Último erro", e o pull acontece mesmo assim.
- `meta`: `lastSync` (cursor = `serverTime`) e `ultimaSyncEm` (horário local, para exibir).
- Trocar a URL (outra planilha) zera o cursor. Trocar só o token não.

### Configurações → Sincronização

- Cartão de situação (status, última sincronização, alterações na fila, último erro,
  "Sincronizar agora") quando conectado; convite quando não.
- Formulário único (URL `https://script.google.com/macros/s/…/exec` validada + token mascarado
  com "Mostrar"); o que é digitado fica num rascunho, para um redesenho não apagar.
- **Primeira conexão** (aparelho sem planilha e sem `lastSync`, ou troca de URL) com dados
  locais: antes de qualquer envio, pergunta inline "Este aparelho tem N itens que nunca foram
  sincronizados. Enviar para a planilha · Apagar e baixar da planilha · Cancelar".
  N = linhas locais (pendências + observações + tags). "Enviar" põe tudo na fila; "Apagar e
  baixar" zera o aparelho e faz pull completo; "Cancelar" não salva nada.

### Apagar dados deste aparelho (Configurações → Armazenamento)

- Confirmação inline: "Apagar tudo deste aparelho? Pendências, observações, tags e fila de envio.
  A planilha não é afetada." + "N alterações ainda não sincronizadas serão perdidas" quando a
  fila não está vazia (+ aviso de que a planilha é baixada de novo, se conectado).
- Limpa as 5 stores do IndexedDB (inclusive outbox e `meta`/lastSync) **sem recarregar a
  página** (funciona offline); mantém URL/token e preferências (tema, agrupar). Se conectado,
  sincroniza em seguida (baixa da planilha).

## 5. Telas

### Desktop (coluna central ~760 px; painéis como gaveta à direita ~420 px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◉ Pendências                         ● Sincronizado   ⌕   ✓   #   ⚙ │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ +  Nova pendência…   (tag: texto)                           n │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  (Todas 24) (igreja 5) (casa 7) (trabalho 9) (saúde 3)               │
│                                                                      │
│  EM FOCO ─────────────────────────────────────────── fundo âmbar ──  │
│  ☐ [trabalho] Fechar proposta Randon        💬3  ⏳  12/11       ★   │
│  ☐ [casa] Orçamento do telhado               💬1               ★     │
│                                                                      │
│  TODAS                                       [Agrupar | Lista corrida]│
│  igreja · 5 ──────────────────────────────────────────────────────── │
│  ☐ Comprar cadeiras                          💬2               ☆     │
│  ☐ Falar com o pastor sobre o som   [casa]          05/11      ☆     │
│  ☑ R̶e̶s̶e̶r̶v̶a̶r̶ ̶s̶a̶l̶ã̶o̶                                           ☆     │
│  casa · 7 ────────────────────────────────────────────────────────── │
│  ▾ Renovar seguro do carro                                   ☆   ⌃  │  ← toque = recolhe; ⌃ Fechar
│  │  TÍTULO [Renovar seguro do carro_____________________]            │
│  │  ✓ 28/10  Cotação Porto recebida                             ×    │
│  │  ○ 30/10  Pedir cotação Azul                                 ×    │
│  │  [ + nova observação…  (ok … = feito) ]                           │
│  │  Tags: (casa✓) (igreja) (trabalho) (saúde)                        │
│  │  Prazo [__/__/____]   ⏳ aguardando [ ]          Excluir pendência │
│  Sem tag · 3 ─────────────────────────────────────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
```

- Linhas ~34 px (25–30 visíveis). Indicadores em texto suave; prazo laranja (hoje) / vermelho (vencido).
- Alça de arraste no hover; item selecionado pelo teclado com anel sutil.
- Exclusão com confirmação inline ("Excluir mesmo? Sim · Não").

### Celular (captura fixa no topo; painéis como folha de baixo; linhas ≥ 44 px; safe-area)

```
┌────────────────────────────┐
│ ◉ Pendências ●  ⌕  ✓  #  ⚙ │  ← quatro ícones cabem; sem menu ☰
│ ┌────────────────────────┐ │
│ │ + Nova pendência…      │ │  ← sticky
│ └────────────────────────┘ │
│ (Todas 24)(igreja 5)(casa →│  ← rolagem horizontal só nos chips
├────────────────────────────┤
│ EM FOCO                    │
│ ☐ Fechar proposta     ★    │
│   trabalho · 💬3 · 12/11   │  ← indicadores em 2ª linha pequena
│ TODAS            [≡ | ▤]   │
│ igreja · 5                 │
│ ☐ Comprar cadeiras    ☆    │
└────────────────────────────┘
```

### Regras de lista (aprovadas)

- Item em foco aparece **só** em "Em foco", não em "Todas".
- Modo **Agrupar**: grupos pela 1ª tag (cabeçalho fino com rótulo e contagem; "Sem tag" por
  último); a 1ª tag não é repetida na linha (as demais aparecem). Arraste **só dentro do grupo**;
  arrastar nunca altera tags.
- Modo **Lista corrida**: todas as tags na linha (até 2 + "+n").
- **Filtros (seleção múltipla):** cada chip de tag liga/desliga; vários ao mesmo tempo. Entre
  tags vale **OU** (itens com qualquer uma das tags ativas, em qualquer posição); **"Aguardando"**
  combina com as tags por **E**. **"Todas"** limpa tudo e fica ativo quando nenhum filtro está
  ligado. Com qualquer filtro ativo: lista corrida, sem cabeçalhos. Estado:
  `ui.filtros = { tags: [ids], aguardando }`, lembrado no localStorage (`pend.filtros`); tags
  excluídas saem do filtro; o filtro "Aguardando" se desfaz quando não houver mais nada aguardando.
- Chips: "Todas" + **"Aguardando"** (só quando há itens aguardando) + uma por tag, com contagem de
  abertas. Seleção na cor da tag (Aguardando: violeta).
- **Captura com filtros ativos (sem prefixo):** 1 tag ativa → nasce com ela; 2+ → nasce com a
  **primeira tag ativa na ordem dos chips** e o aviso diz qual ("Criada em “Randon” (primeira tag
  do filtro)."). "Aguardando" ativo → nasce aguardando. Prefixo de outra tag → aviso "fora do
  filtro atual" com "Ver todas".
- **Modo padrão:** "Lista corrida" no celular (≤ 600 px), "Agrupar" no desktop; a escolha do
  usuário fica salva por aparelho (`pend.modo`).
- Estados vazios convidativos ("Nada em foco. Toque na estrela de um item").

### Linha compacta no celular (≤ 600 px)

Medido em 360 × 800 com 20 itens reais (2 em foco, 4 com etapas, 3 com prazo, 3 aguardando),
contando linhas inteiras na primeira tela: **antes 7** (Agrupar, padrão) / 8 (Lista corrida) →
**depois 12** (Lista corrida, novo padrão) / 9 (Agrupar).

- Tag: bolinha de 9 px na cor da tag antes do título (até 3, na ordem; a 1ª é a principal),
  `role="img"` com `aria-label` "Tags: …". O nome continua nos chips, cabeçalhos de grupo e item
  aberto. No desktop, rótulo escrito como antes.
- 2ª linha **só** com informação (etapas, prazo, aguardando); sem isso, uma linha só (44 px).
- Título 14.5 px (um degrau abaixo), até 2 linhas e reticências. Checkbox e estrela 44 × 44 px;
  linha ≥ 44 px.
- Respiros acima da lista mais justos no celular (cabeçalho 52 px, captura 46 px, margens de
  chips/seções menores, "Em foco" com padding 2 px).
- "Em foco" vazio no celular: uma linha fina "☆ Nada em foco — toque na estrela de um item"
  (sem o título da seção e sem o cartão).

### Painéis

- **Concluídas:** por dia ("Hoje", "Ontem", "seg., 28/10"), botão "Reabrir"; últimos 30 dias +
  "Mostrar mais". Item com comentários: botão balão + nº (`aria-expanded`) que expande a lista
  **só para leitura** (data/hora + texto inteiro com links; sem Editar/Excluir — para editar,
  reabrir o item).
- **Tags:** criar, renomear, cor (paleta fixa de 8 — ver "Paleta" abaixo), reordenar, excluir
  (com confirmação; desvincula dos itens).
- **Configurações:** URL do Web App (valida `script.google.com/macros/s/…/exec`), token
  (mascarado), "Sincronizar agora", última sincronização/erro, tema Automático/Claro/Escuro,
  aviso suave sem configuração, e o estado do armazenamento: "Persistente" ou "Não
  persistente (o navegador pode apagar os dados se faltar espaço)" — ou "Indisponível neste
  navegador".
- **Armazenamento persistente:** ao iniciar, se `navigator.storage?.persist` existir, o app
  chama `navigator.storage.persisted()` e, se ainda não for persistente, `persist()`. O
  resultado alimenta o estado mostrado em Configurações (fatia 3).
- **Busca:** `/` ou ⌕ troca a barra de captura pela de busca; filtra título, etapas e
  **comentários** dos itens abertos e concluídos hoje, destacando o trecho; `Esc` volta.

### Comportamentos de interação (fatia 3)

- Captura recebe o foco ao abrir no desktop (não no celular, para não abrir o teclado).
  `↓` com a captura vazia desce para a lista.
- Concluídas de hoje ficam no fim da própria zona, riscadas (cor `--done`); não são arrastáveis.
- Indicador de etapas na linha recolhida: ícone de lista + "feitas/total" (ex.: 1/3).
- Indicador de comentários na linha recolhida: ícone de balão + quantidade (depois das etapas).
- Indicador de aguardando: "aguardando · hoje" / "aguardando · 3 d" (dias de calendário desde
  `aguardandoEm`); a partir de **7 dias** no tom de alerta (`--danger`, o mesmo do prazo vencido),
  para lembrar de cobrar. Sem data: só "aguardando".
- Arraste: mouse arrasta de qualquer ponto da linha após 5 px (clique continua sendo clique);
  toque exige segurar ~300 ms (deslizar rápido continua rolando). Tags: arraste pela alça.
  Etapas: mesma regra, dentro do item aberto (ver "Reordenar etapas").
- "Desfazer" no aviso após excluir pendência e após excluir observação.
- Item criado fora do filtro ativo (prefixo de outra tag) → aviso com "Ver todas".
- Busca filtra também o "Em foco"; achado só em observação mostra o trecho na linha.
- Abrir pelo teclado (`Enter`) põe o cursor em "nova observação".

### Item aberto: layout

```
[☐] título do item (toque = recolher)          [✎] [☆] [⌃]
    ETAPAS 1/2
    ┌───────────────────────────────────────────────┐  bloco rebaixado (--sunken),
    │ ○ texto da etapa que ocupa a largura toda   × │  raio 10px, divisória fina
    │ ✓ etapa feita                                × │  entre linhas
    │ + Nova etapa…  ("ok …" = já feita)            │  ← última linha do bloco
    └───────────────────────────────────────────────┘
    ─────────────────────────────────────────────────
    TAGS
    (✓ Sekurit 1) (✓ Randon 2) (+ Tag)
    ─────────────────────────────────────────────────
    [Prazo dd/mm/aaaa] [◷ Aguardando desde 02/11]
    ─────────────────────────────────────────────────
                                    🗑 Excluir pendência
```

- Ordem: cabeçalho → ETAPAS → TAGS → Prazo/Aguardando → Excluir. Divisória fina entre seções;
  respiro de 16 px (desktop) / 20 px (celular). Rótulos alinhados com o conteúdo.
- **Título:** aparece uma vez só, no cabeçalho. O lápis (`aria-label` "Editar título", 44 × 48 px
  no celular) troca o título por um campo no mesmo lugar, com a mesma fonte; Enter ou sair do
  campo salva; Esc cancela (e não recolhe o item). Tocar no título (fora do lápis) recolhe.
- **Etapas:** linha = [○/✓] [texto] [×]; a data (`data`) continua gravada e aparece só como
  dica ao passar o mouse ("Anotada em 02/11"). Cabeçalho "ETAPAS" + contador "feitas/total"
  (sem etapas: só o cabeçalho e o campo).
- **Editar uma etapa:** tocar no **texto** vira campo no mesmo lugar (mesma fonte/tamanho, cursor
  no fim); ○/✓ só alterna feita/falta e × só exclui. Enter ("Enviar" no celular) ou sair do
  campo salva; Esc cancela e **não** recolhe o item. Texto vazio ao salvar → volta ao original
  com o aviso "Para remover a etapa, use o ×". O prefixo "ok " só vale na criação; na edição o
  texto é gravado como digitado. Salvar = `editarObservacao` (novo `atualizadoEm`, entra na fila).
  Uma etapa em edição por vez; tocar no texto de outra salva a atual e já abre a outra. Recolher
  o item (tocar fora, ⌃, título, outro item) salva antes. Desktop: cursor de texto e contorno
  fino (`--muted-ui`) no hover. Celular: o texto ocupa a altura toda da linha (alvo ≥ 44 px).
- **Reordenar etapas** (ordem manual, por item; vale em todos os aparelhos):
  - **Celular:** segurar a linha ~300 ms e arrastar (sem alça fixa). Toque rápido no texto
    continua editando; ○/✓ e × continuam iguais; deslizar rápido rola a página. Na linha, seleção
    de texto e menu de contexto do Android/Chrome ficam bloqueados (`user-select: none`,
    `-webkit-touch-callout: none`, `contextmenu` cancelado durante o gesto); o campo de edição
    mantém a seleção normal.
  - **Desktop:** alça ⠿ à esquerda da linha, só no hover (começa na hora); a linha também arrasta
    depois de 5 px. Teclado: com o foco no texto da etapa, **Alt+↑ / Alt+↓** move uma posição
    (o foco fica na etapa).
  - **Durante o arraste:** a etapa "levanta" (fundo `--surface`, sombra `--shadow-3`) e as outras
    abrem espaço com animação curta (0,18 s; desligada com `prefers-reduced-motion`). Só dentro
    do próprio item.
  - **Leitor de tela:** região `aria-live` anuncia "Etapa movida para a posição 2 de 4".
  - **Não fecha o item** e não tira o foco; se havia uma etapa em edição, ela é **salva antes**
    do arraste começar.
  - **Dica única:** no celular (`hover: none`), na 1ª vez que um item com 2+ etapas é aberto,
    aviso "Segure uma etapa para mudar a ordem"; nunca se repete (`pend.dicaEtapas`).
  - **Gravação:** `moverObservacao` grava só a etapa movida com `ordem` = média das vizinhas
    (topo: 1ª − 1; fim: última + 1). Se as vizinhas estiverem coladas (diferença < 1e-6), renumera
    o item inteiro 0, 1, 2… Cada etapa alterada ganha novo `atualizadoEm` e entra na fila; a
    planilha guarda o valor na coluna `ordem` da aba `observacoes` (pode ser fracionário/negativo).
- **Implementação:** as linhas de etapa são reaproveitadas por id (não recriadas a cada render),
  para o campo não perder o foco quando chega uma sincronização e para o toque em outra etapa
  não ser "engolido" quando a edição anterior salva e redesenha.
- **Comentários** (seção "COMENTÁRIOS n", logo abaixo de ETAPAS): registro do que foi falado
  numa reunião/conversa; não é algo a fazer (sem ○/✓).
  - **Campo:** textarea "Escreva o que foi falado…", cresce até ~8 linhas e depois rola.
    **Adicionar** (desabilitado com o campo vazio). Desktop: **Ctrl+Enter** (⌘+Enter no Mac)
    adiciona, Enter quebra linha; dica "Ctrl + Enter adiciona" só com mouse. Celular: botão
    Adicionar (Enter do teclado quebra linha). Espaços/linhas vazias nas pontas são aparados;
    as quebras internas ficam.
  - **Lista:** mais recente primeiro. Cabeçalho "03/11/2026 10:14" (fuso do aparelho) e, se
    editado, "· editado em 03/11 10:20"; texto com quebras preservadas (`pre-wrap`); links
    `http(s)://…` e `www.…` clicáveis (nova aba, `noopener`), montados com nós de texto — nunca
    `innerHTML`; pontuação final e ")" sem par ficam fora do link.
  - **Longos:** recolhidos em 6 linhas (`line-clamp`) com "Ver tudo"/"Ver menos"; o botão só
    aparece se o texto realmente passar de 6 linhas na largura atual (medido após o desenho e ao
    redimensionar).
  - **Editar:** "Editar" troca o texto por um campo no lugar com **Salvar · Cancelar**;
    Ctrl+Enter salva, Esc cancela **sem** recolher o item. Um em edição por vez; recolher o item
    ou editar outro comentário salva antes. Texto vazio → volta ao original com o aviso "Para
    remover o comentário, use Excluir". `criadoEm` nunca muda; `editadoEm` só se o texto mudou.
  - **Excluir:** confirmação inline "Excluir este comentário? [Excluir] [Cancelar]" → aviso
    "Comentário excluído." com **Desfazer** (não marca como editado).
  - **Rascunho:** o campo novo é gravado por item no aparelho (`pend.rascunho:<id>`) 0,4 s depois
    de parar de digitar, ao recolher o item e quando o app vai para segundo plano; volta ao
    reabrir (inclusive depois de fechar o app); some ao Adicionar, ao esvaziar o campo, em
    "Apagar dados deste aparelho" e (na abertura seguinte) para itens excluídos. Não sincroniza.
  - **Limite:** 50.000 caracteres. Contador "n / 50.000" a partir de 90%; acima do limite fica em
    `--danger` e Adicionar/Salvar avisam antes de enviar (o texto fica no campo).
  - Celular: todos os botões dos comentários (Adicionar, Editar, Excluir, Salvar, Cancelar,
    Ver tudo, Excluir/Cancelar da confirmação e o balão do painel Concluídas) com alvo de toque
    ≥ 44 × 44 px. "Reabrir" do painel Concluídas também 44 px no celular (desktop: 30 px).
- **Tags compactas:** só as marcadas (estilo selecionado, com número de ordem se 2+) + "+ Tag".
  "+ Tag" (ou tocar numa tag marcada) abre a lista completa no lugar; "Concluir", tocar fora da
  lista ou Esc recolhem. Sem tags marcadas: só "+ Tag".
- Botão "Aguardando" mostra "Aguardando desde dd/mm" quando ativo e com data.

### Item aberto: como recolher

Layout aberto: a linha de cima mostra o título (quebra em várias linhas) + estrela + botão
**Fechar** (chevron-up, `aria-label="Fechar"`, 44 × 48 px no celular). O título editável é o
primeiro campo do detalhe ("Título"). Formas de recolher:

1. Clicar/tocar de novo na linha do item aberto (título ou área livre da linha).
2. Botão **Fechar**.
3. Clicar/tocar **fora** do item aberto. Não recolhem: cliques dentro do próprio item (campos,
   chips, observações), nos avisos (toasts), nos painéis (`<dialog>`) e nos botões do topo.
   Implementação: evento `click` (não dispara ao rolar no celular) + `composedPath()` (vale
   mesmo se um render trocou os elementos durante o clique).
4. `Esc` (desktop), inclusive com o cursor dentro de um campo do item.
5. Abrir outro item recolhe o anterior (só um aberto por vez).

Sempre por uma única função (`definirAberto`), que **grava o título em edição antes de
recolher** — o campo sai da tela sem disparar `change`, então não dá para depender do blur.

### Atalhos (desligados enquanto se digita)

`n` captura · `/` busca · `↑↓` seleciona · `Enter` abre/fecha · `f` foco · `espaço` feito ·
`Esc` fecha item → limpa busca → tira seleção.

### Visual

Estética calma, muito respiro, Manrope com números tabulares, tokens de cor em `:root`, claro/
escuro automáticos + manual. Microinterações (check animado, item concluído risca, estrela com
"pop"), respeitando `prefers-reduced-motion`; `navigator.vibrate` curto ao concluir.

### Paleta: claro "Azul limpo" · escuro "Grafite"

Tokens em `css/app.css`: claro em `:root` (padrão), escuro em
`@media (prefers-color-scheme: dark)` e em `:root[data-theme="dark"]` (opção manual em
Configurações). **Regra de contraste:** todo texto ≥ 4.5:1 sobre o fundo onde aparece; bordas e
ícones ≥ 3:1. Verificado no navegador medindo todo texto visível (lista, item aberto, painéis
Configurações e Concluídas) nos dois temas — zero falhas.

| Token | Uso | Claro | Escuro |
|---|---|---|---|
| `--bg` | fundo da página | #f5f7fa | #1c1f24 |
| `--surface` | cartões, item aberto, painéis | #ffffff | #23272d |
| `--surface-2` | campos, hover, cartões internos | #eff2f5 | #2a2e35 |
| `--surface-3` | hover de botão | #e3e8ed | #343941 |
| `--line` | bordas | #d9dee3 | #2c3036 |
| `--line-soft` | divisórias | #eef0f2 | #2c3036 |
| `--text` | texto principal | #1d2d3e | #e8eaed |
| `--text-2` | texto secundário | #556b82 | **#959ca5** ¹ |
| `--muted` | texto suave (contagens, datas, rótulos) | **#556b82** ² | **#959ca5** ² |
| `--muted-ui` | checkbox vazio, estrela apagada, alças, ícones | **#78899c** ³ | **#6e757e** ³ |
| `--done` | texto concluído (riscado) | **#556b82** ² | **#959ca5** ² |
| `--accent` | links, checkbox marcado, foco, chip ativo, marca | #0064d9 | #c8f169 |
| `--accent-ink` | texto/✓ sobre o acento | #ffffff | #1c1f24 |
| `--accent-soft` | fundo do chip ativo | #e8f3ff | #2f3a1e |
| `--focus-bg` / `--focus-line` | bloco EM FOCO | #e8f3ff / #b5d4f4 | #262b22 / #4a5a2a |
| `--focus-ink` / `--star` | rótulo EM FOCO / estrela ativa | #0064d9 | #c8f169 |
| `--warn` | prazo hoje | **#b34d00** ⁴ | #ffb36b |
| `--danger` | prazo vencido, excluir | #aa0808 | #ff8a80 |
| `--espera-fg` / `--espera-bg` | "aguardando" | #8a3fb0 / #f4ebfa | #d4a5ff / #2c3036 |
| `--ok-fg` / `--ok-bg` | status "Persistente" | #256f3a / #e7f4eb | #8fdc9a / #2c3036 |
| `--aviso-fg` / `--aviso-bg` | status "Não persistente" | #b34d00 / #fff1e3 | #ffb36b / #2c3036 |
| `--toast-bg` / `--toast-ink` / `--toast-acao` | avisos | #1d2d3e / #fff / #8cc4ff | #e8eaed / #1c1f24 / #0050ad |

Ajustes em relação aos hex pedidos (mínimo para passar):
1. Secundário escuro #8b929b → #959ca5: dava 4.3:1 sobre os campos (#2a2e35).
2. "Texto suave" #8396a8 (claro) e #5d646d (escuro) dão 2.8:1 e 2.8:1 como texto → o texto
   suave e o concluído usam o tom do secundário; a hierarquia vem de tamanho/peso/caixa alta.
3. Os tons suaves continuam existindo para **elementos gráficos** (borda do checkbox vazio,
   estrela apagada, alças), ajustados para 3:1: #8396a8 → #78899c; #5d646d → #6e757e.
4. Prazo hoje (claro) #c35500 → #b34d00: dava 4.2:1 sobre o fundo da página. (O laranja das
   tags continua #c35500, porque o rótulo é branco: 4.6:1.)

**Tags** — as cores salvas continuam c1…c8; só os tons mudaram:

| Id | Cor | Claro (texto · rótulo branco com borda tingida) | Escuro (texto · rótulo #2c3036) |
|---|---|---|---|
| c1 | Azul | #0064d9 | #7fc7ff |
| c2 | Verde-água | #0e7c86 | #6fd6d6 |
| c3 | Verde | #256f3a | #8fdc9a |
| c4 | Oliva | #5a6e12 | #c8d97a |
| c5 | Laranja (antes âmbar) | #c35500 | #ffb36b |
| c6 | Marrom (antes terracota) | #7a5230 | #d9b38c |
| c7 | Rosa | #b8336a | #ff9ec4 |
| c8 | Violeta | #8a3fb0 | #d4a5ff |

**Seletores de tag** (tags do item aberto e chips de filtro por tag) — a seleção fala a cor da
tag; o azul/verde-limão do acento **não** indica seleção de tag (só o chip "Todas" e o anel de
foco de teclado usam o acento):

| Estado | Fundo | Texto | Borda | Marcador | Peso |
|---|---|---|---|---|---|
| Selecionado | tinta da tag: `color-mix(cor forte 10%, #fff)` no claro; `color-mix(cor forte 14%, #23272d)` no escuro | cor forte da tag | 1.5px na cor forte | ✓ na cor da tag | 600 |
| Não selecionado | transparente | `--text-2` | 1px `--line` | bolinha na cor da tag | 500 |

- Os rótulos da lista continuam como estavam (claro: branco com borda tingida; escuro: #2c3036);
  no claro o branco não diferenciava a seleção, por isso o chip selecionado usa a **tinta**.
- Texto sobre a tinta no claro: verde-água #0e7c86 → **#0d7680** (4.33 → 4.69:1) e laranja
  #c35500 → **#b34d00** (3.98 → 4.63:1), só dentro do chip (tokens `--c2-chip`, `--c5-chip`).
  As demais cores e todo o escuro passam como estão.
- Número de ordem (só com 2+ tags marcadas): selo com fundo na cor forte da tag e número branco
  (claro) / #1c1f24 (escuro) — ≥ 4.55:1 em todas.
- `aria-pressed` mantido; após alternar pelo teclado o foco volta ao mesmo chip.
- Contraste medido no navegador com as 8 tags selecionadas (+ selos 1–8 + filtro selecionado):
  54 textos por tema, zero falhas.

## 5b. PWA (fatia 5)

- `manifest.webmanifest`: name/short_name "Pendências", `lang` pt-BR, `id`/`start_url`/`scope`
  "./", `display` standalone, `orientation` any, `theme_color`/`background_color` #f5f7fa
  (o escuro #1c1f24 vem do `<meta name="theme-color" media=…>`). Ícones 192, 512 e maskable 512
  (`icons/icon-maskable.svg`: fundo cheio, ✓ na área segura) + `apple-touch-icon.png` (180).
  PNGs gerados por `tools/gerar-icones.html` (sem dependências) e commitados.
- `sw.js`: cache `pendencias-<VERSAO>` com o app shell (lista `SHELL`); `install` baixa com
  `cache: 'reload'` (ignora o cache HTTP do Pages) e **não** chama `skipWaiting`; `activate`
  apaga caches `pendencias-*` antigos e faz `clients.claim()`; `fetch` só trata GET da própria
  origem (o Apps Script, POST em script.google.com, vai sempre pela rede): navegação →
  `index.html` do cache; demais → cache-first. Responde `{tipo:'versao'}` e `{tipo:'atualizar'}`.
- `js/pwa.js`: registra `sw.js` (relativo, `updateViaCache: 'none'`); procura versão nova ao
  voltar para o app; SW novo esperando → aviso persistente "Nova versão disponível · Atualizar"
  (+ botão em Configurações → Aplicativo); ao tocar, `skipWaiting` e **uma** recarga (só
  recarrega no `controllerchange` pedido pelo usuário — nunca na primeira visita, sem laço).
- Instalação: `beforeinstallprompt` guardado; botão "Instalar app" em Configurações e aviso
  único (marca `pend.avisoInstalar` no localStorage); oculto se já instalado
  (`display-mode: standalone`). `appinstalled` → `navigator.storage.persist()` de novo.
- Configurações → Aplicativo: "Versão vN" (lida do SW) e "Instalado"/"No navegador".
- **Regra de publicação:** a cada publicação, aumentar `VERSAO` em `sw.js`; arquivo novo do app
  entra na lista `SHELL`.
- `.nojekyll` na raiz; `.gitignore`.

## 5c. Resumo e Relatório (Parte C)

Tudo calculado no aparelho, sob demanda ao abrir o painel, a partir do IndexedDB (funciona
offline); redesenha sozinho se a sincronização trouxer dados com o painel aberto. Não mexe na
planilha nem no Apps Script. **Sem enviar/compartilhar** — a única ação externa é "Copiar".
Ignora sempre itens, etapas e tags com `excluido=TRUE` (item de tag excluída conta como "Sem
tag"). Datas no fuso local; **semana de segunda a domingo**; datas comparadas por dia
(`AAAA-MM-DD`). Arquivos: `js/resumo-dados.js` (cálculos) e `js/ui/resumo.js` (tela).

**Acesso:** ícone "Resumo" (gráfico) no cabeçalho, entre a busca e Concluídas. Desktop: gaveta de
720 px. Celular: tela cheia, com × no topo. Abas "Resumo" e "Relatório"; a última usada fica
salva no aparelho (`pend.resumoAba`). No celular (≤ 600 px) o nome "Pendências" sai do cabeçalho
(fica o símbolo, com o nome no `aria-label`) para as 5 ferramentas de 44 × 44 caberem em 360 px.

### Aba Resumo — indicadores

| Bloco | Regra | Toque |
|---|---|---|
| Atrasadas (cartão) | abertas com `prazo` < hoje; tom de alerta se > 0 | rola até "Prazos" |
| Aguardando (cartão) | abertas com `aguardando` | fecha o painel e liga só o chip "Aguardando" |
| Concluídas na semana (cartão) | `feito` com `feitoEm` de segunda até hoje | abre o Relatório em "Esta semana" |
| Abertas por tag | por tag ativa: abertas com a tag (item com várias tags conta em cada uma — nota no bloco); trecho mais claro = aguardando, com legenda e o número escrito; ordem: maior → menor (empate: ordem dos chips); "Sem tag" no fim | fecha o painel e filtra a lista só por aquela tag ("Sem tag" não é tocável) |
| Aguardando há mais tempo | top 5 abertas aguardando, `aguardandoEm` mais antigo primeiro; "há N d" / "hoje"; ≥ 7 dias em alerta; sem data no fim ("sem data"); bloco some se não houver | abre o item na lista |
| Prazos | grupos Atrasadas (< hoje), Hoje (= hoje), Próximos 7 dias (hoje < prazo ≤ hoje+7), ordenados por prazo; até 5 por grupo + "+N mais"; grupo vazio some; nenhum: "Nenhum prazo nos próximos 7 dias." | abre o item na lista |

"Abrir o item na lista": fecha o painel, limpa a busca, desliga os filtros **só** se o item estiver
escondido por eles, expande o item e rola até ele.

### Aba Relatório — concluídas

- **Período:** Hoje · Esta semana (seg–dom, padrão) · Semana passada · Este mês · Mês passado ·
  Personalizado (De/Até; datas invertidas são aceitas e ordenadas). Rótulo "03/11 a 09/11"
  (com o ano quando o período não é do ano atual).
- **Tags:** seleção múltipla (OU), padrão "Todas".
- **Agrupamento:** por tag, na ordem dos chips; o item aparece **só no grupo da 1ª tag** dele —
  com filtro, a 1ª tag dele **entre as filtradas**. "Sem tag" por último (só sem filtro de tags).
  Grupo sem nada some; tudo vazio → estado vazio explicando o filtro.
- **Concluídas:** `feito` com `feitoEm` no período — título, data de conclusão, etapas
  "feitas/total" e a lista das etapas (✓/○, fonte menor).
- **Em andamento:** abertas, **não aguardando**, com alguma alteração no período (`atualizadoEm`
  do item ou de uma etapa não excluída, ou um **comentário escrito** no período — pelo
  `criadoEm`) — título e etapas feitas/total. (Aguardando não se repete aqui. Qualquer alteração
  conta, inclusive reordenar.)
- **Incluir comentários:** opção desligada por padrão, lembrada por aparelho
  (`pend.relComentarios`). Ligada: sob cada item (concluídas, em andamento e aguardando), os
  comentários com `criadoEm` no período, em **ordem cronológica** (mais antigo primeiro) — na
  tela, no Copiar e na impressão.
- **Aguardando:** abertas aguardando, independentemente do período — título e "desde dd/mm"
  (ou "sem data").
- **Totais** no topo: N concluídas · N em andamento · N aguardando.
- **Copiar:** texto simples na área de transferência (fallback com `execCommand` se a API não
  existir), aviso "Relatório copiado". Formato:

```
Randon — 03/11 a 09/11
Concluídas:
• Projeto VPO (3/3 etapas) — 05/11
Em andamento:
• Projeto Solicitação de frete — 1/4 etapas
Aguardando:
• Validação do layout — desde 05/11
```

  (um bloco por tag, separados por linha em branco; sem etapas, a parte "(x/y etapas)" é omitida).
  Com "Incluir comentários", cada comentário vem sob o item, recuado; linhas seguintes do mesmo
  comentário com recuo maior:

```
• Projeto frete — 1/4 etapas
    03/11 10:14 — Reunião com o fornecedor: prazo de entrega
      confirmado para dia 15.
```

- **Impressão (Ctrl+P → PDF):** `@media print` mostra só o conteúdo do painel aberto, sem
  cabeçalho, abas, filtros e botão Copiar.

### Avisos com painel aberto

Com um painel (`<dialog>` modal) aberto, os avisos (toasts) nascem **dentro** do painel — antes
ficavam atrás dele, invisíveis e sem clique (afetava "Conexão salva", "Tag excluída" etc.).

## 6. Testes por fatia

- Fatia 2: função `testarApi()` no editor + chamadas externas (console do navegador /
  PowerShell / curl) descritas no README.
- Fatia 3: desktop via `http://localhost` (contexto seguro).
- Fatia 5: celular via GitHub Pages (https) — instalação como PWA.
- **Regra permanente — área de transferência:** NUNCA ler a área de transferência real do
  sistema (`navigator.clipboard.readText()`, `read()`, colar via script ou equivalente) — ela
  pode conter dados pessoais do usuário. Para testar "Copiar", capturar o texto dentro da página
  de teste (substituir `navigator.clipboard.writeText` por uma função que guarda o texto numa
  variável da página) e conferir essa variável.

## 7. Backlog (não implementado)

Ideias registradas para depois de alguns dias de uso, em ordem de prioridade. Ainda sem solução
definida; cada uma passa por desenho e aprovação antes de ser implementada.

1. **Gestos de deslizar no celular:** direita = concluir, esquerda = foco.
2. **Links clicáveis nas etapas.**
3. **Anexos via Google Drive:** escopo `drive.file`, aba "anexos" na planilha, fila offline.
4. **Atalhos no ícone do app:** "Nova pendência" e "Em foco".
5. **Captura por voz** com transcrição.
6. **Resumo: bloco de itens parados há mais de 30 dias.**
7. **Resumo: gráfico de entregas por dia.**

(A "Tela Resumo" saiu do backlog: implementada na Parte C — seção 5c.)

## Histórico de alterações

- 2026-11-02 — Fatia 1 aprovada. Respostas: `servidorEm` adicionada; foco fora de "Todas";
  uma única `ordem`; arraste só dentro do grupo; filtro → lista corrida. Decisões aprovadas:
  pasta "APP Pendências", Manrope, debounce de 2 s, outbox com linha inteira, novos no topo,
  concluir tira a estrela, prefixo com tag inexistente mantém o texto, 1ª tag oculta no modo
  agrupado, script vinculado à planilha.
- 2026-11-02 — Fatia 2: detalhes do servidor (colunas como texto, `'` antes de `=`, localização
  de colunas por nome, campos ausentes mantêm valor, máx. 500 ops, `serverTime = agora − 1`,
  token gerado pelo próprio script) e regra de `atualizadoEm` monotônico no cliente.
- 2026-11-02 — Pedido para a fatia 3: `navigator.storage.persist()` ao iniciar e estado do
  armazenamento em Configurações.
- 2026-11-02 — Fatia 3 implementada: cabeçalho do celular com 4 ícones (sem ☰), `js/ui/dom.js`,
  comportamentos de interação listados na seção 5. A outbox já é preenchida localmente (sobe
  tudo na primeira sincronização da fatia 4).
- 2026-11-02 — Correção: Enter na captura não criava a pendência (captura e busca estavam no
  mesmo `<form>` sem botão de envio → o navegador não faz envio implícito). Regra: **cada campo
  que cria algo com Enter fica no seu próprio `<form>` e é tratado no `submit`** (captura, busca,
  nova observação, nova tag). Falhas de gravação e erros não tratados viram aviso + console.
  Favicon `icons/icon.svg` adicionado.
- 2026-11-02 — Ajustes da fatia 3: item aberto recolhe de 5 formas (seção "Item aberto"); o
  título editável virou o 1º campo do detalhe (antes ficava sobreposto à linha e engolia o
  clique de recolher). Nova paleta "Azul limpo" / "Grafite" com contraste AA verificado.
- 2026-11-02 — Fatia 4: sincronização (seção 4 → "Implementação", "Configurações →
  Sincronização", "Apagar dados deste aparelho"). Pedidos do usuário: botão de apagar com
  confirmação e contagem da fila; pergunta na primeira conexão com dados locais.
- 2026-11-02 — Fatia 5: PWA (seção 5b). Acessibilidade: a área do título da linha virou
  `role="button"` focável (Enter/espaço abre e recolhe), corrigindo `aria-expanded` sem papel.
- 2026-11-03 — Reordenar etapas (cache v7), opção 1 "segurar a linha" — ver "Item aberto:
  layout". `js/ui/drag.js` ganhou `alcaOpcional`, `idDe` e `aoIniciar`. Correções no arraste
  (valem também para itens e tags): a origem passou a ser o ponto onde o botão/dedo desceu (um
  movimento rápido não perde mais o deslocamento inicial) e o empate no centro do vizinho conta
  a favor do sentido do arraste (folga de 1 px).
- 2026-11-03 — Comentários na pendência (cache v8). Decisões aprovadas: **aba nova
  `comentarios`** (não reaproveitar `observacoes`: um aparelho na v7 mostraria a nota como etapa
  e um toque no ○ a transformaria em etapa); `editadoEm` em coluna própria (derivar de
  `atualizadoEm` marcaria "editado" depois de excluir/desfazer); IndexedDB v1 → v2 criando só a
  store nova e zerando `lastSync` uma vez; Code.gs com `comentarios` em `TABELAS` e
  `ABAS_OPCIONAIS` (sem a aba, pull devolve vazio e push recusa só essas ops, que esperam na fila);
  Concluídas com comentários só leitura; comentário no período conta como movimentação; opção
  "Incluir comentários" no Relatório. Ordem de publicação: README 1.10. Correção no caminho:
  `scroll-padding-top` = altura do cabeçalho fixo (campo focado por Tab/rolagem automática
  ficava escondido sob o cabeçalho no celular). Ajustes antes da publicação: alvos de toque dos
  comentários ≥ 44 px no celular; regra permanente de nunca ler a área de transferência real nos
  testes (seção 6).
- 2026-11-02 — Parte C (cache v6): painel Resumo (4 blocos) e Relatório de concluídas com
  "Copiar" (seção 5c). Correções encontradas no caminho: avisos com painel aberto ficavam atrás
  do painel; fechamento do painel podia ser disparado pela animação de um filho; reabrir durante
  a animação de saída fechava o painel; cabeçalho com 5 ícones estourava 360 px. Backlog:
  "Tela Resumo" removida; acrescentados "parados há +30 dias" e "gráfico de entregas por dia".
- 2026-11-02 — Seção 7 "Backlog (não implementado)" registrada. Nenhuma mudança de código.
- 2026-11-02 — Parte A (cache v5): filtros com seleção múltipla (tags OU, Aguardando E, lembrados
  por aparelho) e linha compacta no celular (bolinhas de tag, 2ª linha só com informação, título
  menor, "Em foco" vazio em linha fina, Lista corrida como padrão no celular). Ver "Regras de lista".
- 2026-11-02 — Editar o texto de uma etapa no lugar (cache v4). Ver "Item aberto: layout".
- 2026-11-02 — Ajustes consolidados (cache v3): título editável no cabeçalho (lápis), "Etapas"
  na interface com bloco rebaixado e sem data na frente, tags compactas com "+ Tag", ritmo
  vertical do item aberto, `aguardandoEm` (coluna nova, aditiva) com contador "· N d" e alerta
  a partir de 7 dias, chip de filtro "Aguardando". Token novo `--sunken`/`--sunken-line`.
- 2026-11-02 — Ajuste visual: seletores de tag com a cor da própria tag (seção "Paleta" →
  "Seletores de tag"); foco de teclado preservado ao alternar. Cache do SW: v1 → v2.
