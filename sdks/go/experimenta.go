// Package experimenta é o SDK server-side do Experimenta para Go (1.21+, só stdlib).
//
// Mesma API e semântica do SDK JS/TS (packages/sdk): baixa `<conta>.sdk.json` da CDN, guarda em memória e
// recarrega em segundo plano; decide flags e campanhas localmente com o mesmo bucketing do snippet
// (MurmurHash3 x86 32 bits sobre UTF-8); junta exposições/eventos/conversões e envia para o /collect.
// Compatibilidade conferida por sdks/test-vectors.json.
package experimenta

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"math/bits"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Buckets é a resolução do bucketing (0–9999), igual ao snippet.
const Buckets = 10000

// Rule é uma regra de atributo de flag.
type Rule struct {
	Attribute string `json:"attribute"`
	Op        string `json:"op"` // eq, neq, in, contains, gte, lte
	Value     string `json:"value"`
}

// Flag é uma feature flag publicada.
type Flag struct {
	Key       string         `json:"key"`
	Enabled   bool           `json:"enabled"`
	Rollout   float64        `json:"rollout"`
	Rules     []Rule         `json:"rules"`
	Variables map[string]any `json:"variables"`
}

// UnmarshalJSON aplica os padrões do schema (rollout 100).
func (f *Flag) UnmarshalJSON(b []byte) error {
	type raw Flag
	r := raw{Rollout: 100}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	*f = Flag(r)
	return nil
}

// Variation é uma variação de campanha server-side.
type Variation struct {
	ID        string         `json:"id"`
	Key       string         `json:"key"`
	Weight    float64        `json:"weight"`
	Variables map[string]any `json:"variables"`
}

// Goal é uma meta da campanha; só as do tipo "custom" viram conversão no SDK.
type Goal struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Type  string `json:"type"`
	Event string `json:"event"`
}

// Group é um grupo mutuamente exclusivo: o visitante entra se bucket(visitante, grupo) % 100 estiver em Slots.
type Group struct {
	ID    string `json:"id"`
	Slots []int  `json:"slots"`
}

// Experiment é uma campanha server-side.
type Experiment struct {
	ID         string      `json:"id"`
	Key        string      `json:"key"`
	Traffic    float64     `json:"traffic"`
	Variations []Variation `json:"variations"`
	Goals      []Goal      `json:"goals"`
	Group      *Group      `json:"group,omitempty"`
}

// UnmarshalJSON aplica os padrões do schema (tráfego 100).
func (e *Experiment) UnmarshalJSON(b []byte) error {
	type raw Experiment
	r := raw{Traffic: 100}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	*e = Experiment(r)
	return nil
}

// Config é o conteúdo de `<conta>.sdk.json`.
type Config struct {
	AccountID   string       `json:"accountId"`
	Version     int          `json:"version"`
	PublishedAt string       `json:"publishedAt"`
	TrackingURL string       `json:"trackingUrl,omitempty"`
	Flags       []Flag       `json:"flags"`
	Experiments []Experiment `json:"experiments"`
}

// Murmurhash3 é o MurmurHash3 x86 32 bits sobre os bytes da string (UTF-8). uint32 dá a aritmética
// módulo 2^32 que o JS faz com Math.imul e >>> 0.
func Murmurhash3(key string, seed uint32) uint32 {
	data := []byte(key)
	n := len(data)
	const c1, c2 = 0xcc9e2d51, 0x1b873593
	h := seed
	nb := n / 4
	for i := 0; i < nb; i++ {
		k := binary.LittleEndian.Uint32(data[i*4:])
		k *= c1
		k = bits.RotateLeft32(k, 15)
		k *= c2
		h ^= k
		h = bits.RotateLeft32(h, 13)
		h = h*5 + 0xe6546b64
	}
	var k uint32
	tail := data[nb*4:]
	switch len(tail) {
	case 3:
		k ^= uint32(tail[2]) << 16
		fallthrough
	case 2:
		k ^= uint32(tail[1]) << 8
		fallthrough
	case 1:
		k ^= uint32(tail[0])
		k *= c1
		k = bits.RotateLeft32(k, 15)
		k *= c2
		h ^= k
	}
	h ^= uint32(n)
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}

// BucketOf é o balde (0–9999) do visitante para um id (experimento, grupo ou "flag:<chave>").
func BucketOf(visitorID, salt string) int {
	return int(Murmurhash3(visitorID+salt, 0) % Buckets)
}

// jsRound é o Math.round do JS (meio arredonda para cima).
func jsRound(x float64) int {
	f := math.Floor(x)
	if x-f >= 0.5 {
		f++
	}
	return int(f)
}

func inGroup(visitorID string, e *Experiment) bool {
	if e.Group == nil {
		return true
	}
	slot := BucketOf(visitorID, e.Group.ID) % 100
	for _, s := range e.Group.Slots {
		if s == slot {
			return true
		}
	}
	return false
}

// ChooseVariation é a mesma escolha do snippet: grupo exclusivo → tráfego → variação proporcional aos pesos.
// nil = fora do grupo/tráfego.
func ChooseVariation(visitorID string, e *Experiment) *Variation {
	if !inGroup(visitorID, e) {
		return nil
	}
	b := BucketOf(visitorID, e.ID)
	included := jsRound(e.Traffic * (Buckets / 100))
	if b >= included {
		return nil
	}
	total := 0.0
	for _, v := range e.Variations {
		total += v.Weight
	}
	if total <= 0 {
		return nil
	}
	point := float64(b) / float64(included) * total
	for i := range e.Variations {
		if point < e.Variations[i].Weight {
			return &e.Variations[i]
		}
		point -= e.Variations[i].Weight
	}
	return &e.Variations[len(e.Variations)-1]
}

// Attributes são os atributos do usuário para as regras de flag (string, bool ou números).
type Attributes map[string]any

// Decision é a variação escolhida numa campanha server-side.
type Decision struct {
	Key       string
	Variation string
	Variables map[string]any
}

// Options configura o cliente.
type Options struct {
	AccountID string
	// CDNURL é a base da CDN (ex.: https://api.exemplo.com/cdn); o SDK baixa `<conta>.sdk.json`.
	CDNURL string
	// RefreshInterval recarrega a config (0 = 60 s; negativo = nunca).
	RefreshInterval time.Duration
	// FlushInterval envia os eventos juntos (0 = 2 s; negativo = só em Flush/Close).
	FlushInterval time.Duration
	// HTTPClient para a CDN e o /collect (padrão: timeout de 10 s).
	HTTPClient *http.Client
	// Config já carregada (testes, ambientes sem rede): não baixa na criação.
	Config *Config
}

// Client avalia flags e campanhas. Seguro entre goroutines. Chame Close ao encerrar.
type Client struct {
	opts    Options
	http    *http.Client
	config  atomic.Pointer[Config]
	mu      sync.Mutex
	queue   []map[string]any
	exposed map[string]struct{}
	stop    chan struct{}
	wg      sync.WaitGroup
	once    sync.Once
}

// New cria o cliente. Sem Config, baixa a da CDN agora; falha de rede deixa o cliente sem config (tudo
// desligado/nil) até o próximo refresh, como no SDK JS.
func New(opts Options) *Client {
	c := &Client{opts: opts, http: opts.HTTPClient, exposed: map[string]struct{}{}, stop: make(chan struct{})}
	if c.http == nil {
		c.http = &http.Client{Timeout: 10 * time.Second}
	}
	if opts.Config != nil {
		c.config.Store(opts.Config)
	} else {
		c.load()
	}
	c.every(opts.RefreshInterval, 60*time.Second, c.load)
	c.every(opts.FlushInterval, 2*time.Second, c.Flush)
	return c
}

func (c *Client) every(d, def time.Duration, fn func()) {
	if d < 0 {
		return
	}
	if d == 0 {
		d = def
	}
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		t := time.NewTicker(d)
		defer t.Stop()
		for {
			select {
			case <-c.stop:
				return
			case <-t.C:
				fn()
			}
		}
	}()
}

func (c *Client) load() {
	url := strings.TrimRight(c.opts.CDNURL, "/") + "/" + c.opts.AccountID + ".sdk.json"
	r, err := c.http.Get(url)
	if err != nil {
		return // mantém a última config válida
	}
	defer r.Body.Close()
	if r.StatusCode < 200 || r.StatusCode > 299 {
		return
	}
	var cfg Config
	if json.NewDecoder(r.Body).Decode(&cfg) == nil {
		c.config.Store(&cfg)
	}
}

// Version é a versão publicada da config carregada (0 = nenhuma).
func (c *Client) Version() int {
	if cfg := c.config.Load(); cfg != nil {
		return cfg.Version
	}
	return 0
}

func (c *Client) flag(key string) *Flag {
	if cfg := c.config.Load(); cfg != nil {
		for i := range cfg.Flags {
			if cfg.Flags[i].Key == key {
				return &cfg.Flags[i]
			}
		}
	}
	return nil
}

func (c *Client) experiment(key string) *Experiment {
	if cfg := c.config.Load(); cfg != nil {
		for i := range cfg.Experiments {
			if cfg.Experiments[i].Key == key {
				return &cfg.Experiments[i]
			}
		}
	}
	return nil
}

// IsEnabled diz se a flag está ativa para o usuário (ligada + regras de atributo + dentro do rollout).
func (c *Client) IsEnabled(key, userID string, attrs Attributes) bool {
	f := c.flag(key)
	if f == nil || !f.Enabled {
		return false
	}
	for _, r := range f.Rules {
		if !FlagRuleMatches(r, attrs) {
			return false
		}
	}
	return BucketOf(userID, "flag:"+key) < jsRound(f.Rollout*(Buckets/100))
}

// GetVariables devolve as variáveis da flag (vazio quando inativa). Cópia rasa: pode alterar o mapa.
func (c *Client) GetVariables(key, userID string, attrs Attributes) map[string]any {
	if !c.IsEnabled(key, userID, attrs) {
		return map[string]any{}
	}
	if v := maps.Clone(c.flag(key).Variables); v != nil {
		return v
	}
	return map[string]any{}
}

// GetVariation devolve a variação da campanha server-side e registra a exposição na 1ª vez por usuário.
// nil = campanha inexistente ou usuário fora do tráfego/grupo.
func (c *Client) GetVariation(experimentKey, userID string) *Decision {
	e := c.experiment(experimentKey)
	if e == nil {
		return nil
	}
	v := ChooseVariation(userID, e)
	if v == nil {
		return nil
	}
	c.mu.Lock()
	mark := e.ID + "|" + userID
	if _, ok := c.exposed[mark]; !ok {
		c.exposed[mark] = struct{}{}
		ev := c.base(userID)
		ev["type"] = "exposure"
		ev["experimentId"], ev["experimentKey"] = e.ID, e.Key
		ev["variationId"], ev["variationKey"] = v.ID, v.Key
		c.queue = append(c.queue, ev)
	}
	c.mu.Unlock()
	vars := maps.Clone(v.Variables)
	if vars == nil {
		vars = map[string]any{}
	}
	return &Decision{Key: v.Key, Variation: v.Key, Variables: vars}
}

type trackOptions struct {
	value *float64
	props map[string]any
}

// TrackOption ajusta um evento de Track.
type TrackOption func(*trackOptions)

// WithValue manda um valor (receita) no evento e nas conversões.
func WithValue(v float64) TrackOption { return func(o *trackOptions) { o.value = &v } }

// WithProps manda propriedades (string, número ou bool) no evento.
func WithProps(p map[string]any) TrackOption { return func(o *trackOptions) { o.props = p } }

// Track registra um evento do usuário. Também vira conversão nas campanhas server-side em que ele está e
// que têm meta customizada com este nome.
func (c *Client) Track(event, userID string, opts ...TrackOption) {
	var o trackOptions
	for _, fn := range opts {
		fn(&o)
	}
	ev := c.base(userID)
	ev["type"], ev["name"] = "event", event
	if o.value != nil {
		ev["value"] = *o.value
	}
	if o.props != nil {
		ev["props"] = o.props
	}
	events := []map[string]any{ev}
	if cfg := c.config.Load(); cfg != nil {
		for i := range cfg.Experiments {
			e := &cfg.Experiments[i]
			v := ChooseVariation(userID, e)
			if v == nil {
				continue
			}
			for _, g := range e.Goals {
				if g.Type != "custom" || g.Event != event {
					continue
				}
				conv := c.base(userID)
				conv["type"] = "conversion"
				conv["experimentId"], conv["experimentKey"] = e.ID, e.Key
				conv["variationId"], conv["variationKey"] = v.ID, v.Key
				conv["goalId"], conv["goalKey"] = g.ID, g.Key
				if o.value != nil {
					conv["value"] = *o.value
				}
				events = append(events, conv)
			}
		}
	}
	c.mu.Lock()
	c.queue = append(c.queue, events...)
	c.mu.Unlock()
}

// Flush envia agora os eventos pendentes (em falha de rede, voltam para a fila).
func (c *Client) Flush() {
	cfg := c.config.Load()
	c.mu.Lock()
	if len(c.queue) == 0 || cfg == nil || cfg.TrackingURL == "" {
		c.mu.Unlock()
		return
	}
	events := c.queue
	c.queue = nil
	c.mu.Unlock()
	body, err := json.Marshal(map[string]any{"events": events})
	if err != nil {
		return // props com tipo que não vira JSON: descarta o lote em vez de travar a fila
	}
	r, err := c.http.Post(cfg.TrackingURL, "text/plain", bytes.NewReader(body))
	if err != nil {
		c.mu.Lock()
		c.queue = append(events, c.queue...)
		c.mu.Unlock()
		return
	}
	r.Body.Close()
}

// Close para os timers e envia o que falta.
func (c *Client) Close() {
	c.once.Do(func() {
		close(c.stop)
		c.wg.Wait()
		c.Flush()
	})
}

func (c *Client) base(userID string) map[string]any {
	return map[string]any{
		"eventId":   uuid4(),
		"ts":        time.Now().UnixMilli(),
		"accountId": c.opts.AccountID,
		"visitorId": userID,
		"url":       "sdk://server",
	}
}

func uuid4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
