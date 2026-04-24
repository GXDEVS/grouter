# Problemas e Mitigações

## 1. Dependências Crowd-Sourced

- **Pacote `bun`** usa conjuntos não monoglass (bundled). Se houver multiplos prototipos, 
pode haver **conflicts** de versions. Editor deve manter a mesma `bun` versión
(ver `bash run check-bun.sh`).

## 2. Biblioteca de Ingredientes

- O repositório requer **Browser‑runtime** specifically 
`@inquirer/prompts` – incompatibilidade pode gerar **botlenecks** no 
renderizado de *UI*. Mantém versão stable (`^8.4.1`).

## 3. Dados de Segurança

- Token OAuth **rotativo** em `~/.grouter/grouter.db`; 
@02/03/2026 expirou. Há risco de **authorization errors**. Agend. Rotations.

## 4. Manutenção de Performance

- **Log files** > 1 GB podem tornar `bun serve` lento. 
Implemente log rotation (systemd `systemd-journald`).

## 5. Arquivo de Configuração

- O `/etc/grouter/config.yml` deve ter `port: 3099`. 
Se alterado, o proxy **falha** antes de iniciar. Aleve a configuração.

## 6. Testes de Integração

- Não consta nenhum teste de integração em `tests/`.
Recomenda‑se criar um para a rota `/v1/chat/completions`.

---

**Mitigações**

- **Verificar** o `bun` e as dependências via `bun check`. 
- **Atualizar** tokens OAuth periodicamente. 
- **Ativar** log rotation com `systemd`. 
- **Adicionar** testes de integração (p.ex. `chat-completions.test.ts`). 
- **Reconfigurar** `config.yml` para garantir a porta 3099.