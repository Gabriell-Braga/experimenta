package experimenta

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// Compatibilidade com o SDK JS/TS: confere decisão por decisão contra sdks/test-vectors.json.

type vectors struct {
	Config  json.RawMessage `json:"config"`
	Murmur3 []struct {
		Input string `json:"input"`
		Hash  uint32 `json:"hash"`
	} `json:"murmur3"`
	Users       []string `json:"users"`
	Experiments []struct {
		Key        string    `json:"key"`
		Variations []*string `json:"variations"`
	} `json:"experiments"`
	Flags []struct {
		Key        string     `json:"key"`
		Attributes Attributes `json:"attributes"`
		Enabled    []bool     `json:"enabled"`
	} `json:"flags"`
	Rules []struct {
		Rule       Rule       `json:"rule"`
		Attributes Attributes `json:"attributes"`
		Match      bool       `json:"match"`
	} `json:"rules"`
	Track struct {
		Calls []struct {
			Call       string         `json:"call"`
			Experiment string         `json:"experiment"`
			Event      string         `json:"event"`
			UserID     string         `json:"userId"`
			Value      *float64       `json:"value"`
			Props      map[string]any `json:"props"`
			Result     *struct {
				Key       string         `json:"key"`
				Variables map[string]any `json:"variables"`
			} `json:"result"`
		} `json:"calls"`
		Events []map[string]any `json:"events"`
	} `json:"track"`
}

func load(t *testing.T) (vectors, *Config) {
	t.Helper()
	b, err := os.ReadFile("../test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	if err := json.Unmarshal(v.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	return v, &cfg
}

// roundTrip captura as requisições sem rede.
type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func respond(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}

func client(cfg *Config, rt roundTrip) *Client {
	if rt == nil {
		rt = func(*http.Request) (*http.Response, error) { return respond(204, ""), nil }
	}
	return New(Options{
		AccountID: cfg.AccountID, Config: cfg, RefreshInterval: -1, FlushInterval: -1,
		HTTPClient: &http.Client{Transport: rt},
	})
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestMurmur3(t *testing.T) {
	v, _ := load(t)
	for _, c := range v.Murmur3 {
		if got := Murmurhash3(c.Input, 0); got != c.Hash {
			t.Errorf("murmur3(%q) = %d, esperado %d", c.Input, got, c.Hash)
		}
	}
}

func TestExperiments(t *testing.T) {
	v, cfg := load(t)
	c := client(cfg, nil)
	for _, e := range v.Experiments {
		for i, u := range v.Users {
			d := c.GetVariation(e.Key, u)
			got, want := "<nil>", "<nil>"
			if d != nil {
				got = d.Key
			}
			if e.Variations[i] != nil {
				want = *e.Variations[i]
			}
			if got != want {
				t.Errorf("%s / %q: %s, esperado %s", e.Key, u, got, want)
			}
		}
	}
}

func TestFlags(t *testing.T) {
	v, cfg := load(t)
	c := client(cfg, nil)
	for _, f := range v.Flags {
		for i, u := range v.Users {
			if got := c.IsEnabled(f.Key, u, f.Attributes); got != f.Enabled[i] {
				t.Errorf("%s / %q / %v: %v, esperado %v", f.Key, u, f.Attributes, got, f.Enabled[i])
			}
			want := "{}"
			if f.Enabled[i] {
				if want = asJSON(t, c.flag(f.Key).Variables); want == "null" {
					want = "{}"
				}
			}
			if got := asJSON(t, c.GetVariables(f.Key, u, f.Attributes)); got != want {
				t.Errorf("variáveis %s / %q: %s, esperado %s", f.Key, u, got, want)
			}
		}
	}
	if c.IsEnabled("nao-existe", "u1", nil) {
		t.Error("flag inexistente ativa")
	}
}

func TestRules(t *testing.T) {
	v, _ := load(t)
	for _, r := range v.Rules {
		if got := FlagRuleMatches(r.Rule, r.Attributes); got != r.Match {
			t.Errorf("%+v com %v: %v, esperado %v", r.Rule, r.Attributes, got, r.Match)
		}
	}
}

func TestTrackEvents(t *testing.T) {
	v, cfg := load(t)
	var posts []map[string][]map[string]any
	c := client(cfg, func(r *http.Request) (*http.Response, error) {
		if r.Method != "POST" || r.URL.String() != cfg.TrackingURL {
			t.Errorf("requisição inesperada %s %s", r.Method, r.URL)
		}
		var p map[string][]map[string]any
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Fatal(err)
		}
		posts = append(posts, p)
		return respond(204, ""), nil
	})
	for _, call := range v.Track.Calls {
		if call.Call == "track" {
			var opts []TrackOption
			if call.Value != nil {
				opts = append(opts, WithValue(*call.Value))
			}
			if call.Props != nil {
				opts = append(opts, WithProps(call.Props))
			}
			c.Track(call.Event, call.UserID, opts...)
			continue
		}
		d := c.GetVariation(call.Experiment, call.UserID)
		var got any
		if d != nil {
			got = map[string]any{"key": d.Key, "variables": d.Variables}
		}
		if asJSON(t, got) != asJSON(t, call.Result) {
			t.Errorf("getVariation(%s, %q) = %s, esperado %s", call.Experiment, call.UserID, asJSON(t, got), asJSON(t, call.Result))
		}
	}
	c.Close()
	var events []map[string]any
	for _, p := range posts {
		for _, e := range p["events"] {
			if id, ok := e["eventId"].(string); !ok || len(id) != 36 {
				t.Errorf("eventId inválido: %v", e["eventId"])
			}
			if ts, ok := e["ts"].(float64); !ok || ts != float64(int64(ts)) {
				t.Errorf("ts inválido: %v", e["ts"])
			}
			delete(e, "eventId")
			delete(e, "ts")
			events = append(events, e)
		}
	}
	if !reflect.DeepEqual(events, v.Track.Events) {
		t.Errorf("eventos diferentes:\n%s\nesperado:\n%s", asJSON(t, events), asJSON(t, v.Track.Events))
	}
}

func TestLoadsConfigAndKeepsLastOnFailure(t *testing.T) {
	_, cfg := load(t)
	body := asJSON(t, cfg)
	var urls []string
	rt := roundTrip(func(r *http.Request) (*http.Response, error) {
		urls = append(urls, r.URL.String())
		if len(urls) > 1 {
			return nil, errors.New("rede caiu")
		}
		return respond(200, body), nil
	})
	c := New(Options{AccountID: "acc-vetores", CDNURL: "https://cdn.test/", RefreshInterval: -1, FlushInterval: -1,
		HTTPClient: &http.Client{Transport: rt}})
	if len(urls) != 1 || urls[0] != "https://cdn.test/acc-vetores.sdk.json" || c.Version() != 7 {
		t.Fatalf("urls=%v versão=%d", urls, c.Version())
	}
	c.load()
	if c.Version() != 7 {
		t.Error("perdeu a config após falha de rede")
	}
}

func TestWithoutConfigEverythingIsOff(t *testing.T) {
	c := New(Options{AccountID: "x", CDNURL: "https://cdn.test", RefreshInterval: -1, FlushInterval: -1,
		HTTPClient: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			return respond(404, ""), nil
		})}})
	if c.IsEnabled("rollout-100", "u1", nil) || c.GetVariation("meio-a-meio", "u1") != nil {
		t.Error("sem config deveria estar tudo desligado")
	}
	c.Track("compra", "u1")
	c.Close()
}

func TestFailedFlushRequeuesAndTimerFlushes(t *testing.T) {
	_, cfg := load(t)
	var mu sync.Mutex
	fail := true
	var users []string
	sent := make(chan struct{}, 10)
	rt := roundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		if fail {
			return nil, errors.New("timeout")
		}
		var p map[string][]map[string]any
		_ = json.NewDecoder(r.Body).Decode(&p)
		for _, e := range p["events"] {
			if e["type"] == "event" {
				users = append(users, e["visitorId"].(string))
			}
		}
		sent <- struct{}{}
		return respond(204, ""), nil
	})
	c := client(cfg, rt)
	c.Track("compra", "u1")
	c.Flush()
	mu.Lock()
	fail = false
	mu.Unlock()
	c.Track("compra", "u2")
	c.Flush()
	if !reflect.DeepEqual(users, []string{"u1", "u2"}) {
		t.Errorf("reenvio: %v", users)
	}
	<-sent // descarta o aviso do envio manual

	timed := New(Options{AccountID: cfg.AccountID, Config: cfg, RefreshInterval: -1, FlushInterval: 20 * time.Millisecond,
		HTTPClient: &http.Client{Transport: rt}})
	defer timed.Close()
	timed.Track("compra", "u3")
	select {
	case <-sent:
	case <-time.After(2 * time.Second):
		t.Error("timer não enviou")
	}
}
