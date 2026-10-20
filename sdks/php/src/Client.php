<?php

declare(strict_types=1);

namespace Experimenta;

/**
 * SDK server-side do Experimenta para PHP (8.1+, 64 bits, só funções nativas; usa cURL se houver).
 *
 * Mesma API e semântica do SDK JS/TS (packages/sdk): decide flags e campanhas localmente com o mesmo bucketing do
 * snippet e envia exposições/eventos/conversões para o /collect. Como o PHP costuma viver uma requisição por
 * processo, o sdk.json fica num arquivo de cache compartilhado entre requisições (validade = refreshMs) e os
 * eventos são enviados no fim da requisição (ou em flush()).
 */
final class Client
{
    /** @var array<string, mixed>|null */
    private ?array $config = null;
    private float $loadedAt = 0.0;
    /** @var list<array<string, mixed>> */
    private array $queue = [];
    /** @var array<string, true> */
    private array $exposed = [];
    /** @var callable(string, string, ?string): ?string */
    private $transport;
    private string $configUrl;
    private int $refreshMs;
    private ?string $cacheFile;

    /**
     * @param string $accountId id da conta
     * @param string $cdnUrl base da CDN (ex.: https://api.exemplo.com/cdn); o SDK baixa `<conta>.sdk.json`
     * @param array{
     *   refreshMs?: int,
     *   config?: array<string, mixed>,
     *   cacheFile?: string|false,
     *   transport?: callable(string, string, ?string): ?string,
     *   timeout?: float,
     *   flushOnShutdown?: bool
     * } $options refreshMs: validade da config (cache em arquivo e em memória; 0 = baixa a cada criação, padrão
     *   60000); config: sdk.json já carregado; cacheFile: caminho do cache (false desliga; padrão no diretório
     *   temporário); transport: fn(método, url, corpo) → corpo se 2xx, null se outro status, exceção em falha de
     *   rede; timeout em segundos (padrão 10); flushOnShutdown: envia os eventos no fim do script (padrão true).
     */
    public function __construct(private string $accountId, string $cdnUrl = '', array $options = [])
    {
        $this->configUrl = rtrim($cdnUrl, '/') . '/' . $accountId . '.sdk.json';
        $this->refreshMs = (int) ($options['refreshMs'] ?? 60000);
        $this->transport = $options['transport'] ?? self::httpTransport((float) ($options['timeout'] ?? 10));
        $cache = $options['cacheFile'] ?? sys_get_temp_dir() . '/experimenta-' . md5($this->configUrl) . '.sdk.json';
        $this->cacheFile = $cache === false ? null : $cache;
        if (isset($options['config'])) {
            $this->config = $options['config'];
            $this->loadedAt = microtime(true);
            $this->refreshMs = 0; // config fixa: nunca recarrega
        } else {
            $this->load();
        }
        if ($options['flushOnShutdown'] ?? true) {
            register_shutdown_function([$this, 'flush']);
        }
    }

    private static function httpTransport(float $timeout): callable
    {
        return static function (string $method, string $url, ?string $body) use ($timeout): ?string {
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_TIMEOUT_MS => (int) ($timeout * 1000),
                ]);
                if ($method === 'POST') {
                    curl_setopt_array($ch, [
                        CURLOPT_POST => true,
                        CURLOPT_POSTFIELDS => (string) $body,
                        CURLOPT_HTTPHEADER => ['content-type: text/plain'],
                    ]);
                }
                $res = curl_exec($ch);
                $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $error = curl_error($ch);
                curl_close($ch);
                if ($res === false) {
                    throw new \RuntimeException('Experimenta: ' . $error);
                }
                return $status >= 200 && $status < 300 ? (string) $res : null;
            }
            $ctx = stream_context_create(['http' => [
                'method' => $method,
                'timeout' => $timeout,
                'ignore_errors' => true,
                'header' => $method === 'POST' ? "content-type: text/plain\r\n" : '',
                'content' => (string) $body,
            ]]);
            $res = @file_get_contents($url, false, $ctx);
            if ($res === false) {
                throw new \RuntimeException('Experimenta: falha de rede em ' . $url);
            }
            $headers = function_exists('http_get_last_response_headers')
                ? (http_get_last_response_headers() ?? [])
                : ($http_response_header ?? []);
            $status = 0;
            foreach ($headers as $h) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                    $status = (int) $m[1];
                }
            }
            return $status >= 200 && $status < 300 ? $res : null;
        };
    }

    /** Cache em arquivo dentro da validade → CDN → cache vencido (rede fora) → mantém o que já tinha. */
    private function load(): void
    {
        $this->loadedAt = microtime(true);
        $file = $this->cacheFile;
        $fresh = $file !== null && $this->refreshMs > 0 && is_file($file)
            && (time() - (int) filemtime($file)) * 1000 < $this->refreshMs;
        if ($fresh && ($cfg = self::decode((string) @file_get_contents($file))) !== null) {
            $this->config = $cfg;
            return;
        }
        try {
            $body = ($this->transport)('GET', $this->configUrl, null);
            $cfg = $body === null ? null : self::decode($body);
        } catch (\Throwable) {
            $cfg = null;
        }
        if ($cfg !== null) {
            $this->config = $cfg;
            if ($file !== null) {
                $tmp = $file . '.' . bin2hex(random_bytes(4));
                if (@file_put_contents($tmp, json_encode($cfg)) !== false) {
                    @rename($tmp, $file); // atômico: outra requisição nunca lê meio arquivo
                }
            }
            return;
        }
        if ($this->config === null && $file !== null && is_file($file)) {
            $this->config = self::decode((string) @file_get_contents($file));
        }
    }

    /** @return array<string, mixed>|null */
    private static function decode(string $json): ?array
    {
        try {
            $v = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        return is_array($v) ? $v : null;
    }

    /** Recarrega quando a validade passou (processos longos: Swoole, RoadRunner, filas). */
    private function cfg(): ?array
    {
        if ($this->refreshMs > 0 && (microtime(true) - $this->loadedAt) * 1000 >= $this->refreshMs) {
            $this->load();
        }
        return $this->config;
    }

    /** Versão publicada da config carregada (0 = nenhuma). */
    public function version(): int
    {
        return (int) ($this->cfg()['version'] ?? 0);
    }

    /** @return array<string, mixed>|null */
    private function find(string $list, string $key): ?array
    {
        foreach ($this->cfg()[$list] ?? [] as $x) {
            if (($x['key'] ?? null) === $key) {
                return $x;
            }
        }
        return null;
    }

    /**
     * Flag ativa para este usuário? (ligada + regras de atributo + dentro do rollout).
     *
     * @param array<string, string|int|float|bool|null> $attrs
     */
    public function isEnabled(string $key, string $userId, array $attrs = []): bool
    {
        $flag = $this->find('flags', $key);
        if (!$flag || empty($flag['enabled'])) {
            return false;
        }
        foreach ($flag['rules'] ?? [] as $r) {
            if (!Rules::flagRuleMatches($r, $attrs)) {
                return false;
            }
        }
        $limit = Bucketing::jsRound((float) ($flag['rollout'] ?? 100) * (Bucketing::BUCKETS / 100));
        return Bucketing::bucketOf($userId, 'flag:' . $key) < $limit;
    }

    /**
     * Variáveis da flag (vazio quando inativa).
     *
     * @param array<string, string|int|float|bool|null> $attrs
     * @return array<string, mixed>
     */
    public function getVariables(string $key, string $userId, array $attrs = []): array
    {
        return $this->isEnabled($key, $userId, $attrs) ? ($this->find('flags', $key)['variables'] ?? []) : [];
    }

    /**
     * Variação da campanha server-side (registra a exposição na 1ª vez). null = inexistente ou fora do tráfego.
     *
     * @return array{key: string, variation: string, variables: array<string, mixed>}|null
     */
    public function getVariation(string $experimentKey, string $userId): ?array
    {
        $exp = $this->find('experiments', $experimentKey);
        if (!$exp) {
            return null;
        }
        $v = Bucketing::chooseVariation($userId, $exp);
        if (!$v) {
            return null;
        }
        $mark = $exp['id'] . '|' . $userId;
        if (!isset($this->exposed[$mark])) {
            $this->exposed[$mark] = true;
            $this->queue[] = $this->base($userId) + [
                'type' => 'exposure',
                'experimentId' => $exp['id'],
                'experimentKey' => $exp['key'],
                'variationId' => $v['id'],
                'variationKey' => $v['key'],
            ];
        }
        return ['key' => $v['key'], 'variation' => $v['key'], 'variables' => $v['variables'] ?? []];
    }

    /**
     * Evento do usuário. Também vira conversão nas campanhas server-side em que ele está e que têm meta
     * customizada com este nome.
     *
     * @param array<string, string|int|float|bool>|null $props
     */
    public function track(string $event, string $userId, ?float $value = null, ?array $props = null): void
    {
        $extra = $value !== null ? ['value' => $value] : [];
        $this->queue[] = $this->base($userId) + ['type' => 'event', 'name' => $event] + $extra
            + ($props !== null ? ['props' => (object) $props] : []);
        foreach ($this->cfg()['experiments'] ?? [] as $exp) {
            $v = Bucketing::chooseVariation($userId, $exp);
            if (!$v) {
                continue;
            }
            foreach ($exp['goals'] ?? [] as $g) {
                if (($g['type'] ?? '') === 'custom' && ($g['event'] ?? null) === $event) {
                    $this->queue[] = $this->base($userId) + [
                        'type' => 'conversion',
                        'experimentId' => $exp['id'],
                        'experimentKey' => $exp['key'],
                        'variationId' => $v['id'],
                        'variationKey' => $v['key'],
                        'goalId' => $g['id'],
                        'goalKey' => $g['key'],
                    ] + $extra;
                }
            }
        }
    }

    /** Envia agora os eventos pendentes (em falha de rede, voltam para a fila). */
    public function flush(): void
    {
        $url = $this->config['trackingUrl'] ?? '';
        if (!$this->queue || !$url) {
            return;
        }
        $events = $this->queue;
        $this->queue = [];
        $body = json_encode(['events' => $events], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($body === false) {
            return; // valor que não vira JSON (INF/NAN em props): descarta o lote em vez de travar a fila
        }
        try {
            ($this->transport)('POST', $url, $body);
        } catch (\Throwable) {
            $this->queue = array_merge($events, $this->queue);
        }
    }

    /** @return array<string, mixed> */
    private function base(string $userId): array
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return [
            'eventId' => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4)),
            'ts' => (int) floor(microtime(true) * 1000),
            'accountId' => $this->accountId,
            'visitorId' => $userId,
            'url' => 'sdk://server',
        ];
    }
}
