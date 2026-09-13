# Manutenção Preditiva (manutencao_preditiva)

**Manutenção Preditiva** — aplicação de manutenção preditiva de ativos construída sobre o
Frappe Framework, instalável num bench com ERPNext.

## Instalação

```bash
bench get-app manutencao_preditiva <repo-url>
bench --site <site> install-app manutencao_preditiva
```

## Módulos

Scaffold inicial da app — ainda sem doctypes. Os dados de ativos e empresa virão do
**Asset** e da **Company** do ERPNext; os doctypes próprios (planos de manutenção
preditiva, leituras de sensores, alertas, ordens de trabalho) serão adicionados a seguir.

## License

mit
