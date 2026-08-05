/*
 * Online Boutique — k6 load scenario (P5).
 *
 * PURPOSE: find which component saturates first, and at what user load. This is
 * NOT a smoke test and NOT an availability check — those answer "does it work".
 * This answers "where does it stop working, and who breaks first".
 *
 * GROUND TRUTH vs ATTRIBUTION — read this before trusting any number.
 * k6 runs OUTSIDE the cluster, so its latency/error numbers cannot be distorted
 * by anything inside it. The RED metrics from the span_metrics connector CAN be:
 * the collector has a 384Mi limit, a memory_limiter, and no sampling anywhere
 * (applications/platform/otel-collector.yaml), so under load it sheds spans and
 * calls_total UNDERCOUNTS. Therefore:
 *   k6 numbers   -> how bad it is for a real user   (authoritative)
 *   RED / traces -> which service is responsible    (attribution only)
 * If the two disagree, the collector is dropping data — check
 * otelcol_processor_refused_spans before concluding anything about the app.
 *
 * WORKLOAD MODEL is copied from the upstream Locust file, not invented:
 *   src/loadgenerator/locustfile.py:83-88 (task weights)
 *   src/loadgenerator/locustfile.py:92    (wait_time between(1,10))
 * Keeping the same mix means results stay comparable to what upstream users see,
 * and means the ratios are not a number we have to defend.
 *
 * EVERY constant below was read from source, not guessed:
 *   product IDs        src/productcatalogservice/products.json
 *   form field names   src/frontend/handlers.go:213-214, 325-334
 *   quantity 1..10     src/frontend/validator/validator.go:38 (gte=1,lte=10)
 *   card number        src/frontend/templates/cart.html:168 — the upstream demo
 *                      card, already in this repo; passes the `credit_card`
 *                      validator at validator.go:49 (Luhn + Visa issuer).
 *                      A card that fails validation returns 422 and the whole
 *                      checkout arm measures an error path instead of a checkout.
 *   success marker     src/frontend/templates/order.html:33
 *
 * Usage (see docs/runbooks/loadtest-dev.md in the infra repo for the full run):
 *   k6 run -e PROFILE=smoke boutique.js
 *   k6 run -e PROFILE=ramp  -e BASE_URL=https://... --out json=ramp.json boutique.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://boutique-dev.devops.sotatek.works';
const PROFILE = __ENV.PROFILE || 'smoke';

/* ── Load profiles ──────────────────────────────────────────────────────────
 * Step durations are 5m and that number is load-bearing, not a round figure:
 *   - Prometheus scrapes every 30s (kube-prometheus-stack.yaml:76) => a 5m step
 *     yields 10 samples, the minimum for a credible steady-state mean.
 *   - The HPA's scale-down stabilization window is 300s. A shorter step measures
 *     the TRANSIENT of the autoscaler, not the capacity of the system.
 * Reading a transient and calling it a bottleneck is how you end up optimising
 * a service that was never the constraint.
 */
const PROFILES = {
  // Gate before spending anything: every journey must return 2xx at least once.
  // Catches wrong host, wrong form field, failed validation — all of which
  // otherwise show up mid-ramp as "errors under load" and send you hunting a
  // capacity problem that is really a typo.
  smoke: [{ duration: '1m', target: 1 }],

  // The actual experiment. Closed model (VUs + think time) on purpose: when the
  // system slows, users wait and throughput stops rising — that flattening IS
  // the knee. An open model would keep firing requests into a queue and report
  // a cliff instead of a knee.
  ramp: [
    { duration: '1m', target: 10 },  { duration: '5m', target: 10 },
    { duration: '1m', target: 25 },  { duration: '5m', target: 25 },
    { duration: '1m', target: 50 },  { duration: '5m', target: 50 },
    { duration: '1m', target: 100 }, { duration: '5m', target: 100 },
    { duration: '1m', target: 200 }, { duration: '5m', target: 200 },
    { duration: '1m', target: 400 }, { duration: '5m', target: 400 },
    { duration: '1m', target: 0 },
  ],

  // Only worth running AFTER a knee is found. Hold at ~80% of it to expose the
  // failures that need time rather than load: Tempo has a 1Gi limit with
  // emptyDir and has already been OOMKilled once (I-068), Grafana 30 times in
  // 18h (I-076). A 30m hold is where that class shows up.
  soak: [
    { duration: '2m', target: Number(__ENV.SOAK_VUS || 50) },
    { duration: '30m', target: Number(__ENV.SOAK_VUS || 50) },
    { duration: '1m', target: 0 },
  ],
};

export const options = {
  stages: PROFILES[PROFILE],
  // The generator must never be the bottleneck. Bodies are dropped by default
  // and re-enabled per-request only where a check actually reads one, so VU
  // memory stays flat as concurrency climbs.
  discardResponseBodies: true,
  thresholds: {
    /* SLO family — REPORT ONLY, deliberately no abortOnFail. The stress steps
     * are supposed to breach these; that breach is the measurement. Aborting
     * here would cut the experiment exactly where it becomes informative. */
    'http_req_failed': [
      'rate<0.001',                       // 0.1% = the 99.9% error budget (I-078)
      /* Safety family — ABORTS. Not an SLO: this is "the system is gone, stop
       * paying for the cluster". delayAbortEval keeps a cold-start blip from
       * killing a run in its first seconds. */
      { threshold: 'rate<0.25', abortOnFail: true, delayAbortEval: '1m' },
    ],
    'http_req_duration{ep:home}': ['p(95)<500'],
    'http_req_duration{ep:product}': ['p(95)<500'],
    'http_req_duration{ep:cart_view}': ['p(95)<500'],
    // Checkout crosses checkout -> payment -> shipping -> email -> currency and
    // deserves its own budget. One budget for both would either be too loose to
    // catch a browse regression or too tight to ever pass on checkout.
    'http_req_duration{ep:checkout}': ['p(95)<1500'],
    'checks': ['rate>0.99'],
    // If k6 cannot start the iterations it planned, the numbers describe the
    // generator, not the app. Non-zero here invalidates the run.
    'dropped_iterations': ['count==0'],
  },
};

/* Orders that actually completed — not just "returned 200". A 200 carrying an
 * error page would otherwise be counted as a successful checkout, and the four
 * services that only run on checkout would look healthy while never being hit. */
const ordersPlaced = new Counter('orders_placed');

// src/productcatalogservice/products.json
const PRODUCTS = [
  '0PUK6V6EV0', '1YMWWN1N4O', '2ZYFJ3GM2N', '66VCHSJNUP', '6E92ZMYYFZ',
  '9SIQT8TOJO', 'L9ECAV7KIM', 'LS4PSXUNUM', 'OLJCESPC7Z',
];
const CURRENCIES = ['EUR', 'USD', 'JPY', 'CAD', 'GBP', 'TRY'];

// Helpers inlined rather than imported from jslib.k6.io: a remote import makes
// the run depend on the network reaching a third-party CDN mid-test, which is a
// failure mode that would read as application flakiness.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

/* Task weights verbatim from locustfile.py:83-88. Cumulative form so selection
 * is one comparison pass and the weights stay readable as the original numbers
 * rather than as pre-divided probabilities nobody can check against upstream. */
const TASKS = [
  ['index', 1], ['setCurrency', 2], ['browseProduct', 10],
  ['addToCart', 2], ['viewCart', 3], ['checkout', 1],
];
const TOTAL_WEIGHT = TASKS.reduce((s, t) => s + t[1], 0); // 19
function pickTask() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const [name, w] of TASKS) { if ((r -= w) < 0) return name; }
  return 'index';
}

/* Each VU gets its own cookie jar automatically, so each VU is one shopper with
 * one cart. Do NOT share a fixed shop_session-id across VUs: every cart read
 * would hit the same redis key and manufacture a hotspot that looks exactly
 * like a redis-cart bottleneck. */

function index() {
  const r = http.get(`${BASE}/`, { tags: { ep: 'home' } });
  check(r, { 'home 200': (x) => x.status === 200 });
}

function setCurrency() {
  const r = http.post(`${BASE}/setCurrency`, { currency_code: pick(CURRENCIES) },
    { tags: { ep: 'currency' } });
  check(r, { 'currency 200': (x) => x.status === 200 });
}

function browseProduct() {
  const r = http.get(`${BASE}/product/${pick(PRODUCTS)}`, { tags: { ep: 'product' } });
  check(r, { 'product 200': (x) => x.status === 200 });
}

function viewCart() {
  const r = http.get(`${BASE}/cart`, { tags: { ep: 'cart_view' } });
  check(r, { 'cart 200': (x) => x.status === 200 });
}

// Mirrors locust addToCart(): view the product first, then post. Keeping the
// GET means the ratio of catalog reads to cart writes matches upstream.
function addToCart() {
  const p = pick(PRODUCTS);
  http.get(`${BASE}/product/${p}`, { tags: { ep: 'product' } });
  const r = http.post(`${BASE}/cart`,
    { product_id: p, quantity: String(randInt(1, 10)) }, // lte=10 (validator.go:38)
    { tags: { ep: 'cart_add' } });
  check(r, { 'cart_add 200': (x) => x.status === 200 });
}

function checkout() {
  addToCart();
  const year = new Date().getFullYear() + 1;
  const r = http.post(`${BASE}/cart/checkout`, {
    email: `load-${randInt(1, 1e6)}@test.local`,
    street_address: '1600 Amphitheatre Parkway',
    zip_code: '94043',                    // int64 + required => must be non-zero
    city: 'Mountain View',
    state: 'CA',
    country: 'United States',
    credit_card_number: '4432801561520454',
    credit_card_expiration_month: String(randInt(1, 12)),
    credit_card_expiration_year: String(year),
    credit_card_cvv: String(randInt(100, 999)),
  }, { tags: { ep: 'checkout' }, responseType: 'text' });

  // Two separate assertions on purpose. A 422 from the validator and a 200
  // carrying an error page are different failures with the same consequence —
  // no order, so checkout/payment/shipping/email never run — and they need
  // different fixes.
  const done = check(r, {
    'checkout 200': (x) => x.status === 200,
    'order completed': (x) => x.body && x.body.includes('Your order is complete'),
  });
  if (done) ordersPlaced.add(1);
}

const FN = { index, setCurrency, browseProduct, addToCart, viewCart, checkout };

export default function () {
  FN[pickTask()]();
  sleep(1 + Math.random() * 9);          // locustfile.py:92 — between(1, 10)
}
