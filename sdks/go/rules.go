package experimenta

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Regras de flag e as conversões de tipo do JS que elas usam (String(v), Number(v), trim), para decidir igual
// ao SDK JS com qualquer atributo.

// jsWhitespace é o conjunto do String.prototype.trim (WhiteSpace + LineTerminator).
const jsWhitespace = "\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"

var (
	decimalRe = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
	radixRe   = regexp.MustCompile(`^0([xXoObB])([0-9a-fA-F]+)$`)
)

func jsTrim(s string) string { return strings.Trim(s, jsWhitespace) }

// jsNumberString é o Number.prototype.toString (dígitos mais curtos, notação do JS).
func jsNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	// "d.ddde±x" com os dígitos mais curtos → 0.DIGITS × 10^n
	mant, exp, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	e, _ := strconv.Atoi(exp)
	digits := strings.TrimRight(strings.Replace(mant, ".", "", 1), "0")
	k, n := len(digits), e+1
	var out string
	switch {
	case k <= n && n <= 21:
		out = digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		out = digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		out = "0." + strings.Repeat("0", -n) + digits
	default:
		out = digits[:1]
		if k > 1 {
			out += "." + digits[1:]
		}
		if n-1 >= 0 {
			out += "e+" + strconv.Itoa(n-1)
		} else {
			out += "e-" + strconv.Itoa(1-n)
		}
	}
	return sign + out
}

const maxSafe = 1 << 53

func intString(i int64) string {
	if i > maxSafe || i < -maxSafe {
		return jsNumberString(float64(i))
	}
	return strconv.FormatInt(i, 10)
}

// jsString é o String(v) do JS para os tipos de atributo aceitos.
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return jsNumberString(x)
	case float32:
		return jsNumberString(float64(x))
	case int:
		return intString(int64(x))
	case int8:
		return intString(int64(x))
	case int16:
		return intString(int64(x))
	case int32:
		return intString(int64(x))
	case int64:
		return intString(x)
	case uint:
		return jsNumberString(float64(x))
	case uint8:
		return intString(int64(x))
	case uint16:
		return intString(int64(x))
	case uint32:
		return intString(int64(x))
	case uint64:
		if x <= maxSafe {
			return intString(int64(x))
		}
		return jsNumberString(float64(x))
	case fmt.Stringer:
		return x.String()
	}
	return fmt.Sprint(v)
}

// jsNumber é o Number(v) do JS (string vazia = 0, inválida = NaN, aceita 0x/0o/0b e Infinity).
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		return parseJSNumber(x)
	case float64:
		return x
	}
	return parseJSNumber(jsString(v))
}

func parseJSNumber(raw string) float64 {
	s := jsTrim(raw)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if decimalRe.MatchString(s) {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) { // ErrRange já vem com ±Inf/0, como no JS
			return math.NaN()
		}
		return f
	}
	if m := radixRe.FindStringSubmatch(s); m != nil {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[m[1][0]]
		n, ok := new(big.Int).SetString(m[2], base)
		if !ok { // dígito inválido para a base (ex.: 0b2)
			return math.NaN()
		}
		f, _ := new(big.Float).SetInt(n).Float64()
		return f
	}
	return math.NaN()
}

// FlagRuleMatches avalia uma regra de atributo (eq, neq, in, contains, gte, lte) igual ao SDK JS.
// Atributo ausente ou nil conta como "undefined": só neq passa.
func FlagRuleMatches(r Rule, attrs Attributes) bool {
	v, ok := attrs[r.Attribute]
	if !ok || v == nil {
		return r.Op == "neq"
	}
	s := jsString(v)
	switch r.Op {
	case "eq":
		return s == r.Value
	case "neq":
		return s != r.Value
	case "in":
		for _, x := range strings.Split(r.Value, ",") {
			if jsTrim(x) == s {
				return true
			}
		}
		return false
	case "contains":
		return strings.Contains(s, r.Value)
	case "gte":
		return jsNumber(v) >= jsNumber(r.Value)
	case "lte":
		return jsNumber(v) <= jsNumber(r.Value)
	}
	return false
}
