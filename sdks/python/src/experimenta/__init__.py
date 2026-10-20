"""SDK server-side do Experimenta para Python (3.10+, só stdlib).

Mesma API e semântica do SDK JS/TS (packages/sdk): baixa `<conta>.sdk.json` da CDN, guarda em memória e
recarrega em segundo plano; decide flags e campanhas localmente com o mesmo bucketing do snippet
(MurmurHash3 x86 32 bits sobre UTF-8); junta exposições/eventos/conversões e envia para o /collect.
Compatibilidade conferida por sdks/test-vectors.json.
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple, Union

__all__ = ["Client", "Decision", "murmurhash3", "bucket_of", "choose_variation", "flag_rule_matches"]

Attr = Union[str, int, float, bool, None]
#: (método, url, corpo) -> (status, corpo da resposta). Injetável para testes/proxies.
Transport = Callable[[str, str, Optional[bytes]], Tuple[int, bytes]]

BUCKETS = 10000
_M32 = 0xFFFFFFFF


def murmurhash3(key: str, seed: int = 0) -> int:
    """MurmurHash3 x86 32 bits sobre os bytes UTF-8 (surrogate solto vira U+FFFD, como o TextEncoder)."""
    try:
        data = key.encode("utf-8")
    except UnicodeEncodeError:
        data = re.sub("[\ud800-\udfff]", "�", key).encode("utf-8")
    length = len(data)
    h = seed & _M32
    c1, c2 = 0xCC9E2D51, 0x1B873593
    nblocks = length // 4
    for i in range(nblocks):
        k = int.from_bytes(data[i * 4 : i * 4 + 4], "little")
        k = (k * c1) & _M32
        k = ((k << 15) | (k >> 17)) & _M32
        k = (k * c2) & _M32
        h ^= k
        h = ((h << 13) | (h >> 19)) & _M32
        h = (h * 5 + 0xE6546B64) & _M32
    tail = data[nblocks * 4 :]
    if tail:
        k = int.from_bytes(tail, "little")
        k = (k * c1) & _M32
        k = ((k << 15) | (k >> 17)) & _M32
        k = (k * c2) & _M32
        h ^= k
    h ^= length
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & _M32
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & _M32
    h ^= h >> 16
    return h


def bucket_of(visitor_id: str, salt: str) -> int:
    return murmurhash3(visitor_id + salt) % BUCKETS


def _js_round(x: float) -> int:
    """Math.round do JS (meio arredonda para cima; o round() do Python é bancário)."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def _in_group(visitor_id: str, exp: Mapping[str, Any]) -> bool:
    g = exp.get("group")
    return not g or bucket_of(visitor_id, g["id"]) % 100 in g["slots"]


def choose_variation(visitor_id: str, exp: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Mesma escolha do snippet: grupo exclusivo → tráfego → variação proporcional aos pesos."""
    if not _in_group(visitor_id, exp):
        return None
    b = bucket_of(visitor_id, exp["id"])
    included = _js_round(float(exp.get("traffic", 100)) * (BUCKETS / 100))
    if b >= included:
        return None
    variations = exp["variations"]
    total = sum(v["weight"] for v in variations)
    if total <= 0:
        return None
    point = (b / included) * total
    for v in variations:
        if point < v["weight"]:
            return v
        point -= v["weight"]
    return variations[-1]


# --- Conversões de tipo do JS usadas nas regras de flag (String(v), Number(v), trim) ---

_JS_WS = "\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
_DEC = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")  # [0-9]: \d do Python aceita dígitos Unicode
_RADIX = re.compile(r"0([xXoObB])([0-9a-fA-F]+)\Z")


def _js_trim(s: str) -> str:
    return s.strip(_JS_WS)


def _js_num_str(f: float) -> str:
    """Number.prototype.toString: dígitos mais curtos (repr) no formato do JS."""
    if math.isnan(f):
        return "NaN"
    if math.isinf(f):
        return "Infinity" if f > 0 else "-Infinity"
    if f == 0:
        return "0"
    sign = "-" if f < 0 else ""
    # repr = dígitos mais curtos; normaliza para 0.DIGITS × 10^n e formata pelas regras do JS
    mant, _, exp = repr(abs(f)).partition("e")
    whole, _, frac = mant.partition(".")
    raw = whole + frac
    digits = raw.lstrip("0")
    n = len(whole) + int(exp or 0) - (len(raw) - len(digits))
    digits = digits.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * -n + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def _js_string(v: Attr) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v) if abs(v) <= 2**53 else _js_num_str(float(v))
    if isinstance(v, float):
        return _js_num_str(v)
    return str(v)


def _js_number(v: Attr) -> float:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = _js_trim(str(v))
    if s == "":
        return 0.0
    if s in ("Infinity", "+Infinity"):
        return math.inf
    if s == "-Infinity":
        return -math.inf
    if _DEC.match(s):
        return float(s)
    m = _RADIX.match(s)
    if m:
        base = {"x": 16, "o": 8, "b": 2}[m.group(1).lower()]
        try:
            n = int(m.group(2), base)
        except ValueError:  # dígito inválido para a base (ex.: 0b2)
            return math.nan
        try:
            return float(n)
        except OverflowError:
            return math.inf
    return math.nan


def flag_rule_matches(rule: Mapping[str, str], attrs: Mapping[str, Attr]) -> bool:
    """Regra de atributo de flag (eq, neq, in, contains, gte, lte), idêntica à do SDK JS."""
    v = attrs.get(rule["attribute"])
    op, value = rule["op"], rule["value"]
    if v is None:
        return op == "neq"
    s = _js_string(v)
    if op == "eq":
        return s == value
    if op == "neq":
        return s != value
    if op == "in":
        return s in [_js_trim(x) for x in value.split(",")]
    if op == "contains":
        return value in s
    if op == "gte":
        return _js_number(v) >= _js_number(value)
    if op == "lte":
        return _js_number(v) <= _js_number(value)
    return False


@dataclass(frozen=True)
class Decision:
    key: str
    variation: str
    variables: Dict[str, Any] = field(default_factory=dict)


def _urllib_transport(timeout: float) -> Transport:
    def send(method: str, url: str, body: Optional[bytes]) -> Tuple[int, bytes]:
        headers = {"content-type": "text/plain"} if body is not None else {}
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (URL da conta)
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b""

    return send


class Client:
    """Cliente do SDK. Seguro entre threads. Use `close()` (ou `with`) ao encerrar para enviar o que falta."""

    def __init__(
        self,
        account_id: str,
        cdn_url: str = "",
        *,
        refresh_ms: int = 60_000,
        flush_ms: int = 2_000,
        config: Optional[Dict[str, Any]] = None,
        transport: Optional[Transport] = None,
        timeout: float = 10.0,
    ) -> None:
        self.account_id = account_id
        self._url = f"{cdn_url.rstrip('/')}/{account_id}.sdk.json"
        self._send = transport or _urllib_transport(timeout)
        self._config = config
        self._lock = threading.Lock()
        self._queue: List[Dict[str, Any]] = []
        self._exposed: set = set()
        self._stop = threading.Event()
        if self._config is None:
            self._load()
        self._threads = [
            threading.Thread(target=self._every, args=(ms / 1000, fn), daemon=True, name=f"experimenta-{fn.__name__}")
            for ms, fn in ((refresh_ms, self._load), (flush_ms, self.flush))
            if ms > 0
        ]
        for t in self._threads:
            t.start()

    # --- ciclo de vida ---
    def _every(self, seconds: float, fn: Callable[[], Any]) -> None:
        while not self._stop.wait(seconds):
            fn()

    def _load(self) -> None:
        try:
            status, body = self._send("GET", self._url, None)
            if 200 <= status < 300:
                self._config = json.loads(body)
        except Exception:  # noqa: BLE001 — mantém a última config válida
            pass

    def close(self) -> None:
        """Para as threads e envia os eventos pendentes."""
        self._stop.set()
        self.flush()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def version(self) -> int:
        return (self._config or {}).get("version", 0)

    # --- decisões ---
    def _flag(self, key: str) -> Optional[Mapping[str, Any]]:
        return next((f for f in (self._config or {}).get("flags", []) if f["key"] == key), None)

    def _experiment(self, key: str) -> Optional[Mapping[str, Any]]:
        return next((e for e in (self._config or {}).get("experiments", []) if e["key"] == key), None)

    def is_enabled(self, key: str, user_id: str, attrs: Optional[Mapping[str, Attr]] = None) -> bool:
        """Flag ativa para este usuário? (ligada + regras de atributo + dentro do rollout)."""
        flag = self._flag(key)
        if not flag or not flag.get("enabled"):
            return False
        if not all(flag_rule_matches(r, attrs or {}) for r in flag.get("rules", [])):
            return False
        return bucket_of(user_id, f"flag:{key}") < _js_round(float(flag.get("rollout", 100)) * (BUCKETS / 100))

    def get_variables(self, key: str, user_id: str, attrs: Optional[Mapping[str, Attr]] = None) -> Dict[str, Any]:
        """Variáveis da flag (vazio quando inativa)."""
        flag = self._flag(key)
        return dict(flag.get("variables") or {}) if flag and self.is_enabled(key, user_id, attrs) else {}

    def get_variation(self, experiment_key: str, user_id: str) -> Optional[Decision]:
        """Variação da campanha server-side (registra a exposição na 1ª vez). None = fora do tráfego/inexistente."""
        exp = self._experiment(experiment_key)
        if not exp:
            return None
        v = choose_variation(user_id, exp)
        if not v:
            return None
        with self._lock:
            mark = f"{exp['id']}|{user_id}"
            if mark not in self._exposed:
                self._exposed.add(mark)
                self._queue.append(
                    {
                        **self._base(user_id),
                        "type": "exposure",
                        "experimentId": exp["id"],
                        "experimentKey": exp["key"],
                        "variationId": v["id"],
                        "variationKey": v["key"],
                    }
                )
        return Decision(key=v["key"], variation=v["key"], variables=dict(v.get("variables") or {}))

    def track(
        self,
        event: str,
        user_id: str,
        value: Optional[float] = None,
        props: Optional[Mapping[str, Union[str, int, float, bool]]] = None,
    ) -> None:
        """Evento do usuário; vira conversão nas campanhas em que ele está com meta customizada deste nome."""
        extra = {"value": value} if value is not None else {}
        events = [{**self._base(user_id), "type": "event", "name": event, **extra, **({"props": dict(props)} if props is not None else {})}]
        for exp in (self._config or {}).get("experiments", []):
            v = choose_variation(user_id, exp)
            if not v:
                continue
            for g in exp.get("goals", []):
                if g.get("type") == "custom" and g.get("event") == event:
                    events.append(
                        {
                            **self._base(user_id),
                            "type": "conversion",
                            "experimentId": exp["id"],
                            "experimentKey": exp["key"],
                            "variationId": v["id"],
                            "variationKey": v["key"],
                            "goalId": g["id"],
                            "goalKey": g["key"],
                            **extra,
                        }
                    )
        with self._lock:
            self._queue.extend(events)

    def flush(self) -> None:
        """Envia agora os eventos pendentes (em falha de rede, voltam para a fila)."""
        url = (self._config or {}).get("trackingUrl")
        with self._lock:
            if not self._queue or not url:
                return
            events, self._queue = self._queue, []
        try:
            self._send("POST", url, json.dumps({"events": events}, separators=(",", ":")).encode())
        except Exception:  # noqa: BLE001 — tenta de novo no próximo envio
            with self._lock:
                self._queue[:0] = events

    def _base(self, user_id: str) -> Dict[str, Any]:
        return {
            "eventId": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "accountId": self.account_id,
            "visitorId": user_id,
            "url": "sdk://server",
        }
