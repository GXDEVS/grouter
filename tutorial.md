# grouter — Docker Tutorial

Fluxo Docker completo para rodar o `grouter` (proxy OpenAI-compatible multi-provider) em container, com instalação fácil e dados persistentes.

## Arquivos criados

| Arquivo | Propósito |
|---|---|
| `Dockerfile` | Multi-stage (builder + runtime Alpine). Usuário não-root `grouter`, `HOME=/data` → SQLite persiste em `/data/.grouter`. `tini` como PID 1, healthcheck em `/health`, `ENTRYPOINT grouter` (passa subcomandos), `CMD serve fg`. |
| `.dockerignore` | Mantém o contexto de build enxuto (ignora `node_modules`, `dist`, `.git`, etc). |
| `docker-compose.yml` | Expõe `3099` (router + dashboard) + range `3100-3110` (per-provider), volume `./data:/data`, restart automático, TTY ligado para `grouter add`. |
| `scripts/docker-install.sh` | Instalador one-shot: valida docker, builda, sobe, espera `/health` e imprime os próximos passos. |
| `package.json` | Novos scripts: `docker:install`, `docker:up`, `docker:down`, `docker:logs`, `docker:add`, `docker:shell`, `docker:rebuild`. |

## Instalação rápida

```bash
# opção 1 — via script npm/bun
bun run docker:install

# opção 2 — direto
bash scripts/docker-install.sh
```

O script faz build + up + aguarda `/health` ficar OK e imprime os endpoints.

## Comandos do dia a dia

```bash
# sobe / desce
bun run docker:up            # docker compose up -d
bun run docker:down          # docker compose down   (dados persistem em ./data)

# adicionar provider (interativo)
bun run docker:add           # docker compose exec grouter grouter add

# outros comandos do CLI dentro do container
docker compose exec grouter grouter list
docker compose exec grouter grouter models
docker compose exec grouter grouter status
docker compose exec grouter grouter test

# logs
bun run docker:logs          # docker compose logs -f grouter

# shell dentro do container
bun run docker:shell         # docker compose exec grouter sh

# rebuild após mudanças no código
bun run docker:rebuild
```

## Endpoints expostos

| URL | Descrição |
|---|---|
| `http://localhost:3099/dashboard` | Dashboard web (adicionar/gerenciar contas) |
| `http://localhost:3099/v1` | API OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) |
| `http://localhost:3099/health` | Healthcheck |
| `http://localhost:3100-3110` | Listeners per-provider (pin de provider por porta) |

Exemplo com qualquer SDK OpenAI:

```bash
export OPENAI_BASE_URL="http://localhost:3099/v1"
export OPENAI_API_KEY="anything"   # o proxy ignora; rota pelas contas armazenadas
```

## Persistência

Tudo fica em `./data/` no host (mapeado para `/data` no container):

```
./data/.grouter/
  ├── grouter.db        # SQLite com contas, tokens, locks, config
  ├── server.log        # logs do daemon
  └── server.pid        # PID do processo (gerenciado pelo grouter)
```

Backup = copiar a pasta `./data/`.
Restore = colar a pasta de volta antes de subir.

## OAuth dentro do container

- **Device-code** (Qwen, GitHub Copilot, etc.): funciona normalmente via
  `docker compose exec grouter grouter add` — o código é exibido no terminal
  e você autoriza no navegador do host.
- **Authorization-code com callback** (Claude, Codex, GitLab, iFlow): o
  callback vai para uma porta efêmera em `127.0.0.1` dentro do container, que
  o navegador do host não alcança. Duas opções:
  1. Rode `grouter add` fora do Docker só para autenticar, depois copie
     `~/.grouter/grouter.db` para `./data/.grouter/`.
  2. Use API key / import token pelo dashboard web em
     `http://localhost:3099/dashboard`.

## Detalhes do Dockerfile

- **Base**: `oven/bun:1.2-alpine` (imagem final ~80 MB).
- **Multi-stage**: builder roda `bun install` + `bun run build` → gera
  `dist/grouter` (binário único com logos embutidos e HTML estático).
  Runtime copia só o binário — sem `node_modules`, sem sources.
- **Segurança**: usuário não-root `grouter`, sem shell sobrando.
- **Signals**: `tini` como PID 1 → `docker stop` encerra limpo (SIGTERM é
  propagado, o daemon fecha as portas corretamente).
- **Healthcheck**: `wget http://127.0.0.1:3099/health` a cada 30s.

## Variáveis de ambiente úteis

| Variável | Default | O que faz |
|---|---|---|
| `TZ` | `UTC` | Fuso horário (afeta timestamps nos logs) |
| `HOME` | `/data` | Raiz do SQLite (`$HOME/.grouter/grouter.db`). **Não mude** a menos que ajuste o volume também. |
| `GROUTER_IN_DOCKER` | `1` | Flag informativa, disponível para o código detectar o ambiente. |

Defina `TZ` pelo `.env` ou na linha de comando:

```bash
TZ=America/Sao_Paulo docker compose up -d
```

## Troubleshooting

**Porta 3099 já em uso**
Mude o mapeamento em `docker-compose.yml`:
```yaml
ports:
  - "8099:3099"    # agora use http://localhost:8099
```

**Container reinicia em loop**
```bash
docker compose logs --tail=100 grouter
```
Causa comum: `./data/.grouter/grouter.db` corrompido — remova e recomece.

**Permissão negada em `./data/`**
O container roda com UID do usuário `grouter` (Alpine). Se o host tem UID
diferente, ajuste:
```bash
sudo chown -R $(id -u):$(id -g) ./data
```

**Rebuild não pega mudanças**
```bash
docker compose build --no-cache
docker compose up -d --force-recreate
```

## Desinstalar

```bash
docker compose down              # para o container
docker rmi grouter:latest        # remove a imagem
rm -rf ./data                    # remove os dados (irreversível)
```
