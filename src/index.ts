interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Crystallography Open Database (COD) MCP.
 *
 * COD (https://www.crystallography.net/cod) is an open repository of crystal
 * structures of organic, inorganic, metal-organic, and mineral compounds.
 * Keyless. Search by compound name, chemical formula, or mineral name and get
 * unit-cell parameters, space group, and a link to the CIF structure file.
 */


const BASE = 'https://www.crystallography.net/cod';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_structures',
    description:
      'Search the Crystallography Open Database (COD), an open repository of crystal structures (inorganic, organic, metal-organic, and mineral). Search by compound name (free text), chemical formula, or mineral name; returns matching crystal structures with unit-cell parameters, space group, year, and a link to the CIF structure file. Keyless. Provide at least one of query, formula, or mineral.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search (compound/common name, title words, author, etc.). e.g. "quartz".' },
        formula: { type: 'string', description: 'Chemical formula, e.g. "As Ga O4" (elements space-separated).' },
        mineral: { type: 'string', description: 'Mineral name, e.g. "Calcite". Note: the COD mineral field is sparsely populated, so this often returns no results.' },
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
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function searchStructures(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const formula = typeof args.formula === 'string' ? args.formula.trim() : '';
  const mineral = typeof args.mineral === 'string' ? args.mineral.trim() : '';

  if (!query && !formula && !mineral) {
    return { error: 'provide query, formula, or mineral' };
  }

  let limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 20;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  const params = new URLSearchParams();
  if (query) params.set('text', query);
  if (formula) params.set('formula', formula);
  if (mineral) params.set('mineral', mineral);
  params.set('format', 'json');

  const rows = await codGet(params);
  const structures = rows.slice(0, limit).map((r) => {
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
  });

  return { count: structures.length, structures };
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

async function codGet(params: URLSearchParams): Promise<CodRow[]> {
  const res = await fetch(`${BASE}/result.php?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    throw new Error(`COD: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as CodRow[]) : [];
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
