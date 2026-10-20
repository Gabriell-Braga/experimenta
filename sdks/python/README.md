# Experimenta — SDK Python

Feature flags e campanhas server-side decididas localmente (sem ida à rede por decisão), com o mesmo bucketing do
snippet e do SDK JS. Python 3.10+, sem dependências.

## Instalação

```bash
pip install "git+https://github.com/Gabriell-Braga/experimenta.git#subdirectory=sdks/python"
```

## Uso

```python
from experimenta import Client

abt = Client("<conta>", "https://<api>/cdn")  # baixa <conta>.sdk.json; recarrega a cada 60 s

if abt.is_enabled("novo-checkout", usuario.id, {"plano": usuario.plano}):
    passos = abt.get_variables("novo-checkout", usuario.id, {"plano": usuario.plano}).get("passos")

v = abt.get_variation("checkout-rapido", usuario.id)  # Decision(key, variation, variables) ou None
abt.track("compra", usuario.id, value=199.9)

abt.close()  # no encerramento do processo: envia o que falta (ou use `with Client(...) as abt:`)
```

Opções: `refresh_ms` (0 = nunca recarrega), `flush_ms` (envio em lote, padrão 2 s; 0 = só em `flush()`/`close()`),
`config` (sdk.json já carregado), `transport` (HTTP próprio), `timeout`. Seguro entre threads; em servidores com
fork (gunicorn), crie o cliente depois do fork.

## Testes

```bash
python -m unittest discover -s tests -v   # confere ../test-vectors.json
```
