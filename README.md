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
