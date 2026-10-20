# Experimenta — SDK Go

Feature flags e campanhas server-side decididas localmente, com o mesmo bucketing do snippet e do SDK JS.
Go 1.21+, só a biblioteca padrão.

## Instalação

```bash
go get github.com/Gabriell-Braga/experimenta/sdks/go
```

## Uso

```go
import experimenta "github.com/Gabriell-Braga/experimenta/sdks/go"

abt := experimenta.New(experimenta.Options{AccountID: "<conta>", CDNURL: "https://<api>/cdn"})
defer abt.Close() // envia o que falta

attrs := experimenta.Attributes{"plano": usuario.Plano}
if abt.IsEnabled("novo-checkout", usuario.ID, attrs) {
	passos := abt.GetVariables("novo-checkout", usuario.ID, attrs)["passos"]
	_ = passos
}
if v := abt.GetVariation("checkout-rapido", usuario.ID); v != nil {
	_ = v.Key // v.Variables
}
abt.Track("compra", usuario.ID, experimenta.WithValue(199.9))
```

Opções: `RefreshInterval` (0 = 60 s, negativo = nunca), `FlushInterval` (0 = 2 s, negativo = só em
`Flush`/`Close`), `HTTPClient`, `Config`. Seguro entre goroutines.

## Testes

```bash
go test -race ./...   # confere ../test-vectors.json
```
