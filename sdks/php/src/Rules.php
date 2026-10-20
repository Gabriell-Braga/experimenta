<?php

declare(strict_types=1);

namespace Experimenta;

/**
 * Regras de atributo de flag e as conversões de tipo do JS que elas usam (String(v), Number(v), trim), para
 * decidir igual ao SDK JS com qualquer atributo.
 */
final class Rules
{
    /** WhiteSpace + LineTerminator do JS (o conjunto do String.prototype.trim), para PCRE com /u. */
    private const JS_WS = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    private const MAX_SAFE = 9007199254740992; // 2^53

    /**
     * Regra (eq, neq, in, contains, gte, lte) com o atributo do usuário. Ausente ou null conta como "undefined":
     * só neq passa.
     *
     * @param array{attribute: string, op: string, value: string} $rule
     * @param array<string, string|int|float|bool|null> $attrs
     */
    public static function flagRuleMatches(array $rule, array $attrs): bool
    {
        $v = $attrs[$rule['attribute']] ?? null;
        $op = $rule['op'];
        $value = (string) $rule['value'];
        if ($v === null) {
            return $op === 'neq';
        }
        $s = self::jsString($v);
        switch ($op) {
            case 'eq':
                return $s === $value;
            case 'neq':
                return $s !== $value;
            case 'in':
                foreach (explode(',', $value) as $x) {
                    if (self::jsTrim($x) === $s) {
                        return true;
                    }
                }
                return false;
            case 'contains':
                return str_contains($s, $value);
            case 'gte':
                return self::jsNumber($v) >= self::jsNumber($value);
            case 'lte':
                return self::jsNumber($v) <= self::jsNumber($value);
        }
        return false;
    }

    public static function jsTrim(string $s): string
    {
        $r = preg_replace('/^[' . self::JS_WS . ']+|[' . self::JS_WS . ']+$/u', '', $s);
        return $r ?? trim($s, " \t\n\r\v\f"); // UTF-8 inválido: só o ASCII
    }

    /** String(v) do JS. */
    public static function jsString(mixed $v): string
    {
        if (is_string($v)) {
            return $v;
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_int($v)) {
            return abs($v) <= self::MAX_SAFE ? (string) $v : self::jsNumberString((float) $v);
        }
        if (is_float($v)) {
            return self::jsNumberString($v);
        }
        return (string) $v;
    }

    /**
     * Number.prototype.toString: dígitos mais curtos que voltam ao mesmo double, na notação do JS. Não depende do
     * ini serialize_precision (o sprintf %e arredonda corretamente).
     */
    public static function jsNumberString(float $f): string
    {
        if (is_nan($f)) {
            return 'NaN';
        }
        if (is_infinite($f)) {
            return $f > 0 ? 'Infinity' : '-Infinity';
        }
        if ($f == 0) {
            return '0';
        }
        $sign = $f < 0 ? '-' : '';
        $a = abs($f);
        if ($a < self::MAX_SAFE && floor($a) === $a) {
            return $sign . sprintf('%.0f', $a);
        }
        for ($p = 0; $p < 17; $p++) {
            $e = sprintf('%.' . $p . 'e', $a);
            if ((float) $e === $a) {
                break;
            }
        }
        preg_match('/^(\d)(?:\.(\d+))?e([+-]\d+)$/', $e, $m);
        $digits = rtrim($m[1] . ($m[2] ?? ''), '0');
        $k = strlen($digits);
        $n = (int) $m[3] + 1;
        if ($k <= $n && $n <= 21) {
            $out = $digits . str_repeat('0', $n - $k);
        } elseif (0 < $n && $n <= 21) {
            $out = substr($digits, 0, $n) . '.' . substr($digits, $n);
        } elseif (-6 < $n && $n <= 0) {
            $out = '0.' . str_repeat('0', -$n) . $digits;
        } else {
            $x = $n - 1;
            $out = $digits[0] . ($k > 1 ? '.' . substr($digits, 1) : '') . 'e' . ($x >= 0 ? '+' : '-') . abs($x);
        }
        return $sign . $out;
    }

    /** Number(v) do JS: string vazia = 0, inválida = NaN, aceita 0x/0o/0b e Infinity. */
    public static function jsNumber(mixed $v): float
    {
        if (is_bool($v)) {
            return $v ? 1.0 : 0.0;
        }
        if (is_int($v) || is_float($v)) {
            return (float) $v;
        }
        $s = self::jsTrim((string) $v);
        if ($s === '') {
            return 0.0;
        }
        if ($s === 'Infinity' || $s === '+Infinity') {
            return INF;
        }
        if ($s === '-Infinity') {
            return -INF;
        }
        if (preg_match('/^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/D', $s)) {
            return (float) $s;
        }
        if (preg_match('/^0(?:([xX])([0-9a-fA-F]+)|([oO])([0-7]+)|([bB])([01]+))$/D', $s, $m)) {
            [$base, $digits] = $m[2] !== '' ? [16, $m[2]] : (($m[4] ?? '') !== '' ? [8, $m[4]] : [2, $m[6]]);
            // ponytail: acumula em float; exato até 2^53, acima disso pode diferir do JS no último bit
            $r = 0.0;
            foreach (str_split(strtolower($digits)) as $d) {
                $r = $r * $base + hexdec($d);
            }
            return $r;
        }
        return NAN;
    }
}
