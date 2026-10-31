# mcp-crystallography

Crystallography Open Database (COD) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1863+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Description |
|------|-------------|
| `search_structures` | Search the Crystallography Open Database (COD), an open repository of crystal structures (inorganic, organic, metal-organic, and mineral). Search by compound name (free text), chemical formula, or mineral name; returns matching crystal structures with unit-cell parameters, space group, year, and a link to the CIF structure file. Keyless. Provide at least one of query, formula, or mineral. Formulas are normalized to COD's stored Hill notation for you, so "NaCl", "SiO2" and "CaCO3" all work; the response reports `formula_searched` with the exact string that was matched. |
| `get_structure` | Look up a single crystal structure in the Crystallography Open Database (COD) by its numeric COD ID (e.g. "1009000"). Returns the compound/mineral name, chemical formula, space group, full unit-cell parameters (a, b, c, alpha, beta, gamma, volume), bibliographic details (title, authors, journal, year, DOI), and a link to the CIF structure file. Keyless. |
| `get_cif` | Fetch the full CIF (Crystallographic Information File) for a COD structure by its numeric COD ID — the actual machine-readable structure: symmetry operations and the atom sites (element, fractional x/y/z coordinates, occupancy). Use after search_structures/get_structure when you need the real atomic structure, not just the metadata/link. Returns the CIF text plus a parsed summary (formula, space group, cell, atom count). Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "crystallography": {
      "url": "https://gateway.pipeworx.io/crystallography/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/crystallography/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1863+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/search_structures \
  -H 'Content-Type: application/json' \
  -d '{"query":"quartz"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/search_structures`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-crystallography` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/crystallography/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "crystallography": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-crystallography"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Crystallography data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
