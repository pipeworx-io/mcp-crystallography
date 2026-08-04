# mcp-crystallography

Crystallography Open Database (COD) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Crystallography data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
