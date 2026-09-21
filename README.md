# Manutenção Preditiva (manutencao_preditiva)

**Manutenção Preditiva** — aplicação de manutenção preditiva de ativos construída sobre o
Frappe Framework, instalável num bench com ERPNext.

## Instalação

```bash
bench get-app manutencao_preditiva <repo-url>
bench --site <site> install-app manutencao_preditiva
```

## Inspection reports (vibration)

The source of truth is the **report** the team writes for each client and
month - severity legend, alarm tables, a summary of the area, and one sheet
per equipment with the readings, previous-month comparison, diagnosis and
photos. The Excel "Action Tracker" is only a summary of it, so the app now
models the report itself and produces the Excel from it.

**Workflow**

1. Once: set up the client's **Inspection Area** and **Inspection Equipment**
   (rated power in kW, and its measurement points - `M1H`, `M2H`, `M2A`, ...).
2. Per month: create an **Inspection Report** (customer, area, date, team),
   then *Create Equipment Sheets* - one **Equipment Inspection** per active
   equipment, already carrying its measurement points and, next to them, last
   month's readings.
3. The technician types velocity (mm/s), acceleration (g's) and temperature
   per point. The sheet grades every reading against the alarm tables and
   **suggests** a severity; the analyst confirms or overrides it (bearing
   defects can make an equipment worse than its raw numbers) and adds the
   defects, recommendations and images.
4. Set the report to **Issued**. The *Vibration Report* print format renders
   the full PDF - the counts, percentages and pie are computed from the
   sheets - and the client can now see it.
5. **Action Tracker** (report) lists the sheets with the client's response
   columns; *Export > Excel* gives the summary file.

**Alarm tables** live in *Vibration Alarm Settings* (seeded with the limits of
the current report, FR.TEC.09) and are shared by every client. Velocity limits
depend on the motor's power band; acceleration has a single set; a reading that
reaches a limit is at that severity and below the first limit is Normal. An
equipment can carry a tolerance up to the maximum set there (10%).

**Severity levels:** Normal, Acceptable, Alarm, Critical, Not Collected.

Clients (role *Cliente Portal*) only see a report, and its sheets, once it is
Issued, and can only write the *Client Response* fields.

The severity rules are plain Python in `manutencao_preditiva/vibration.py`;
their tests need no bench:

```bash
python -m unittest manutencao_preditiva.tests.test_vibration
```

The Portuguese modules below (Campanha / Achado / Área / Equipamento,
Registo Rápido, Meus Achados) are the earlier, summary-level model and are
being superseded by the above.

## Módulos

- **Campanha De Inspecao** — cabeçalho de uma ronda de inspeção a um cliente
  (Cliente, Técnica: Vibração/Termografia/…, data, referência do documento).
- **Area De Inspecao** — mestre de áreas/plantas (ex.: "Sala Eléctrica",
  "WCP A"), sempre associado a um Cliente. Nome interno em série (`AP-00001`)
  para não colidir com acentos/formatação do texto - o campo "Área / Planta"
  em si fica livre para editar/pesquisar normalmente. O dropdown em Achado
  De Inspecao filtra automaticamente pelas áreas do mesmo cliente, para o
  técnico não escrever a mesma área de formas diferentes por engano.
- **Achado De Inspecao** — cada defeito/achado encontrado, ligado à campanha
  e à área. Inclui a secção "Resposta do Cliente" (ação tomada, responsável,
  prazo, estado, data de conclusão), editável apenas por quem tem permissão
  de nível 1 nesses campos.

Substitui o fluxo anterior de "1 Excel por cliente" enviado por email: cada
cliente tem um login de Desk restrito, via **User Permission** em Customer,
à sua própria Cliente — vê e actualiza só os seus achados, sem aceder aos
de outros clientes. Papéis: **Tecnico de Inspecao** (equipa interna, acesso
total) e **Cliente Portal** (leitura + resposta apenas).

### Registo Rápido de Achados (página)

Página dedicada para o técnico registar achados no campo rapidamente, em
`/app/registo-rapido-de-achados` (acessível também pela awesomebar, ex.
`Ctrl+G` → "Registo Rápido de Achados"). Só mostra os campos relevantes
para criar um achado novo (sem a secção "Resposta do Cliente", que é só
para o cliente preencher depois).

- Campanha e Área mantêm-se seleccionadas entre registos — só os campos do
  achado em si (equipamento, severidade, descrição, …) são limpos depois de
  guardar, para o técnico encadear vários registos rapidamente.
- A lista de Campanhas mostra só as que estão "Em Curso"; a Área filtra
  automaticamente pelo Cliente da campanha seleccionada.
- Campos de temperatura só aparecem quando a campanha é de Termografia.
- Área/Campanha novas: basta escrever um nome que não exista no campo -
  o Link do Frappe pergunta se quer criar (comportamento nativo, sem botão
  extra), então não é preciso sair da página.
- Valida campos obrigatórios no browser antes de guardar (com mensagem
  clara do que falta) e, de qualquer forma, a validação real acontece no
  servidor via `frappe.client.insert` - o mesmo caminho usado por
  qualquer outra forma de criar o documento, incluindo as regras do
  controller (ex.: cálculo da diferença de temperatura).
- Lista "Achados Recentes desta Campanha" por baixo do formulário, para o
  técnico confirmar o que já foi registado sem sair da página.

### Meus Achados (portal do cliente)

Página dedicada para o cliente (`/app/meus-achados`, papel **Cliente Portal**),
com dois separadores:

- **Painel** — cartões com totais (achados, por resolver, críticos, em
  atraso), gráficos de composição por severidade/estado, rankings das áreas
  e equipamentos com mais achados, e um gráfico de achados por campanha ao
  longo do tempo. Reflecte sempre o histórico completo do cliente, não só a
  página actualmente carregada na lista.
- **Achados** — pesquisa, filtro por severidade/estado e a lista de achados
  em si. Clicar num achado abre um diálogo com o detalhe (só leitura) e a
  secção de resposta (ação tomada, responsável, prazo, estado, data de
  conclusão) — os únicos campos que este papel pode gravar, reforçado tanto
  na interface como nas permissões (nível 1) do doctype.

### Workspaces

Duas Workspaces (visíveis conforme o papel do utilizador, via `roles`):

- **Manutenção Preditiva** — Registo Rápido de Achados, listas de Campanha/
  Achado/Área/Equipamento, e um atalho para a vista do cliente. Visível a
  **System Manager** e **Tecnico de Inspecao**.
- **Portal do Cliente** — atalho directo à página "Meus Achados". Tem de se
  chamar diferente da própria página: o router do Frappe resolve Workspaces
  antes de Páginas para o mesmo segmento de rota (`/app/<nome>`), portanto
  uma Workspace chamada "Meus Achados" bloquearia permanentemente o acesso
  à página com esse nome. Visível a **System Manager** e **Cliente Portal**.

### Importar os trackers históricos (Excel)

Os dois ficheiros "Action Tracker" originais (vibração e termografia) já
foram extraídos localmente para `manutencao_preditiva/setup/data/achados_import.json`
— um ficheiro plano, sem dependência de `openpyxl`, que viaja com a app no
git. Os `.xlsx` originais nunca são commitados (ver `.gitignore`).

Depois de instalar a app no site (`bench get-app` + `bench migrate`), basta
correr, sem argumentos — não precisa de `openpyxl` no bench nem de fazer
upload de nada:

```bash
bench --site <site> execute manutencao_preditiva.setup.import_action_trackers.load_from_json
```

É seguro correr mais do que uma vez — verifica registos existentes antes de
criar duplicados. Cria os Customers "Kenmare"/"CLN" se ainda não existirem,
depois as 2 Campanhas e os 321 Achados.

Se um dos ficheiros Excel de origem for alterado, corra isto localmente
(precisa de `openpyxl`, não de frappe) para regenerar o JSON antes de
fazer commit:

```bash
python -c "
from manutencao_preditiva.setup.import_action_trackers import extract_to_json
extract_to_json(
    vibration_file='FR.TEC.014...xlsx',
    thermography_file='FR.TEC.016...xlsx',
)"
```

## License

mit
