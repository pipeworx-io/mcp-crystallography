interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * Crystallography Open Database (COD) MCP.
 *
 * COD (https://www.crystallography.net/cod) is an open repository of crystal
 * structures of organic, inorganic, metal-organic, and mineral compounds.
 * Keyless. Search by compound name, chemical formula, or mineral name and get
 * unit-cell parameters, space group, and a link to the CIF structure file.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Crystallography Open Database');
}

const BASE = 'https://www.crystallography.net/cod';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_structures',
    description:
      'Search the Crystallography Open Database (COD), an open repository of crystal structures (inorganic, organic, metal-organic, and mineral). Search by compound name (free text), chemical formula, or mineral name; returns matching crystal structures with unit-cell parameters, space group, year, and a link to the CIF structure file. Keyless. Provide at least one of query, formula, or mineral. ' +
      'Formulas are normalized to COD\'s stored Hill notation for you, so "NaCl", "SiO2" and "CaCO3" all work; the response reports `formula_searched` with the exact string that was matched.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search (compound/common name, title words, author, etc.). e.g. "quartz", "aspirin".' },
        formula: {
          type: 'string',
          description:
            'Chemical formula in any common spelling — "NaCl", "SiO2", "CaCO3", "C6H6", or COD\'s own "O2 Si". It is converted to COD\'s stored Hill form (C first, then H, then the rest alphabetically; counts of 1 omitted) before searching. Matches the whole stoichiometry exactly, so "SiO2" will not match "CaMgSi2O6".',
        },
        mineral: {
          type: 'string',
          description:
            'Mineral name, e.g. "Quartz", "Calcite", "Halite". Matched against each structure\'s mineral field (case-insensitive substring), so "Quartz" also returns "Quartz low" / "Quartz high".',
        },
        limit: { type: 'number', description: 'Max structures to return (default 20, max 100).' },
      },
    },
  },
  {
    name: 'get_structure',
    description:
      'Look up a single crystal structure in the Crystallography Open Database (COD) by its numeric COD ID (e.g. "1009000"). Returns the compound/mineral name, chemical formula, space group, full unit-cell parameters (a, b, c, alpha, beta, gamma, volume), bibliographic details (title, authors, journal, year, DOI), and a link to the CIF structure file. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        cod_id: { type: 'string', description: 'COD numeric structure id, e.g. "1009000".' },
      },
      required: ['cod_id'],
    },
  },
  {
    name: 'get_cif',
    description:
      'Fetch the full CIF (Crystallographic Information File) for a COD structure by its numeric COD ID — the actual machine-readable structure: symmetry operations and the atom sites (element, fractional x/y/z coordinates, occupancy). Use after search_structures/get_structure when you need the real atomic structure, not just the metadata/link. Returns the CIF text plus a parsed summary (formula, space group, cell, atom count). Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        cod_id: { type: 'string', description: 'COD numeric structure id, e.g. "1009000".' },
      },
      required: ['cod_id'],
    },
  },
];

interface CodRow {
  file?: string;
  mineral?: string | null;
  formula?: string | null;
  sg?: string | null;
  a?: string | null;
  b?: string | null;
  c?: string | null;
  alpha?: string | null;
  beta?: string | null;
  gamma?: string | null;
  vol?: string | null;
  title?: string | null;
  authors?: string | null;
  journal?: string | null;
  year?: string | null;
  doi?: string | null;
  [k: string]: unknown;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_structures':
        return await searchStructures(args);
      case 'get_structure':
        return await getStructure(args);
      case 'get_cif':
        return await getCif(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * COD stores formulas in Hill notation with the elements space-separated and a count
 * of 1 omitted — "- Cl Na -", "- O2 Si -", "- C Ca O3 -". The `formula` search
 * parameter compares against that string literally, so every natural spelling an LLM
 * produces ("NaCl", "SiO2", "CaCO3", "Si O2") matches nothing at all: COD answers
 * HTTP 200 with `[]`, which reads as "no such crystal" rather than "wrong spelling".
 * Parse whatever we're given and re-emit it in COD's form.
 */
function toHillFormula(input: string): string | null {
  const cleaned = input
    .replace(/[·⋅*]/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d)))
    .replace(/[-–—]/g, ' ')
    .trim();
  if (!cleaned) return null;

  // Element symbol + optional (possibly fractional) count. Must consume the whole
  // string, otherwise we're looking at prose ("quartz") and should not guess.
  const token = /([A-Z][a-z]?)(\d+(?:\.\d+)?)?/y;
  const counts = new Map<string, number>();
  let pos = 0;
  while (pos < cleaned.length) {
    if (cleaned[pos] === ' ') {
      pos += 1;
      continue;
    }
    token.lastIndex = pos;
    const m = token.exec(cleaned);
    if (!m || m.index !== pos) return null;
    const el = m[1];
    const n = m[2] ? Number(m[2]) : 1;
    if (!Number.isFinite(n)) return null;
    counts.set(el, (counts.get(el) ?? 0) + n);
    pos = token.lastIndex;
  }
  if (counts.size === 0) return null;

  // Hill order: C first, then H, then everything else alphabetically. With no carbon,
  // it is a plain alphabetical sort (H included in its alphabetical position).
  const els = [...counts.keys()];
  const hasC = counts.has('C');
  const rank = (e: string) => (hasC && e === 'C' ? 0 : hasC && e === 'H' ? 1 : 2);
  els.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

  return els
    .map((e) => {
      const n = counts.get(e) as number;
      return n === 1 ? e : `${e}${n}`;
    })
    .join(' ');
}

function shapeRow(r: CodRow) {
  const file = (r.file ?? '').toString();
  return {
    cod_id: file,
    mineral: r.mineral ?? null,
    formula: typeof r.formula === 'string' ? r.formula.trim() : (r.formula ?? null),
    space_group: r.sg ?? null,
    cell: { a: r.a ?? null, b: r.b ?? null, c: r.c ?? null, alpha: r.alpha ?? null, beta: r.beta ?? null, gamma: r.gamma ?? null },
    year: r.year ?? null,
    title: r.title ?? null,
    cif_url: file ? `${BASE}/${encodeURIComponent(file)}.cif` : null,
  };
}

async function searchStructures(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const formulaIn = typeof args.formula === 'string' ? args.formula.trim() : '';
  const mineral = typeof args.mineral === 'string' ? args.mineral.trim() : '';

  if (!query && !formulaIn && !mineral) {
    return { error: 'provide query, formula, or mineral' };
  }

  let limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 20;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  // COD's result.php has NO `mineral` parameter — the search form exposes text1/text2,
  // formula, el1..el8, cell ranges and nothing else. Passing `mineral` alone matched no
  // criteria and returned `[]` every single time; passing it alongside text was silently
  // ignored. Resolve mineral names through free text and then filter on the mineral
  // field that COD actually returns in each row.
  const freeText = query || mineral;

  const params = new URLSearchParams();
  if (freeText) params.set('text1', freeText);
  let formulaSearched: string | null = null;
  let formulaNote: string | null = null;
  if (formulaIn) {
    const hill = toHillFormula(formulaIn);
    if (hill) {
      formulaSearched = hill;
      if (hill !== formulaIn) {
        formulaNote = `Formula "${formulaIn}" was normalized to COD's stored Hill notation "${hill}".`;
      }
    } else {
      // Not parseable as a formula (e.g. someone passed a compound name here).
      formulaSearched = formulaIn;
      formulaNote = `"${formulaIn}" does not parse as a chemical formula; it was sent to COD's formula field unchanged and will only match if it is already COD's exact stored string.`;
    }
    params.set('formula', formulaSearched);
  }
  params.set('format', 'json');

  const rows = await codGet(params);

  // Mineral requests: keep only rows whose mineral field really names the mineral.
  // COD free text also hits papers that merely mention it (text1=quartz returns
  // gallium arsenate structures whose abstract says "quartz-type"), so returning the
  // raw text hits for a mineral query would be a confident wrong answer.
  let selected = rows;
  let mineralFiltered = false;
  let mineralNote: string | null = null;
  if (mineral) {
    const needle = mineral.toLowerCase();
    const hits = rows.filter((r) => typeof r.mineral === 'string' && r.mineral.toLowerCase().includes(needle));
    if (hits.length) {
      // Substring alone puts Sinhalite and Cryptohalite ahead of Halite. Rank the
      // mineral the caller actually named first, then its varieties ("Quartz low"),
      // then names that merely contain it.
      const rank = (r: CodRow) => {
        const m = String(r.mineral).toLowerCase();
        if (m === needle) return 0;
        if (m.startsWith(needle)) return 1;
        return 2;
      };
      selected = [...hits].sort((a, b) => rank(a) - rank(b));
      mineralFiltered = true;
    } else {
      mineralNote =
        `No structure in these results carries "${mineral}" in its mineral field. ` +
        (rows.length
          ? `Showing ${rows.length} free-text match(es) for "${freeText}" instead — these mention the term but are not identified as that mineral.`
          : `Free-text search for "${freeText}" also found nothing.`);
    }
  }

  // Free-text results come back in COD-id order, not relevance order, so the thing the
  // caller asked about can sit hundreds of rows down. Float rows that actually name the
  // term (mineral field, then title) without dropping anything.
  if (freeText && !mineralFiltered) {
    const needle = freeText.toLowerCase();
    const rank = (r: CodRow) => {
      if (typeof r.mineral === 'string' && r.mineral.toLowerCase().includes(needle)) return 0;
      if (typeof r.title === 'string' && r.title.toLowerCase().includes(needle)) return 1;
      return 2;
    };
    selected = [...selected].sort((a, b) => rank(a) - rank(b));
  }

  const structures = selected.slice(0, limit).map(shapeRow);
  const notes = [formulaNote, mineralNote].filter((n): n is string => Boolean(n));

  return {
    found: structures.length > 0,
    count: structures.length,
    total_matches: selected.length,
    searched: {
      ...(freeText ? { text: freeText } : {}),
      ...(formulaSearched ? { formula: formulaSearched } : {}),
      ...(mineral ? { mineral_field_filter: mineralFiltered ? mineral : null } : {}),
    },
    ...(formulaSearched && formulaSearched !== formulaIn ? { formula_searched: formulaSearched } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
    structures,
  };
}

async function getStructure(args: Record<string, unknown>): Promise<unknown> {
  const codId = typeof args.cod_id === 'string' ? args.cod_id.trim() : '';
  if (!codId) {
    return { error: 'Required argument "cod_id" is missing. Pass a COD numeric id like "1009000".' };
  }

  // Primary: id= param returns a single-entry array for that file.
  const idParams = new URLSearchParams({ id: codId, format: 'json' });
  let rows = await codGet(idParams);
  let row: CodRow | undefined = rows.find((r) => (r.file ?? '').toString() === codId) ?? rows[0];

  // Fallback: free-text lookup, then pick the exact file match.
  if (!row) {
    const textParams = new URLSearchParams({ text: codId, format: 'json' });
    rows = await codGet(textParams);
    row = rows.find((r) => (r.file ?? '').toString() === codId);
  }

  if (!row) {
    return { error: 'structure not found', cod_id: codId };
  }

  return {
    cod_id: codId,
    mineral: row.mineral ?? null,
    formula: typeof row.formula === 'string' ? row.formula.trim() : (row.formula ?? null),
    space_group: row.sg ?? null,
    cell: {
      a: row.a ?? null,
      b: row.b ?? null,
      c: row.c ?? null,
      alpha: row.alpha ?? null,
      beta: row.beta ?? null,
      gamma: row.gamma ?? null,
      volume: row.vol ?? null,
    },
    title: row.title ?? null,
    authors: row.authors ?? null,
    journal: row.journal ?? null,
    year: row.year ?? null,
    doi: row.doi ?? null,
    cif_url: `${BASE}/${encodeURIComponent(codId)}.cif`,
  };
}

async function getCif(args: Record<string, unknown>): Promise<unknown> {
  const codId = typeof args.cod_id === 'string' ? args.cod_id.trim().replace(/[^0-9]/g, '') : '';
  if (!codId) {
    return { error: 'Required argument "cod_id" is missing. Pass a COD numeric id like "1009000".' };
  }
  const url = `${BASE}/${codId}.cif`;
  const res = await pwFetch(url, { headers: { 'User-Agent': UA, Accept: 'chemical/x-cif, text/plain' } });
  if (res.status === 404) return { error: 'structure not found', cod_id: codId };
  if (!res.ok) throw await httpError(res, 'COD CIF');
  const cif = await res.text();

  // Lightweight parse of the headline CIF tags + atom-site count.
  const tag = (name: string): string | null => {
    const m = new RegExp(`^${name}\\s+(.+)$`, 'm').exec(cif);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  };
  const atomSiteCount = (cif.match(/^[A-Za-z][A-Za-z0-9]?\d*\s+[A-Za-z]/gm) ?? []).length; // rough
  const summary = {
    formula: tag('_chemical_formula_sum') ?? tag('_chemical_formula_structural'),
    name: tag('_chemical_name_systematic') ?? tag('_chemical_name_mineral'),
    space_group: tag('_symmetry_space_group_name_H-M') ?? tag('_space_group_name_H-M_alt'),
    cell: {
      a: tag('_cell_length_a'), b: tag('_cell_length_b'), c: tag('_cell_length_c'),
      alpha: tag('_cell_angle_alpha'), beta: tag('_cell_angle_beta'), gamma: tag('_cell_angle_gamma'),
    },
    atom_site_lines: (cif.match(/_atom_site_/g) ?? []).length,
  };
  // CIF files are small (typically a few KB); cap to keep responses sane.
  const MAX = 40000;
  return {
    cod_id: codId,
    cif_url: url,
    summary,
    truncated: cif.length > MAX,
    cif: cif.length > MAX ? cif.slice(0, MAX) : cif,
  };
}

async function codGet(params: URLSearchParams): Promise<CodRow[]> {
  const res = await pwFetch(`${BASE}/result.php?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    throw new Error(`COD: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as CodRow[]) : [];
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
