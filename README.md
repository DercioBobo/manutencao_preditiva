# Manutenção Preditiva (manutencao_preditiva)

**Manutenção Preditiva** — aplicação de manutenção preditiva de ativos construída sobre o
Frappe Framework, instalável num bench com ERPNext.

## Instalação

```bash
bench get-app manutencao_preditiva <repo-url>
bench --site <site> install-app manutencao_preditiva
```

## Módulos

- **Campanha De Inspecao** — cabeçalho de uma ronda de inspeção a um cliente
  (Cliente, Técnica: Vibração/Termografia/…, data, referência do documento).
- **Achado De Inspecao** — cada defeito/achado encontrado, ligado à campanha.
  Inclui a secção "Resposta do Cliente" (ação tomada, responsável, prazo,
  estado, data de conclusão), editável apenas por quem tem permissão de
  nível 1 nesses campos.

Substitui o fluxo anterior de "1 Excel por cliente" enviado por email: cada
cliente tem um login de Desk restrito, via **User Permission** em Customer,
à sua própria Cliente — vê e actualiza só os seus achados, sem aceder aos
de outros clientes. Papéis: **Tecnico de Inspecao** (equipa interna, acesso
total) e **Cliente Portal** (leitura + resposta apenas).

### Importar os trackers históricos (Excel)

`manutencao_preditiva/setup/import_action_trackers.py` importa os ficheiros
"Action Tracker" (vibração e termografia) para estes dois doctypes. É uma
importação pontual, não corre automaticamente no `bench migrate` — requer
`openpyxl` no ambiente do bench e é invocada manualmente:

```bash
bench --site <site> execute manutencao_preditiva.setup.import_action_trackers.run \
  --kwargs "{'vibration_file': '/caminho/para/FR.TEC.014...xlsx', 'thermography_file': '/caminho/para/FR.TEC.016...xlsx'}"
```

## License

mit
