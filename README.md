# Pendências

App pessoal de pendências: PWA offline-first (HTML + CSS + JS puro) que sincroniza com uma
planilha Google por meio de um Apps Script publicado como Web App.

- Desenho completo e decisões: [docs/DESENHO.md](docs/DESENHO.md)
- API (para colar no editor do Apps Script): [apps-script/Code.gs](apps-script/Code.gs)

> **Segurança:** este repositório é público. O token e a URL do Web App **nunca** entram no
> código — o token fica nas Propriedades do script (no Google) e, no app, só no `localStorage`
> de cada aparelho.

---

## 1. Instalação da planilha e da API

Pré-requisito: a planilha **pendencias.app** já existe na sua conta Google e o editor do Apps
Script foi aberto **a partir dela** (na planilha: **Extensões → Apps Script**). Assim o script
fica vinculado à planilha e não precisa do ID dela no código.

### 1.1 Colar o código

1. No editor do Apps Script, na lateral esquerda, em **Arquivos**, abra `Código.gs`.
2. Apague todo o conteúdo (o `function myFunction() {}` padrão).
3. Copie **todo** o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs) e cole.
4. Salve (**Ctrl+S** ou o ícone de disquete). Opcional: renomeie o projeto no topo
   (ex.: "Pendências API").

### 1.2 Rodar `setupSheets()` — cria as abas

1. Na barra de cima, no seletor de função (ao lado de **Depurar**), escolha `setupSheets`.
2. Clique em **Executar**.
3. Na primeira execução o Google pede autorização — veja [1.3](#13-autorizações-da-primeira-execução).
4. No **Registro de execução** devem aparecer três linhas, uma por aba
   (`pendencias`, `observacoes`, `tags`), com as colunas criadas.
5. Confira na planilha: três abas novas, linha 1 em negrito e congelada. A aba vazia padrão
   (ex.: "Página1") pode ser apagada.

`setupSheets()` pode ser rodada de novo sem risco: só acrescenta o que falta e nunca apaga dados.
Ela também formata as colunas como **texto puro** — isso impede o Sheets de transformar datas
ISO e números em outra coisa. Se você editar a planilha à mão, mantenha `TRUE`/`FALSE` em
maiúsculas nas colunas `foco`, `feito`, `aguardando` e `excluido`.

### 1.3 Autorizações da primeira execução

Como o script é seu e não passou por verificação do Google, o fluxo é este:

1. **"Autorização necessária"** → **Revisar permissões**.
2. Escolha a conta Google dona da planilha.
3. **"O Google não verificou este app"** → clique em **Avançado** →
   **Acessar "Pendências API" (não seguro)**. É seguro: o "app" é o seu próprio script.
4. Na tela de permissões, marque o que for pedido e clique em **Permitir**/**Continuar**.
   O script declara `@OnlyCurrentDoc`, então a permissão pedida é apenas
   **"Ver e gerenciar planilhas em que este app foi instalado"** — ele só enxerga a
   planilha pendencias.app, não o resto do seu Drive.

Isso só acontece uma vez (ou de novo se uma versão futura do código pedir permissões novas).

### 1.4 Rodar `setupToken()` — cria o token secreto

1. No seletor de função, escolha `setupToken` e clique em **Executar**.
2. O **Registro de execução** mostra o token: 64 caracteres hexadecimais, gerados
   aleatoriamente pelo próprio Google (`Utilities.getUuid()` duas vezes, ~244 bits).
3. **Copie o token e guarde no seu gerenciador de senhas.** Ele será colado em
   Configurações do app em cada aparelho.

Onde o token fica: em **Configurações do projeto** (ícone de engrenagem na lateral esquerda) →
**Propriedades do script**, chave `TOKEN`. Ele **não** está no código, então o `Code.gs` pode
ficar público no GitHub sem problema. Para consultá-lo depois, abra essa tela.

- Rodar `setupToken()` de novo **não** troca um token existente (só avisa).
- Para trocar (ex.: se o token vazou), rode `trocarToken()` e depois atualize o token em
  cada aparelho. Não é preciso republicar.
- Se preferir escolher o token você mesmo: crie a propriedade `TOKEN` à mão nessa tela, com
  pelo menos 32 caracteres aleatórios (não use uma senha que você usa em outro lugar).

### 1.5 Testar no editor: `testarApi()`

1. Escolha `testarApi` e clique em **Executar**.
2. O registro deve mostrar uma série de ✓, terminando em **"Todos os testes passaram"**:
   - token inválido é recusado; requisição sem token é recusada;
   - corpo que não é JSON e ação desconhecida são recusados;
   - push grava linha nova; push mais antigo é ignorado (last-write-wins); push mais novo atualiza;
   - op com tabela desconhecida volta como erro sem derrubar o envio;
   - pull devolve a versão mais nova e não repete a linha no pull seguinte.
3. O teste deixa uma linha na aba `tags` com nome "teste da API (editado)" e
   `excluido = TRUE`. O app ignora linhas excluídas; pode apagá-la à mão.

Esse teste roda a função `doPost()` dentro do editor. O teste "de verdade", pela internet, vem
depois de publicar (1.7).

### 1.6 Publicar como Web App

1. Canto superior direito: **Implantar → Nova implantação**.
2. Em **Selecione o tipo** (engrenagem), escolha **App da Web**.
3. Preencha:
   - **Descrição:** `v1` (qualquer texto; ajuda a identificar versões).
   - **Executar como:** **Eu** (seu e-mail).
   - **Quem pode acessar:** **Qualquer pessoa**.
4. **Implantar**. Se pedir autorização de novo, repita o fluxo de 1.3.
5. Copie o **URL do app da Web** — termina em **`/exec`**. Guarde junto com o token.

Por que "Qualquer pessoa": o app chama a URL sem login do Google. Quem protege os dados é o
token — sem ele, toda requisição recebe `{"ok": false, "erro": "Token inválido."}`.

Não use a URL que termina em `/dev`: ela só funciona logado como dono e sempre roda o código
não publicado.

### 1.7 Testar pela internet

Substitua `URL` pela URL `/exec` e `TOKEN` pelo seu token. O Apps Script sempre responde
HTTP 200; o resultado está no campo `ok`.

**Opção A — console do navegador (é exatamente como o app vai chamar):**
abra qualquer página comum (ex.: `https://example.com`), pressione **F12 → Console** e cole:

```js
const URL = 'https://script.google.com/macros/s/SEU_ID/exec';
const TOKEN = 'SEU_TOKEN';
const chamar = corpo => fetch(URL, { method: 'POST', body: JSON.stringify(corpo) }).then(r => r.json());

// 1. Token inválido → { ok: false, erro: "Token inválido." }
await chamar({ token: 'errado', action: 'pull', since: 0 });

// 2. Push de uma tag de teste (excluido: true para o app ignorar)
await chamar({ token: TOKEN, action: 'push', ops: [{ table: 'tags', row: {
  id: 'teste-console', nome: 'teste console', cor: 'c2', ordem: 0,
  atualizadoEm: Date.now(), excluido: true } }] });
// → { ok: true, serverTime: ..., results: [{ table: "tags", id: "teste-console", status: "aplicado" }] }

// 3. Pull completo → { ok: true, serverTime, pendencias: [...], observacoes: [...], tags: [...] }
await chamar({ token: TOKEN, action: 'pull', since: 0 });
```

(Enviar uma string como `body` faz o navegador usar `Content-Type: text/plain`, que não
dispara preflight CORS.)

**Opção B — PowerShell (Windows):**

```powershell
$url = 'https://script.google.com/macros/s/SEU_ID/exec'
$token = 'SEU_TOKEN'

# Token inválido
Invoke-RestMethod -Uri $url -Method Post -ContentType 'text/plain' -Body '{"token":"errado","action":"pull","since":0}'

# Pull
$body = @{ token = $token; action = 'pull'; since = 0 } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri $url -Method Post -ContentType 'text/plain' -Body $body | ConvertTo-Json -Depth 5
```

**Opção C — curl (Git Bash):** o `-L` é obrigatório, porque o Apps Script responde com um
redirecionamento para `script.googleusercontent.com`.

```bash
URL='https://script.google.com/macros/s/SEU_ID/exec'
TOKEN='SEU_TOKEN'

curl -sL -H 'Content-Type: text/plain' -d '{"token":"errado","action":"pull","since":0}' "$URL"

curl -sL -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$TOKEN\",\"action\":\"pull\",\"since\":0}" "$URL"
```

Depois dos testes, apague à mão as linhas `teste-…` da aba `tags`, se quiser.

### 1.8 Republicar depois de alterar o código

Sempre que o `Code.gs` mudar:

1. Cole o código novo no editor e salve.
2. **Implantar → Gerenciar implantações**.
3. Selecione a implantação existente (ex.: "v1") e clique no **lápis (Editar)**.
4. Em **Versão**, escolha **Nova versão** (descrição: `v2`, `v3`…).
5. **Implantar**.

A URL `/exec` **continua a mesma** — nada muda nos aparelhos. Atenção: **Nova implantação**
cria uma URL diferente; use sempre "Gerenciar implantações → Editar".

### 1.9 Problemas comuns

| Resposta / sintoma | Causa e solução |
|---|---|
| `Token inválido.` | Token copiado errado (espaço sobrando?). Confira em Propriedades do script. |
| `Token não configurado no servidor…` | Rode `setupToken()`. |
| `Aba "…" não encontrada` / `sem a(s) coluna(s)` | Rode `setupSheets()`. |
| `Servidor ocupado…` | Duas sincronizações ao mesmo tempo demoraram; o app tenta de novo sozinho. |
| Página HTML do Google em vez de JSON | URL errada (`/dev` ou sem `/exec`), ou acesso não está como "Qualquer pessoa". |
| `Script function not found: doGet` | A URL foi aberta no navegador (GET). Normal: a API só aceita POST. |
| Mudança no código não surtiu efeito | Faltou republicar com **Nova versão** (1.8). |

---

## 2. Rodar o app localmente

O app é estático (HTML + CSS + JS, sem build). Basta servir a pasta por HTTP — abrir o
`index.html` direto do disco (`file://`) não funciona, porque módulos ES exigem HTTP.

No terminal, dentro da pasta do projeto:

```powershell
npx serve -l 8137        # Node (baixa o "serve" na primeira vez)
# ou
python -m http.server 8137
```

Abra **http://localhost:8137**. `localhost` é um "contexto seguro" para o navegador, então
IndexedDB, `crypto.randomUUID` e `navigator.storage.persist()` funcionam como em produção.

- Os dados ficam no IndexedDB **deste navegador, nesta origem** (`localhost:8137`). Outra porta
  ou outro navegador = outra base, vazia.
- Para zerar os dados de teste: **Configurações → Armazenamento → Apagar dados deste aparelho**
  (limpa pendências, observações, tags, fila de envio e o cursor de sincronização; mantém URL,
  token e preferências).
- O teste no celular é feito pelo GitHub Pages (seção 6).
- **Service worker:** depois da primeira visita, o app passa a abrir do cache, inclusive em
  `localhost`. Se você editar algum arquivo, suba a versão em `sw.js` ou use DevTools →
  **Application → Service workers → Update on reload** para ver a mudança.

## 3. Conectar o app à planilha

1. No app: **Configurações** (engrenagem, ou toque no indicador de status no topo).
2. Em **Sincronização**, cole a **URL do App da Web** (a que termina em `/exec`, do passo 1.6) e o
   **token** (passo 1.4). Use "Mostrar" para conferir o token.
3. **Conectar e sincronizar.**
   - Se este aparelho já tem dados que nunca foram sincronizados, o app pergunta antes de
     enviar qualquer coisa: **Enviar para a planilha** · **Apagar e baixar da planilha** ·
     **Cancelar**. Para dados de teste, escolha **Apagar e baixar** (nada local sobe).
4. Repita em cada aparelho (desktop, celular), com a **mesma** URL e o **mesmo** token.

A URL e o token ficam só no `localStorage` de cada aparelho — nunca em arquivos do projeto.

**Indicador no topo:** Sincronizado (verde) · Pendente (n) (laranja: alterações aguardando
envio) · Sincronizando… (pulsando) · Offline (anel vazio) · Erro (vermelho; toque para ver a
mensagem em Configurações) · Neste aparelho (sem planilha conectada).

**Quando sincroniza:** ao abrir o app; ~2 s depois de cada alteração; ao voltar para a aba; ao
reconectar à internet; a cada 60 s com a aba visível; e no botão **Sincronizar agora**.

**Conflitos:** vale a alteração mais recente de cada item (last-write-wins por `atualizadoEm`).
Uma edição feita offline e enviada depois **perde** para uma edição mais nova feita em outro
aparelho nesse meio-tempo.

## 4. Roteiro de teste da sincronização

Use a planilha real com dois "aparelhos": duas janelas de perfis diferentes do Chrome (ou uma
normal e uma anônima), ambas em `http://localhost:8137`, conectadas com a mesma URL e token.
Chame-as de **A** e **B**.

**0. Começar limpo.** Em A, se houver dados de teste: Configurações → **Apagar dados deste
aparelho** → Apagar. Depois conecte (seção 3). Em B, conecte também. Os dois mostram o mesmo
conteúdo e o indicador "Sincronizado".

**1. Criar offline e voltar online (em A)**
1. DevTools (F12) → aba **Network** → seletor de rede → **Offline**. O indicador vira "Offline".
2. Crie "teste offline 1" e "teste offline 2"; edite o título de um item existente.
   Indicador: "Offline" (Configurações mostra "N alterações na fila").
3. Volte para **No throttling**. Em ~1 s o indicador passa por "Sincronizando…" e fica
   "Sincronizado", sem clicar em nada.
4. Em B: volte para a janela (ou clique em **Sincronizar agora**). Os itens aparecem.
5. Na planilha, aba `pendencias`: as linhas novas estão lá, com `servidorEm` preenchido.

**2. Editar o mesmo item nos dois**
1. Em A, renomeie o item X para "versão A". Espere "Sincronizado".
2. Em B, renomeie o mesmo item para "versão B". Espere "Sincronizado".
3. Em A, **Sincronizar agora** → mostra "versão B" (a mais recente vence).
4. Variante offline: deixe B **Offline**, renomeie X para "B offline"; depois, em A (online),
   renomeie X para "A depois". Volte B para online → B passa a mostrar "A depois" (a edição
   offline era mais antiga e foi descartada pela planilha).

**3. Excluir em um e conferir no outro**
1. Em A, abra um item → **Excluir** → **Excluir**.
2. Em B, **Sincronizar agora** → o item some.
3. Na planilha, a linha continua lá com `excluido = TRUE` (a exclusão é lógica, para todos os
   aparelhos saberem dela).

**4. Conferir a planilha**
- `pendencias`: `tags` com ids separados por `;`; `foco/feito/aguardando/excluido` em
  TRUE/FALSE; `atualizadoEm` e `servidorEm` em milissegundos.
- `observacoes`: crie uma observação "ok algo" em A → linha com `tipo = ok`.
- `tags`: crie/renomeie uma tag em A → aparece em B com a mesma cor.

**5. Apagar dados com fila pendente**
1. Em B, fique Offline e edite algo (indicador "Offline", 1 alteração na fila).
2. Configurações → **Apagar dados deste aparelho**: a confirmação avisa
   "1 alteração ainda não sincronizada será perdida". Apagar.
3. A lista fica vazia na hora (sem recarregar). Volte online → B baixa de novo da planilha, sem a
   edição apagada.

**Erros:** com token errado o indicador fica "Erro" e Configurações mostra
"Último erro: Token inválido."; corrija o token e salve (não pergunta de novo, porque a URL é a
mesma).

## 5. Publicar no GitHub Pages

Repositório: `marquesarao/pendencias` (público), branch `main`, raiz do repo.
URL final: **https://marquesarao.github.io/pendencias/**

Todos os caminhos do app, do manifest e do service worker são relativos: o mesmo código roda em
`/pendencias/` e em `http://localhost:8137/`.

### 5.1 Antes de cada push: nenhum segredo no repositório

O repositório é público. **Nunca** podem ir para ele:

- o **token** do Apps Script;
- a **URL `/exec`** real do seu Web App (o ID começa com `AKfy…`);
- capturas de tela ou exports com esses valores.

Eles só existem nas Propriedades do script (Google) e no `localStorage` de cada aparelho.
Depois do `git add`, confira o que vai subir (os dois comandos devem voltar **vazios**):

```powershell
# 1) Alguma URL /exec real? (os exemplos do README usam SEU_ID, que não casa com o padrão)
git grep --cached -nE "macros/s/[A-Za-z0-9_-]{20,}"

# 2) O token? Troque XXXXXXXX pelos 8 primeiros caracteres do SEU token
#    (digite só no terminal; não salve em arquivo nenhum)
git grep --cached -n "XXXXXXXX"
```

Se algum comando mostrar uma linha, **não faça o push**: tire o valor do arquivo, rode
`git add -A` de novo e repita a conferência.

### 5.2 Primeira publicação

No PowerShell, na pasta do projeto (o repositório já está ligado ao `origin`):

```powershell
cd "C:\Users\leand\OneDrive\Desktop\IA\APP Pendências"
git status
git add -A
git grep --cached -nE "macros/s/[A-Za-z0-9_-]{20,}"
git grep --cached -n "XXXXXXXX"
git commit -m "Fatia 5: PWA (manifest, service worker, ícones) e instruções do GitHub Pages"
git push origin main
```

Depois, no GitHub (uma vez só):

1. Repositório → **Settings** → **Pages** (menu lateral, em "Code and automation").
2. **Build and deployment → Source: Deploy from a branch**.
3. **Branch: `main`**, pasta **`/ (root)`** → **Save**.

### 5.3 Como saber que publicou

- Aba **Actions** do repositório: o fluxo **"pages build and deployment"** fica com ✓ verde
  (leva 1–2 minutos).
- Em **Settings → Pages** aparece "Your site is live at
  **https://marquesarao.github.io/pendencias/**" com o botão **Visit site**.
- Abra a URL no Chrome do desktop → F12 → **Application**:
  - **Manifest**: nome "Pendências", ícones e nenhum erro de instalação;
  - **Service workers**: `sw.js` "activated and is running";
  - **Cache storage**: `pendencias-v1` com o app.
- Em **Configurações → Aplicativo** do app aparece **"Versão v1"**.

O arquivo `.nojekyll` (vazio) faz o GitHub Pages servir os arquivos como estão, sem processá-los.

### 5.4 Publicar uma atualização

1. Faça as mudanças.
2. **Aumente a versão do cache em `sw.js`**: `const VERSAO = 'v1';` → `'v2'` (depois `'v3'`…).
   Sem isso, os aparelhos continuam usando a versão antiga em cache.
   Se criou um arquivo novo (um módulo JS, por exemplo), acrescente-o à lista `SHELL` do `sw.js`.
3. Faça a conferência de segredos (5.1), o commit e o push:
   ```powershell
   git add -A
   git grep --cached -nE "macros/s/[A-Za-z0-9_-]{20,}"
   git commit -m "Descreva a mudança (cache v2)"
   git push origin main
   ```
4. Espere o ✓ verde em **Actions**.
5. Nos aparelhos: ao abrir o app (ou voltar para ele), aparece o aviso
   **"Nova versão disponível · Atualizar"** (também em Configurações → Aplicativo). Ao tocar, o
   app recarrega uma vez e passa a mostrar a versão nova. Os dados não são afetados.

## 6. Roteiro de teste no celular (Android)

**Instalar**
1. No Chrome do Android, abra **https://marquesarao.github.io/pendencias/**.
2. Aparece (uma única vez) o aviso "Instale o Pendências…" → **Instalar**. Se não aparecer:
   **Configurações → Aplicativo → Instalar app**, ou menu ⋮ do Chrome → **Instalar app**.
3. Feche o Chrome e abra o app **pelo ícone** na tela inicial: abre em tela cheia, sem barra de
   endereço. Configurações → Aplicativo mostra **"Instalado"**.

**Conectar à planilha**
4. Para colar URL e token sem digitar: mande os dois para você mesmo por um canal **privado**
   (ex.: "Mensagens para mim mesmo" do WhatsApp, ou um e-mail para você), copie no celular e
   **apague a mensagem depois**. Não use grupos nem notas compartilhadas.
5. Configurações → Sincronização → cole a URL e o token → **Conectar e sincronizar**.
6. Se o celular já tiver itens de teste, o app pergunta: escolha **Apagar e baixar da planilha**.
   As pendências do desktop aparecem; o indicador fica "Sincronizado".

**Offline**
7. Ative o **modo avião**. Feche o app e abra de novo pelo ícone: abre normalmente, indicador
   "Offline".
8. Crie um item ("teste avião"). Desative o modo avião: em alguns segundos, "Sincronizado".
9. No desktop, **Sincronizar agora** (ou volte para a aba): "teste avião" aparece.

**Teclado e toque**
10. Na captura, digite um texto e toque na tecla **Enviar** do teclado virtual: o item é criado.
11. Abra um item, escreva uma observação e toque em **Enviar**: a observação entra.
12. **Arraste por toque**: segure uma linha ~300 ms (vibra de leve) e arraste — dentro de um grupo
    e dentro do "Em foco". Solte e confira a ordem; reabra o app: a ordem continua.
13. Deslizar rápido sobre a lista **rola** a página (não arrasta).
14. Abra um item e **role a lista**: o item continua aberto. Depois **toque fora** dele: recolhe.
    Toque no título e no botão ⌃ (Fechar) também recolhem.

**Armazenamento**
15. Configurações → Armazenamento: depois de instalar, deve aparecer **"Persistente"** (o app pede
    de novo ao instalar). Se ainda estiver "Não persistente", toque em **Pedir de novo**.

**Atualização (na próxima publicação)**
16. Depois de publicar uma versão nova (5.4), abra o app: aviso "Nova versão disponível ·
    Atualizar" → tocar → recarrega uma vez, e Configurações mostra a versão nova.
