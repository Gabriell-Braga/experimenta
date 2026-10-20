<?php

declare(strict_types=1);

namespace Experimenta;

/**
 * Bucketing determinístico idêntico ao snippet: MurmurHash3 x86 32 bits sobre os bytes (UTF-8), 10.000 baldes.
 *
 * Aritmética de 32 bits sem sinal num int de 64 bits: tudo fica em [0, 2^32) com `& 0xffffffff`. A multiplicação
 * é feita em duas metades de 16 bits (`mul32`), porque o produto de dois valores de 32 bits passa de 2^63 e o PHP
 * o converteria para float (perdendo precisão) em vez de dar a volta como o Math.imul do JS. Com os valores
 * sempre não negativos, `>>` já é o deslocamento lógico (`>>>` do JS). Exige PHP de 64 bits.
 */
final class Bucketing
{
    public const BUCKETS = 10000;

    private const MASK = 0xffffffff;

    /** (a * b) mod 2^32 sem passar de 2^49 em nenhum passo. */
    private static function mul32(int $a, int $b): int
    {
        return ((($a * ($b & 0xffff)) & self::MASK) + ((($a * ($b >> 16)) & 0xffff) << 16)) & self::MASK;
    }

    private static function rotl32(int $x, int $r): int
    {
        return (($x << $r) | ($x >> (32 - $r))) & self::MASK;
    }

    /** MurmurHash3 x86 32 bits (semente 0) da string (bytes UTF-8), de 0 a 2^32-1. */
    public static function murmurhash3(string $key): int
    {
        if (PHP_INT_SIZE < 8) {
            throw new \RuntimeException('O SDK do Experimenta exige PHP de 64 bits.');
        }
        $c1 = 0xcc9e2d51;
        $c2 = 0x1b873593;
        $len = strlen($key);
        $nblocks = $len >> 2;
        $h = 0;
        for ($i = 0; $i < $nblocks; $i++) {
            $k = unpack('V', $key, $i * 4)[1]; // 32 bits little-endian, sem sinal
            $k = self::mul32($k, $c1);
            $k = self::rotl32($k, 15);
            $k = self::mul32($k, $c2);
            $h ^= $k;
            $h = self::rotl32($h, 13);
            $h = (self::mul32($h, 5) + 0xe6546b64) & self::MASK;
        }
        $k = 0;
        $tail = $nblocks * 4;
        switch ($len & 3) {
            case 3:
                $k ^= ord($key[$tail + 2]) << 16;
                // no break
            case 2:
                $k ^= ord($key[$tail + 1]) << 8;
                // no break
            case 1:
                $k ^= ord($key[$tail]);
                $k = self::mul32($k, $c1);
                $k = self::rotl32($k, 15);
                $k = self::mul32($k, $c2);
                $h ^= $k;
        }
        $h ^= $len & self::MASK;
        $h ^= $h >> 16;
        $h = self::mul32($h, 0x85ebca6b);
        $h ^= $h >> 13;
        $h = self::mul32($h, 0xc2b2ae35);
        $h ^= $h >> 16;
        return $h;
    }

    /** Balde (0–9999) do visitante para um id (experimento, grupo ou "flag:<chave>"). */
    public static function bucketOf(string $visitorId, string $salt): int
    {
        return self::murmurhash3($visitorId . $salt) % self::BUCKETS;
    }

    /** Math.round do JS (meio arredonda para cima; o round() do PHP afasta do zero). */
    public static function jsRound(float $x): int
    {
        $f = floor($x);
        return (int) ($x - $f >= 0.5 ? $f + 1 : $f);
    }

    /** @param array<string, mixed> $exp */
    private static function inGroup(string $visitorId, array $exp): bool
    {
        $g = $exp['group'] ?? null;
        if (!$g) {
            return true;
        }
        return in_array(self::bucketOf($visitorId, (string) $g['id']) % 100, array_map('intval', $g['slots']), true);
    }

    /**
     * Mesma escolha do snippet: grupo exclusivo → tráfego → variação proporcional aos pesos. null = fora.
     *
     * @param array<string, mixed> $exp experimento do sdk.json (id, traffic, variations, group)
     * @return array<string, mixed>|null
     */
    public static function chooseVariation(string $visitorId, array $exp): ?array
    {
        if (!self::inGroup($visitorId, $exp)) {
            return null;
        }
        $b = self::bucketOf($visitorId, (string) $exp['id']);
        $included = self::jsRound((float) ($exp['traffic'] ?? 100) * (self::BUCKETS / 100));
        if ($b >= $included) {
            return null;
        }
        $variations = $exp['variations'];
        $total = 0.0;
        foreach ($variations as $v) {
            $total += (float) $v['weight'];
        }
        if ($total <= 0) {
            return null;
        }
        $point = ((float) $b / $included) * $total;
        foreach ($variations as $v) {
            if ($point < (float) $v['weight']) {
                return $v;
            }
            $point -= (float) $v['weight'];
        }
        return $variations[count($variations) - 1];
    }
}
