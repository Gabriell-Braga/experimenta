# Experimenta — SDK PHP

Feature flags e campanhas server-side decididas localmente, com o mesmo bucketing do snippet e do SDK JS.
PHP 8.1+ de 64 bits, sem dependências (usa cURL se estiver instalado; senão, streams com `allow_url_fopen`).

## Instalação

Composer, apontando para o repositório:

```json
{
  "repositories": [{ "type": "vcs", "url": "https://github.com/Gabriell-Braga/experimenta" }],
  "require": { "experimenta/sdk": "*" }
}
```

Ou sem Composer: `require` de `src/Bucketing.php`, `src/Rules.php` e `src/Client.php`.

## Uso

```php
$abt = new Experimenta\Client('<conta>', 'https://<api>/cdn');

if ($abt->isEnabled('novo-checkout', $usuario->id, ['plano' => $usuario->plano])) {
    $passos = $abt->getVariables('novo-checkout', $usuario->id, ['plano' => $usuario->plano])['passos'] ?? 3;
}
$v = $abt->getVariation('checkout-rapido', $usuario->id); // ['key' => ..., 'variables' => [...]] ou null
$abt->track('compra', $usuario->id, 199.9);
// os eventos vão para o /collect no fim da requisição (ou chame $abt->flush())
```

Como o PHP costuma viver uma requisição por processo, o `sdk.json` fica num arquivo de cache compartilhado
(`cacheFile`, padrão no diretório temporário) válido por `refreshMs` (padrão 60 s); se a CDN cair, o cache vencido
continua valendo. Em processos longos (Swoole, RoadRunner, filas) o cliente recarrega sozinho quando a validade
passa. Outras opções: `config`, `transport`, `timeout`, `flushOnShutdown`.

## Testes

```bash
php tests/vectors_test.php   # confere ../test-vectors.json
```
