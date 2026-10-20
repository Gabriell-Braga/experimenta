"""Compatibilidade com o SDK JS/TS: confere decisão por decisão contra sdks/test-vectors.json."""

import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from experimenta import Client, flag_rule_matches, murmurhash3  # noqa: E402

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[2] / "test-vectors.json").read_text("utf-8"))


def client(transport=None, **kw):
    return Client(
        VECTORS["config"]["accountId"],
        config=VECTORS["config"],
        refresh_ms=0,
        flush_ms=0,
        transport=transport or (lambda *a: (204, b"")),
        **kw,
    )


class VectorsTest(unittest.TestCase):
    def test_murmur3(self):
        for c in VECTORS["murmur3"]:
            self.assertEqual(murmurhash3(c["input"]), c["hash"], repr(c["input"]))

    def test_experiments(self):
        c = client()
        for e in VECTORS["experiments"]:
            for user, expected in zip(VECTORS["users"], e["variations"]):
                d = c.get_variation(e["key"], user)
                self.assertEqual(d.key if d else None, expected, f"{e['key']} / {user!r}")

    def test_flags(self):
        c = client()
        flags = {f["key"]: f for f in VECTORS["config"]["flags"]}
        for f in VECTORS["flags"]:
            for user, expected in zip(VECTORS["users"], f["enabled"]):
                self.assertEqual(c.is_enabled(f["key"], user, f["attributes"]), expected, f"{f['key']} / {user!r}")
                self.assertEqual(
                    c.get_variables(f["key"], user, f["attributes"]),
                    flags[f["key"]]["variables"] if expected else {},
                )
        self.assertFalse(c.is_enabled("nao-existe", "u1"))

    def test_rules(self):
        for r in VECTORS["rules"]:
            self.assertEqual(flag_rule_matches(r["rule"], r["attributes"]), r["match"], r)

    def test_track_events(self):
        posts = []

        def transport(method, url, body):
            self.assertEqual((method, url), ("POST", VECTORS["config"]["trackingUrl"]))
            posts.append(json.loads(body))
            return 204, b""

        c = client(transport)
        for call in VECTORS["track"]["calls"]:
            if call["call"] == "track":
                self.assertIsNone(c.track(call["event"], call["userId"], call.get("value"), call.get("props")))
            else:
                d = c.get_variation(call["experiment"], call["userId"])
                self.assertEqual(d and {"key": d.key, "variables": d.variables}, call["result"])
        c.close()
        events = [e for p in posts for e in p["events"]]
        for e in events:
            self.assertIsInstance(e.pop("eventId"), str)
            self.assertIsInstance(e.pop("ts"), int)
        self.assertEqual(events, VECTORS["track"]["events"])


class ClientTest(unittest.TestCase):
    def test_loads_config_from_cdn_and_keeps_last_on_failure(self):
        calls = []

        def transport(method, url, body):
            calls.append(url)
            if len(calls) > 1:
                raise OSError("rede caiu")
            return 200, json.dumps(VECTORS["config"]).encode()

        c = Client("acc-vetores", "https://cdn.test/", refresh_ms=0, flush_ms=0, transport=transport)
        self.assertEqual(calls, ["https://cdn.test/acc-vetores.sdk.json"])
        self.assertEqual(c.version, 7)
        c._load()
        self.assertEqual(c.version, 7)

    def test_without_config_everything_is_off(self):
        c = Client("x", "https://cdn.test", refresh_ms=0, flush_ms=0, transport=lambda *a: (404, b""))
        self.assertFalse(c.is_enabled("rollout-100", "u1"))
        self.assertIsNone(c.get_variation("meio-a-meio", "u1"))
        c.track("compra", "u1")
        c.close()  # sem trackingUrl: não envia nem quebra

    def test_failed_flush_requeues(self):
        fail = [True]
        posts = []

        def transport(method, url, body):
            if fail[0]:
                raise OSError("timeout")
            posts.append(json.loads(body))
            return 204, b""

        c = client(transport)
        c.track("compra", "u1")
        c.flush()
        fail[0] = False
        c.track("compra", "u2")
        c.flush()
        self.assertEqual([e["visitorId"] for e in posts[0]["events"] if e["type"] == "event"], ["u1", "u2"])

    def test_background_threads_flush(self):
        import threading

        sent = threading.Event()
        c = Client(
            "acc-vetores",
            config=VECTORS["config"],
            refresh_ms=0,
            flush_ms=20,
            transport=lambda *a: (sent.set(), (204, b""))[1],
        )
        c.track("compra", "u1")
        self.assertTrue(sent.wait(2))
        c.close()


if __name__ == "__main__":
    unittest.main()
