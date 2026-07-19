# Análise arquitetural — Plano de Permissões do PDV

> **Documento analisado:** `docs/PLANO_PERMISSOES_PDV.md`  
> **Data da revisão:** 19/07/2026  
> **Escopo:** arquitetura, integração com o código atual, segurança, persistência, rollout, rollback e testes  
> **Resultado:** o conceito é aproveitável, mas o plano precisa de correções antes da Fase 1

## 1. Resumo executivo

A proposta possui uma base coerente:

- manter a configuração no documento `store_profiles/{uid}`;
- usar defaults retrocompatíveis;
- centralizar a normalização e as consultas em um helper;
- aplicar as mudanças gradualmente por aba;
- atualizar o PDV em tempo real;
- evitar hooks condicionais e o retorno antecipado que já causou o erro React #310.

Entretanto, o plano ainda não está suficientemente amarrado para ser implementado literalmente. Os principais riscos são:

1. caminhos de permissões incompatíveis entre o schema e o helper;
2. possibilidade de o PDV ficar sem nenhuma aba utilizável;
3. abertura de abas ocultas por histórico ou navegação indireta;
4. flash de ações liberadas antes do perfil terminar de carregar;
5. perda de alterações locais quando uma permissão é revogada em tempo real;
6. ações sensíveis sem permissão correspondente ou com caminhos alternativos;
7. incompatibilidade com o trabalho de operadores já iniciado nas regras do Firestore;
8. falsa expectativa de segurança em uma fase que restringe apenas a interface;
9. sobrescrita concorrente do mapa completo de permissões;
10. ausência de testes automatizados e de um procedimento de rollback.

O checkout atual passou em:

```text
npm.cmd run typecheck
```

Isso confirma que o código atual está tipado. Não comprova que a futura implementação do plano não causará regressões. O repositório também não possui, neste momento, uma suíte própria de testes configurada para validar permissões, navegação, regras do Firestore ou comportamento em tempo real.

## 2. Bloqueadores antes da Fase 1

### 2.1 Contrato de permissões inconsistente

O modelo proposto usa estruturas como:

```text
tabs.caixa.visible
actions.caixa.sangria
global.toggleDelivery
```

Porém, os exemplos do plano usam:

```text
can(perms, 'caixa.sangria')
can(perms, 'tabs.caixa')
```

Esses caminhos não representam os mesmos dados. Dependendo da implementação, isso pode fazer uma permissão ser sempre liberada:

- `tabs.caixa` retorna um objeto, e o objeto continua sendo truthy mesmo com `visible: false`;
- `caixa.sangria` não existe na raiz e pode cair no default permissivo;
- um erro de digitação pode ser interpretado como “chave ausente = permitido”.

#### Correção recomendada

Adotar um contrato único e tipado. Existem duas opções válidas.

Opção A — manter `visible`:

```text
tabs.caixa.visible
actions.caixa.sangria
global.toggleDelivery
```

Opção B — simplificar abas para booleanos:

```jsonc
{
  "tabs": {
    "caixa": true,
    "delivery": true
  }
}
```

Nesse caso, os caminhos seriam:

```text
tabs.caixa
tabs.delivery
actions.caixa.sangria
global.toggleDelivery
```

Além disso:

- `can()` deve aceitar uma união TypeScript de caminhos válidos;
- ausência de uma chave conhecida pode continuar significando `true` por retrocompatibilidade;
- caminho desconhecido deve falhar no build ou retornar `false` com log de diagnóstico;
- o normalizador deve aceitar somente booleanos válidos e preservar chaves futuras desconhecidas ao salvar.

### 2.2 A validação não impede um PDV vazio

A seção Encomendas só é aplicável ao tema `confeitaria`. Uma loja com outro tema pode ficar com:

```text
caixa = false
delivery = false
novo_pedido = false
mesas = false
encomendas_pedidos = true
```

A validação “existe uma aba marcada” passa, mas nenhuma aba é elegível para aquela loja. O mesmo problema pode surgir se o tema da loja mudar depois da configuração.

#### Correção recomendada

Criar uma única função canônica:

```text
getEligibleTabs(permissions, theme)
```

Ela deve ser usada em todos estes pontos:

- validação da tela da Retaguarda;
- botões do menu do PDV;
- renderização do conteúdo;
- escolha da aba inicial;
- fallback em tempo real;
- navegação do histórico;
- mudança de tema;
- tratamento de configuração inválida ou adulterada fora da UI.

Mesmo com validação na Retaguarda, o PDV precisa tratar explicitamente `eligibleTabs.length === 0`, exibindo uma tela de recuperação em vez de uma tela branca.

### 2.3 A aba inicial proposta quebra a retrocompatibilidade

Atualmente o estado inicial é `delivery`. O plano propõe usar a “primeira aba visível”. Com todas as permissões liberadas, a primeira aba da ordem documentada provavelmente será `caixa`.

Isso viola o critério de que lojas sem `pdvPermissions` devem continuar com comportamento idêntico ao atual.

#### Correção recomendada

Usar a seguinte precedência:

1. `delivery`, quando elegível;
2. a aba anteriormente ativa, quando ainda elegível;
3. a primeira aba de `getEligibleTabs()`;
4. tela controlada de configuração inválida quando nenhuma aba for elegível.

### 2.4 Esconder o botão não impede abrir a aba

O código atual possui outros caminhos que alteram `activeTab`:

- o evento `popstate` chama `setActiveTab()` diretamente;
- Delivery, Balcão e Mesa chamam `handleTabChange('caixa')` por meio de “Abrir Caixa”;
- o conteúdo é renderizado comparando apenas `activeTab`;
- um estado antigo do histórico pode apontar para uma aba que acabou de ser ocultada.

Um efeito de fallback executado somente depois do render também permite que uma aba proibida seja montada por um instante.

#### Correção recomendada

Centralizar toda navegação em algo equivalente a:

```text
selectPdvTab(requestedTab, eligibleTabs)
```

Essa função deve:

- rejeitar ou redirecionar abas inelegíveis;
- sanitizar eventos `popstate`;
- atualizar o histórico com `replaceState` ao corrigir uma aba inválida;
- ser usada pelos botões e pelos callbacks indiretos;
- impedir a própria renderização do conteúdo não autorizado.

O gate do conteúdo deve ser síncrono. Não se deve depender exclusivamente de um `useEffect` posterior para retirar a aba da tela.

### 2.5 Flash permissivo durante o carregamento

O plano define “ausência = liberado”. Essa regra é correta para um documento já carregado sem o novo campo, mas não para `storeProfile === undefined` enquanto o Firestore ainda está resolvendo o snapshot.

Se os dois estados forem tratados igualmente, o PDV pode mostrar todas as abas e ações por alguns instantes, inclusive com botões clicáveis.

#### Correção recomendada

Separar estes estados:

1. perfil ainda carregando;
2. perfil carregado sem `pdvPermissions`;
3. perfil carregado com configuração parcial;
4. erro ao carregar o perfil.

Enquanto o primeiro snapshot não estiver resolvido, o PDV não deve renderizar ações mutáveis. Pode manter uma estrutura visual estável com skeleton ou loader.

### 2.6 Revogação em tempo real pode perder dados locais

A aba Mesa mantém alterações locais e já possui confirmação ao trocar de aba. Se o administrador ocultar Mesa remotamente, existem duas possibilidades problemáticas:

- chamar diretamente `setActiveTab()` desmonta a aba e perde o rascunho;
- reutilizar a confirmação atual permite que o operador cancele a saída e permaneça numa aba já revogada.

Modais já abertos também permanecem perigosos. Por exemplo, uma Sangria iniciada antes da revogação pode continuar sendo confirmada depois que o botão sumiu.

#### Correção recomendada

Definir uma política explícita para revogação:

- a revogação prevalece sobre a navegação local;
- novos submits são bloqueados imediatamente;
- handlers verificam a permissão atual antes de qualquer escrita;
- modais sensíveis são fechados ou passam a exibir um aviso de permissão revogada;
- estados internos incompatíveis são zerados, como histórico de caixa e edição de itens;
- rascunhos são descartados ou preservados conforme uma decisão de produto documentada;
- o operador recebe uma mensagem clara sobre o que aconteceu.

## 3. Lacunas na matriz de ações

O plano precisa classificar cada ação do código atual como:

- controlada por uma permissão;
- sempre permitida;
- derivada de outra permissão;
- indisponível quando uma dependência não estiver liberada.

Sem essa classificação, novos gates dão uma sensação de cobertura maior do que a cobertura real.

### 3.1 Caixa

Além das ações já listadas, precisam de decisão explícita:

- reativar uma venda cancelada;
- imprimir comprovantes e prévias;
- abrir uma sessão histórica diretamente;
- continuar numa sessão histórica quando `verCaixasAnteriores` for revogada;
- abrir Caixa por callbacks vindos de outras abas;
- vendas ou lançamentos manuais eventualmente acessíveis pelo mesmo modal genérico.

Reativação pode compartilhar `cancelarVenda`, mas isso deve estar documentado e protegido no handler.

### 3.2 Delivery

Também existem:

- mudar para Recebido;
- mudar para Pronto;
- marcar saída para entrega;
- atribuir ou trocar motoboy;
- imprimir ao mudar status;
- cadastrar rapidamente um cliente;
- editar itens com modal já aberto;
- finalizar pedido já registrado como pago.

É necessário esclarecer se `imprimirCupom` controla somente um botão manual ou também impressões disparadas como efeito de outra ação.

### 3.3 Balcão

`criarPedido` é um nome ambíguo, pois o botão visível é “Finalizar” e a escrita ocorre na confirmação do pagamento.

O gate deve alcançar:

- o botão que abre o fechamento;
- o handler que confirma e cria o pedido;
- callbacks de cadastro rápido que voltam a chamar a confirmação;
- formas de pagamento permitidas;
- desconto e acréscimo existentes no estado do fechamento.

Se a permissão for revogada com o modal aberto, esconder somente o botão original não basta.

### 3.4 Mesas

A matriz atual não classifica:

- cancelar mesa;
- rejeitar/excluir pedido online;
- trocar ou atribuir mesa;
- reabrir uma mesa;
- imprimir conta parcial;
- alterar cliente da comanda;
- pagamento a Prazo;
- desconto e acréscimo;
- aceitar pedido online com impressão acoplada.

`abrirMesa`, `lancarItens`, `fecharComanda` e `aceitarPedidoOnline` não cobrem claramente todas essas operações.

### 3.5 Encomendas

O componente correto do PDV é:

```text
src/components/admin/EncomendasPedidosTab.tsx
```

O mapeamento atual aponta genericamente para `src/components/encomendas/*`, o que pode deixar o componente efetivamente renderizado sem gates.

Também existe um bypass concreto: o diálogo Editar contém o campo de status. Assim, `mudarStatus = false` com `editarEncomenda = true` ainda permite alterar o status.

Além disso, confirmar uma encomenda pode lançar um sinal financeiro. É necessário decidir se isso pertence a:

- `mudarStatus`;
- uma nova permissão `lancarSinal`;
- uma combinação de duas permissões.

### 3.6 Fechamento compartilhado

Delivery, Balcão e Mesa reutilizam:

```text
src/components/admin/fechamento/FechamentoModal.tsx
src/components/admin/fechamento/useFechamento.ts
src/components/admin/fechamento/payment-methods.ts
```

Desconto, acréscimo, múltiplos pagamentos e Prazo vivem nessa camada compartilhada. Portanto, essas permissões não podem ser implementadas somente nos três componentes de aba.

O fechamento precisa receber capacidades explícitas ou trabalhar com dados já filtrados, por exemplo:

```text
allowAdjustments
allowSplitPayment
allowedPaymentMethodIds
```

Também deve zerar estados proibidos. Apenas esconder os controles não pode deixar um desconto anterior ou `conta_casa` selecionado no objeto do hook.

## 4. Integração com a Retaguarda

A nova tela não está totalmente amarrada à estrutura real de `gestao/page.tsx`.

O wrapper principal usa condições baseadas no ID da aba. Um novo ID `permissoes_pdv` pode cair em um container oculto. Renomeá-lo para `perfil_permissoes_pdv` também não resolve sozinho, pois o catch-all atual para `perfil_*` renderiza `StoreProfileTab`.

O plano deve declarar exatamente:

- o ID final da aba;
- onde ela é renderizada;
- qual condição de visibilidade do wrapper será alterada;
- como o grupo da sidebar ficará ativo;
- como evitar que o catch-all de `perfil_*` renderize dois componentes;
- como o estado do histórico da Retaguarda tratará esse ID.

## 5. Estado atual de operadores

No checkout revisado, `firestore.rules` já continha alterações não commitadas para:

```text
roles_operador
isOperator()
isActiveOperator()
isOperatorOf(ownerId)
isStaffOf(ownerId)
```

Isso contradiz a premissa do plano de que não existem operadores.

Ao mesmo tempo, o restante da aplicação ainda não está preparado para esse papel:

- o layout compartilhado de `/pdv` e `/gestao` exige `roles_admin`;
- as consultas do PDV usam `user.uid` como `ownerId`;
- vários hooks e componentes também assumem que o usuário autenticado é o dono;
- `/gestao` e `/pdv` compartilham o mesmo guard;
- as permissões propostas são por loja, não por operador.

Um operador autenticado seria barrado pelo layout. Se o guard fosse relaxado isoladamente, ele consultaria dados usando o UID do operador em vez do UID da loja.

### Decisão necessária

Antes da Fase 1, escolher uma destas linhas:

1. manter esta entrega estritamente como controle visual para o login do dono e tratar operadores em outro plano; ou
2. integrar desde já um contexto de acesso que resolva `role`, `ownerId` e permissões.

Se a segunda opção for escolhida, recomenda-se uma camada central equivalente a:

```text
PdvAccessContext {
  role: 'owner' | 'operator'
  ownerId: string
  permissions: PdvPermissions
  isLoading: boolean
}
```

Todas as consultas e escritas do PDV devem usar `ownerId`, e não assumir `user.uid`.

## 6. Segurança

### 6.1 Fases 1–3 não são autorização real

Com o mesmo usuário Firebase no PDV e na Retaguarda:

- esconder um botão não impede abrir `/gestao` pela URL;
- esconder uma ação não impede chamadas diretas ao SDK do Firestore;
- checagens em handlers continuam sendo lógica executada no cliente;
- as regras do Firestore não consultam `pdvPermissions` para autorizar cada operação.

As primeiras fases devem ser descritas como:

> controles de interface e prevenção de alterações acidentais

Não devem afirmar que operações sensíveis estão protegidas contra um usuário mal-intencionado.

### 6.2 PIN no `store_profiles` não é proteção real

As regras atuais permitem leitura pública de `store_profiles`. Um hash de PIN de 4–6 dígitos nesse documento pode ser obtido e quebrado offline rapidamente.

Se o PIN continuar totalmente client-side, ele deve ser tratado apenas como fricção de uso.

Uma proteção melhor exigiria:

- segredo em documento não público ou backend;
- verificação server-side;
- hash apropriado para senha, com salt;
- rate limiting;
- sessão curta após a validação;
- política separada de `global.botaoRetaguarda`.

Mesmo assim, enquanto o mesmo login Firebase continuar com acesso amplo aos dados, o PIN não substitui autorização por identidade e regras.

### 6.3 Login de operador

Para proteção real, a evolução deve cobrir:

- identidade separada;
- resolução segura do `ownerId`;
- guard diferente para `/pdv` e `/gestao`;
- regras do Firestore compatíveis com cada ação;
- perfil de permissões por loja, papel ou operador;
- APIs e webhooks que não confiem em IDs enviados livremente pelo cliente;
- testes no emulador das regras do Firestore.

A afirmação de que o modelo atual “já nasce compatível” só é verdadeira se todos os operadores da loja compartilharem exatamente o mesmo perfil. Ela não vale para permissões por operador, máquina ou turno.

## 7. Persistência e concorrência

O plano propõe:

```text
updateDoc(storeProfileRef, { pdvPermissions: objetoCompleto })
```

Isso substitui o mapa `pdvPermissions` inteiro. Não há merge recursivo dos subcampos.

Riscos:

- duas sessões da Retaguarda salvam versões diferentes;
- uma versão antiga do PWA remove chaves novas;
- uma seção escondida pelo tema volta aos defaults e sobrescreve valores anteriores;
- remover acidentalmente uma chave `false` reabre a ação por causa do default permissivo;
- uma atualização remota chega enquanto o formulário possui mudanças locais.

### Correção recomendada

Adicionar metadados:

```jsonc
{
  "pdvPermissions": {
    "schemaVersion": 1,
    "revision": 3,
    "updatedAt": "server timestamp",
    "updatedBy": "uid",
    "tabs": {},
    "actions": {},
    "global": {}
  }
}
```

E escolher uma estratégia:

- atualizar somente caminhos folha alterados; ou
- usar transação e rejeitar o save quando `revision` mudou; ou
- carregar novamente e pedir confirmação antes de sobrescrever uma versão mais nova.

O formulário deve preservar chaves desconhecidas e não salvar antes de o primeiro snapshot estar resolvido.

## 8. Rollout recomendado

A ordem atual publica a tela que escreve configurações antes de todos os leitores estarem implementados. Isso deixa a produção em estados parciais e permite que a interface prometa bloqueios que ainda não funcionam.

### Ordem mais segura

#### Fase A — contrato e testes

- fechar a matriz de ações;
- resolver a decisão sobre operadores;
- definir tipos e caminhos válidos;
- implementar normalização;
- implementar `getEligibleTabs()`;
- adicionar testes unitários.

#### Fase B — leitores sem UI de escrita

- aplicar gates no menu, conteúdo, histórico e handlers;
- tratar loading e configuração inválida;
- proteger o fechamento compartilhado;
- manter tudo atrás de uma feature flag ou `enabled = false`.

#### Fase C — validação sem regressão

- typecheck e build;
- testes de componentes;
- testes E2E de navegação e tempo real;
- testes das regras no Firebase Emulator;
- provar que uma loja sem o campo continua abrindo em Delivery.

#### Fase D — tela da Retaguarda

- liberar somente controles já consumidos pelo PDV;
- detectar conflito de revisão;
- incluir botão de restaurar defaults;
- incluir resumo das dependências e alertas de lockout.

#### Fase E — canário

- ativar em uma loja controlada;
- monitorar erros, navegação, impressão e perda de rascunho;
- validar em duas máquinas com atualização em tempo real;
- somente depois liberar para as demais lojas.

#### Fase F — proteção por identidade

- concluir login de operador;
- separar guards;
- aplicar autorização real nas regras e/ou backend;
- migrar do perfil único caso sejam necessárias permissões por operador.

## 9. Rollback mínimo

O plano deve incluir:

- kill switch para o PDV ignorar `pdvPermissions`;
- feature flag global ou por loja;
- snapshot da configuração anterior;
- botão de restaurar todos os defaults;
- procedimento de rollback de código;
- procedimento para configuração inválida;
- definição do que acontece com campos já salvos após o rollback;
- monitoramento de erros React, Firestore e impressão.

O rollback normal não deve apagar o campo. Ele deve desativar seu consumo, preservando os dados para diagnóstico ou reativação futura.

## 10. Matriz mínima de testes

### 10.1 Helper e modelo

- perfil sem `pdvPermissions` libera todas as permissões conhecidas;
- objeto parcial preenche apenas defaults ausentes;
- `false` explícito nunca é convertido em `true`;
- tipos inválidos são normalizados de maneira determinística;
- caminho desconhecido não é liberado silenciosamente;
- chaves futuras são preservadas no save;
- todas as chaves exibidas na UI existem no catálogo tipado.

### 10.2 Abas e navegação

- loja sem configuração continua iniciando em Delivery;
- aba ativa ocultada muda para uma aba elegível;
- `popstate` não reabre aba proibida;
- “Abrir Caixa” não fura uma Caixa oculta ou `abrirCaixa = false`;
- Encomendas não abre fora de `confeitaria`;
- mudança de tema não deixa o PDV vazio;
- configuração adulterada com zero abas mostra recuperação, não tela branca;
- o histórico é corrigido com `replaceState`, sem loop de Back/Forward.

### 10.3 Loading e tempo real

- nenhuma ação proibida aparece antes do primeiro snapshot;
- atualização remota altera o menu sem reload;
- modal aberto é bloqueado quando a permissão é revogada;
- edição de itens aberta não consegue salvar depois da revogação;
- rascunho de Mesa segue a política definida;
- histórico de Caixa é encerrado quando a visualização é revogada;
- não ocorre erro React #310.

### 10.4 Ações granulares

- cada botão é testado individualmente;
- cada handler é testado sem depender do botão;
- desconto e acréscimo não permanecem no estado quando proibidos;
- Prazo desaparece das formas simples e divididas;
- Encomenda não muda status pelo diálogo Editar quando bloqueado;
- confirmar encomenda não lança sinal sem permissão;
- reativação de venda segue a permissão definida;
- impressão manual e automática seguem a política documentada.

### 10.5 Persistência

- erro do `updateDoc` mantém o formulário sujo e mostra feedback;
- duas sessões não sobrescrevem silenciosamente a configuração;
- cliente PWA antigo não remove permissões novas;
- save fora de `confeitaria` preserva configuração de Encomendas;
- documento inexistente possui tratamento explícito;
- restaurar defaults funciona de forma previsível.

### 10.6 Operadores e segurança

- owner continua acessando `/pdv` e `/gestao`;
- operador ativo acessa somente `/pdv`;
- operador inativo é bloqueado;
- consultas do operador usam o `ownerId` da loja;
- operador de uma loja não acessa outra;
- regras rejeitam operações não autorizadas mesmo com chamada direta ao Firestore;
- qualquer PIN server-side possui rate limit e sessão expirada.

## 11. Decisões que precisam ser fechadas

Antes de iniciar a implementação:

1. O objetivo imediato é somente prevenção de acidentes ou segurança contra má-fé?
2. O trabalho de `roles_operador` será integrado agora ou separado?
3. As permissões são por loja, operador, máquina ou turno?
4. Qual é o contrato definitivo dos caminhos de `can()`?
5. Quais ações são sempre permitidas?
6. `imprimirCupom` bloqueia impressão automática ou somente manual?
7. `cancelarVenda` também controla reativação?
8. Qual permissão controla cancelamento e reabertura de Mesa?
9. Qual permissão controla o lançamento de sinal de Encomendas?
10. O que acontece com rascunhos quando uma permissão é revogada?
11. O que acontece quando nenhuma aba é elegível?
12. Qual é a estratégia de conflito entre duas sessões de Retaguarda?
13. Qual feature flag será usada para rollout e rollback?

## 12. Critério para considerar o plano pronto

O plano estará pronto para implementação quando:

- o schema e os caminhos do helper forem únicos e tipados;
- `getEligibleTabs()` estiver especificado;
- a aba inicial Delivery for preservada no cenário retrocompatível;
- navegação direta, indireta e histórica forem cobertas;
- o estado de loading não for confundido com ausência do campo;
- a política de revogação e rascunhos estiver documentada;
- a matriz de ações estiver fechada, incluindo os fluxos compartilhados;
- o estado de `roles_operador` estiver reconciliado com o plano;
- PIN client-side não for apresentado como segurança real;
- persistência concorrente e versionamento estiverem definidos;
- o rollout começar pelos leitores e usar feature flag;
- existir rollback documentado;
- testes automatizados fizerem parte das fases, além dos testes nas lojas.

## 13. Conclusão

O desenho geral pode ser mantido, mas o plano não deve avançar diretamente para a construção da tela. Primeiro é necessário fechar o contrato, as dependências entre ações, a navegação segura e a relação com os operadores já iniciados no Firestore.

Depois dessas correções, a implementação pode continuar incremental por aba, com risco controlado e sem repetir o problema de hooks do React já conhecido pelo projeto.
