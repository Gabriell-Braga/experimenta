<?php

// Compatibilidade com o SDK JS/TS: confere decisão por decisão contra sdks/test-vectors.json.
// Sem PHPUnit (zero dependências): `php tests/vectors_test.php` (sai com 1 se algo falhar).

declare(strict_types=1);

require __DIR__ . '/../src/Bucketing.php';
require __DIR__ . '/../src/Rules.php';
require __DIR__ . '/../src/Client.php';

use Experimenta\Bucketing;
use Experimenta\Client;
use Experimenta\Rules;

error_reporting(E_ALL);
set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    if (!(error_reporting() & $no)) {
        return false; // suprimido com @ (ex.: arquivo de cache que não existe)
    }
    throw new ErrorException($msg, 0, $no, $file, $line); // aviso/deprecação também falha o teste
});

$failures = 0;
$checks = 0;
function check(bool $ok, string $msg): void
{
    global $failures, $checks;
    $checks++;
    if (!$ok && $failures++ < 50) {
        fwrite(STDERR, "FALHOU: $msg\n");
    }
}

/** Igualdade estrita, mas 0 == 0.0 (o JSON não distingue) e sem depender da ordem das chaves. */
function same(mixed $a, mixed $b): bool
{
    if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) {
        return (float) $a === (float) $b;
    }
    if (is_array($a) && is_array($b)) {
        if (count($a) !== count($b)) {
            return false;
        }
        foreach ($a as $k => $v) {
            if (!array_key_exists($k, $b) || !same($v, $b[$k])) {
                return false;
            }
        }
        return true;
    }
    return $a === $b;
}

$v = json_decode((string) file_get_contents(__DIR__ . '/../../test-vectors.json'), true, 512, JSON_THROW_ON_ERROR);
$config = $v['config'];
$users = $v['users'];
$noop = static fn (string $m, string $u, ?string $b): ?string => '';

foreach ($v['murmur3'] as $c) {
    $got = Bucketing::murmurhash3($c['input']);
    check($got === $c['hash'], "murmur3(" . json_encode($c['input']) . ") = $got, esperado {$c['hash']}");
}

$client = new Client('acc-vetores', '', ['config' => $config, 'transport' => $noop, 'flushOnShutdown' => false]);
foreach ($v['experiments'] as $e) {
    foreach ($users as $i => $u) {
        $d = $client->getVariation($e['key'], $u);
        check(($d['key'] ?? null) === $e['variations'][$i], "{$e['key']} / " . json_encode($u));
    }
}

$flags = array_column($config['flags'], null, 'key');
foreach ($v['flags'] as $f) {
    foreach ($users as $i => $u) {
        $want = $f['enabled'][$i];
        check($client->isEnabled($f['key'], $u, $f['attributes']) === $want, "{$f['key']} / " . json_encode($u) . ' / ' . json_encode($f['attributes']));
        check(same($client->getVariables($f['key'], $u, $f['attributes']), $want ? $flags[$f['key']]['variables'] : []), "variáveis {$f['key']}");
    }
}
check(!$client->isEnabled('nao-existe', 'u1'), 'flag inexistente');

foreach ($v['rules'] as $r) {
    check(Rules::flagRuleMatches($r['rule'], $r['attributes']) === $r['match'], 'regra ' . json_encode($r));
}

// sequência de exposições/eventos e o formato enviado ao /collect
$posted = [];
$tracker = new Client('acc-vetores', '', [
    'config' => $config,
    'flushOnShutdown' => false,
    'transport' => static function (string $method, string $url, ?string $body) use (&$posted, $config): ?string {
        check($method === 'POST' && $url === $config['trackingUrl'], "POST $url");
        array_push($posted, ...json_decode((string) $body, true, 512, JSON_THROW_ON_ERROR)['events']);
        return '';
    },
]);
foreach ($v['track']['calls'] as $c) {
    if ($c['call'] === 'track') {
        $tracker->track($c['event'], $c['userId'], isset($c['value']) ? (float) $c['value'] : null, $c['props'] ?? null);
        continue;
    }
    $d = $tracker->getVariation($c['experiment'], $c['userId']);
    $got = $d === null ? null : ['key' => $d['key'], 'variables' => $d['variables']];
    check(same($got, $c['result']), "getVariation {$c['experiment']} / " . json_encode($c['userId']));
}
$tracker->flush();
foreach ($posted as &$e) {
    check(is_string($e['eventId']) && strlen($e['eventId']) === 36, 'eventId');
    check(is_int($e['ts']), 'ts');
    unset($e['eventId'], $e['ts']);
}
unset($e);
check(same($posted, $v['track']['events']), "eventos:\n" . json_encode($posted) . "\nesperado:\n" . json_encode($v['track']['events']));

// baixa da CDN, grava o cache em arquivo e usa o cache (vencido) quando a rede cai
$cache = sys_get_temp_dir() . '/experimenta-teste-' . bin2hex(random_bytes(4)) . '.json';
$urls = [];
$c1 = new Client('acc-vetores', 'https://cdn.test/', [
    'cacheFile' => $cache,
    'flushOnShutdown' => false,
    'transport' => static function (string $m, string $url) use (&$urls, $config): ?string {
        $urls[] = $url;
        return json_encode($config);
    },
]);
check($urls === ['https://cdn.test/acc-vetores.sdk.json'] && $c1->version() === 7, 'baixa da CDN ' . json_encode($urls));
$c2 = new Client('acc-vetores', 'https://cdn.test/', [
    'cacheFile' => $cache,
    'flushOnShutdown' => false,
    'transport' => static function () use (&$urls): ?string {
        $urls[] = 'rede';
        return null;
    },
]);
check(count($urls) === 1 && $c2->version() === 7, 'cache dentro da validade não vai à rede');
touch($cache, time() - 3600);
$c3 = new Client('acc-vetores', 'https://cdn.test/', [
    'cacheFile' => $cache,
    'flushOnShutdown' => false,
    'transport' => static function (): ?string {
        throw new RuntimeException('rede caiu');
    },
]);
check($c3->version() === 7, 'cache vencido quando a rede cai');
@unlink($cache);

$off = new Client('x', 'https://cdn.test', ['cacheFile' => false, 'flushOnShutdown' => false, 'transport' => static fn (): ?string => null]);
check(!$off->isEnabled('rollout-100', 'u1') && $off->getVariation('meio-a-meio', 'u1') === null, 'sem config');
$off->track('compra', 'u1');
$off->flush();

// falha no envio devolve para a fila
$fail = true;
$sent = [];
$q = new Client('acc-vetores', '', [
    'config' => $config,
    'flushOnShutdown' => false,
    'transport' => static function (string $m, string $u, ?string $body) use (&$fail, &$sent): ?string {
        if ($fail) {
            throw new RuntimeException('timeout');
        }
        foreach (json_decode((string) $body, true)['events'] as $e) {
            if ($e['type'] === 'event') {
                $sent[] = $e['visitorId'];
            }
        }
        return '';
    },
]);
$q->track('compra', 'u1');
$q->flush();
$fail = false;
$q->track('compra', 'u2');
$q->flush();
check($sent === ['u1', 'u2'], 'reenvio ' . json_encode($sent));

echo "$checks verificações, $failures falhas\n";
exit($failures > 0 ? 1 : 0);
