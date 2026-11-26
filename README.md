# CSF Squad Monitor

**CSF Agent Squad** é a iniciativa de squad agêntica do Banco Carrefour. O **CSF Squad Monitor** é a extensão do VS Code que permite acompanhar essa squad no GitHub Copilot. Cada seta indica quem delegou a tarefa. Selecione um agente para ver a ferramenta que ele usou. O painel recebe eventos dos hooks locais do Copilot. Pode ser usado em qualquer projeto local compatível, inclusive em projetos sem servidor MCP.

## Instalar

No VS Code 1.109 ou superior, abra a paleta e execute **Extensions: Install from VSIX...**. Selecione o instalador da extensão. Pelo terminal, use `code --install-extension csf-squad-monitor.vsix`. O identificador `agent-catalog-local.mapa-de-agentes` foi preservado para atualizar instalações anteriores.

## Acompanhar uma sessão

1. Abra a pasta do projeto que deseja monitorar em uma janela local confiável do VS Code.
2. Na paleta, execute **CSF Squad Monitor: Abrir painel**. Escolha **Sessão real** e depois **Criar hooks**.
3. Deixe a aba aberta e inicie uma sessão do GitHub Copilot na mesma pasta com os hooks habilitados. O processo que executa os hooks precisa encontrar `node` no PATH.
4. Peça ao Copilot para delegar uma leitura ao Explore. Selecione o nó no mapa para inspecionar o agente pai, o estado e as ferramentas. Em **Saída → CSF Squad Monitor**, é possível conferir a entrega dos eventos.

O coletor envia metadados por um socket local. Os hooks gerados contêm caminhos específicos da máquina e da pasta. Gere-os em cada ambiente. Para desativar a integração de um projeto, remova o arquivo gerado `.github/hooks/mapa-de-agentes.json`.

## CSF Agent Squad — uma tarefa, vários agentes

Para apresentar ao time, abra a gravação e comece com a pergunta **“Quando pedimos ao Copilot para revisar uma entrega, quem faz o quê?”**

1. Selecione **Sessão Copilot**. Na gravação, o orquestrador consulta a definição da tarefa no catálogo de exemplo com `get_agent` e delega a revisão.
2. Selecione **revisor-catalogo-demo**. O revisor lê `entrega.txt` e chama outro agente para conferir o resultado.
3. Selecione **explore**. O painel mostra `view · verificacao.txt` entre as ferramentas usadas e identifica o revisor como quem delegou a conferência.

### Abrir a apresentação

No painel, clique em **Reproduzir demo**. Para rever uma execução gravada, abra o arquivo `examples/revisao.mapa-copilot.json` deste repositório e clique em **Rever execução**. A visualização da gravação funciona offline. Se o VS Code abrir o JSON como texto, use **Reopen Editor With... → CSF Squad Monitor**.

## Desenvolver e gerar o instalador

Abra a raiz deste repositório no VS Code e pressione **F5** para executar a extensão em uma janela de desenvolvimento. Para gerar o VSIX, use Node.js 22 ou superior e npm na raiz do repositório.

```sh
npm ci
npm run package
```

O arquivo `csf-squad-monitor.vsix` será criado na raiz. O comando inclui o painel, o coletor e as mídias locais no pacote.

[Hooks do VS Code](https://code.visualstudio.com/docs/agent-customization/hooks) · [Eventos do GitHub Copilot](https://docs.github.com/en/copilot/reference/hooks-reference)
