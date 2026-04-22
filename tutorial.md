# grouter - Docker Tutorial

Guia completo para rodar o `grouter` em container, com dados persistentes e fluxo de operacao diario.

## Arquivos principais

| Arquivo | Funcao |
|---|---|
| `Dockerfile` | Build multi-stage (builder + runtime Alpine), usuario nao-root e `HOME=/data` para persistir SQLite |
| `.dockerignore` | Reduz contexto de build |
| `docker-compose.yml` | Expoe `3099` (router/dashboard) e `3100-3110` (ports por provider), com volume `./data:/data` |
| `scripts/docker-install.sh` | Instalacao one-shot (build + up + healthcheck) |
| `package.json` | Scripts `docker:*` para uso diario |

## Instalacao rapida

```bash
# opcao 1
bun run docker:install

# opcao 2
bash scripts/docker-install.sh
```

## Comandos do dia a dia

```bash
# subir / descer
bun run docker:up
bun run docker:down

# logs
bun run docker:logs

# shell no container
bun run docker:shell

# adicionar conexao (interativo)
bun run docker:add

# rebuild
bun run docker:rebuild
```

## Endpoints

| URL | Descricao |
|---|---|
| `http://localhost:3099/dashboard` | Dashboard web |
| `http://localhost:3099/v1` | API OpenAI-compatible |
| `http://localhost:3099/health` | Healthcheck |
| `http://localhost:3100-3110` | Listeners por provider |

Exemplo com SDK OpenAI:

```bash
export OPENAI_BASE_URL="http://localhost:3099/v1"
export OPENAI_API_KEY="anything"
```

## Persistencia

Tudo fica em `./data/` no host (mapeado para `/data` no container):

```text
./data/.grouter/
  |- grouter.db
  |- server.log
  `- server.pid
```

## OAuth no container

- Device code (ex.: GitHub Copilot) funciona normalmente via terminal.
- Authorization code com callback local pode exigir fluxo alternativo:
1. autenticar fora do Docker e copiar DB para `./data/.grouter/`, ou
2. usar API key/import token no dashboard.

## Troubleshooting rapido

**Porta 3099 em uso**

Altere mapeamento no `docker-compose.yml`:

```yaml
ports:
  - "8099:3099"
```

**Container reiniciando**

```bash
docker compose logs --tail=100 grouter
```

**Permissao em `./data/`**

```bash
sudo chown -R $(id -u):$(id -g) ./data
```

**Rebuild nao aplicou mudancas**

```bash
docker compose build --no-cache
docker compose up -d --force-recreate
```

## Desinstalar

```bash
docker compose down
docker rmi grouter:latest
rm -rf ./data
```

