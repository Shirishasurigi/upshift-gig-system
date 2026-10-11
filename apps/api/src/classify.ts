import './config.js';
import { pool } from './db.js';
import { llmClassify, llmConfigured, type ModuleInfo } from './llm.js';

// ---------- Keywords. A trailing * means "starts with" (design* matches designer). ----------
const EXTRA_KEYWORDS: Record<string, string[]> = {
  M1: ['reel*', 'short-form', 'shorts', 'video*', 'tiktok', 'capcut', 'premiere pro', 'after effects'],
  M2: ['graphic*', 'logo*', 'brand asset*', 'branding', 'illustrat*', 'design*', 'visual*', 'canva', 'figma', 'midjourney', 'photoshop', 'poster*'],
  M3: ['annotat*', 'evaluat*', 'rlhf', 'labeling', 'labelling', 'ai trainer', 'model response*'],
  M4: ['developer*', 'engineer*', 'software', 'full-stack', 'full stack', 'frontend', 'backend', 'react', 'python', 'javascript', 'typescript', 'coding', 'programmer*', 'web development', 'app development'],
  M5: ['seo', 'social media', 'marketing', 'growth', 'copywrit*', 'content writer', 'email campaign*', 'newsletter*'],
  M6: ['automat*', 'n8n', 'zapier', 'make.com', 'workflow*', 'ai agent*', 'agent*', 'integration*', 'no-code'],
};

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function keywordRegex(kw: string): RegExp {
  const prefix = kw.endsWith('*');
  const core = escapeRe(prefix ? kw.slice(0, -1) : kw);
  return new RegExp(`(?<![a-z0-9])${core}${prefix ? '' : '(?![a-z0-9])'}`, 'i');
}

type ModuleDef = ModuleInfo & { keywords: string[] };
async function loadModules(): Promise<ModuleDef[]> {
  const [rows] = await pool.query('SELECT id, name, description, search_keywords FROM modules WHERE is_active = 1 ORDER BY id');
  return (rows as any[]).map((m) => {
    const fromDb: string[] = Array.isArray(m.search_keywords) ? m.search_keywords : [];
    const all = [...fromDb, ...(EXTRA_KEYWORDS[m.id] ?? [])].map((k) => k.toLowerCase());
    return { id: m.id, name: m.name, description: m.description, keywords: [...new Set(all)] };
  });
}

type GigRow = { id: number; external_gig_id: string | null; title: string | null; short_description: string | null; overview: string | null;
  responsibilities: string | null; deliverables: string | null; requirements: string | null; proof_spec: string | null; missing_fields: unknown; current_version: number };

// Title matches are worth 3 points, text matches 1 point.
function scoreByRules(g: GigRow, modules: ModuleDef[]) {
  const title = g.title ?? '';
  const body = [g.short_description, g.overview, g.responsibilities, g.deliverables, g.requirements, g.proof_spec].filter(Boolean).join(' ');
  const scores: Record<string, number> = {}; const hits: Record<string, string[]> = {};
  for (const m of modules) {
    scores[m.id] = 0; hits[m.id] = [];
    for (const kw of m.keywords) {
      const re = keywordRegex(kw);
      const inTitle = re.test(title); const inBody = re.test(body);
      if (inTitle) scores[m.id] += 3;
      if (inBody) scores[m.id] += 1;
      if (inTitle || inBody) hits[m.id].push(kw.replace('*', ''));
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, top] = ranked[0] ?? ['', 0];
  const second = ranked[1]?.[1] ?? 0;
  // Confidence = the winner's share of the two best modules, scaled by how much evidence there is at all.
  // (12 vs 4 points -> 0.75; 5 vs 4 -> 0.56; one weak hit -> low because there is too little evidence.)
  const strength = Math.min(1, top / 4);
  const conf = top ? Math.round((top / (top + second)) * strength * 1000) / 1000 : 0;
  const clearWinner = top > 0 && top > second;
  return { scores, hits, top: clearWinner ? topId : null, topScore: top, conf: clearWinner ? conf : 0 };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export type ClassifyResult = {
  gigId: number; externalId: string | null; title: string | null;
  outcome: 'auto_assigned' | 'needs_manual'; track: string | null; confidence: number; method: string; why: string;
};

export async function classifyGig(gigId: number): Promise<ClassifyResult | null> {
  const [rows] = await pool.query(
    `SELECT id, external_gig_id, title, short_description, overview, responsibilities, deliverables, requirements, proof_spec,
            missing_fields, current_version FROM gigs WHERE id = ? AND track_id IS NULL`, [gigId]);
  const g = (rows as GigRow[])[0];
  if (!g) return null; // already has a module (from the source or a human): never touched

  const [setRows] = await pool.query("SELECT value FROM settings WHERE key_name = 'classification.confidence_min'");
  const minConf = Number((setRows as any[])[0]?.value ?? 0.7);
  const modules = await loadModules();
  const rules = scoreByRules(g, modules);

  let track: string | null = rules.top;
  let confidence = rules.conf;
  let method = 'rules';
  let model = 'rules-v1';
  const notes: string[] = [];
  if (rules.top) notes.push(`keywords for ${rules.top}: ${rules.hits[rules.top].join(', ')}`);
  else notes.push('no clear keyword winner');

  // Ask the AI only when the rules are not already clear
  if (rules.conf < 0.8 && llmConfigured()) {
    const text = [g.title, g.short_description, g.overview, g.responsibilities, g.deliverables, g.requirements].filter(Boolean).join('\n');
    const r = await llmClassify(text, modules);
    if (!r.ok) {
      notes.push(`AI unavailable (${r.error}); rules only`);
    } else {
      const a = r.answer;
      model = `${a.model}+rules-v1`;
      const haystack = norm(text);
      const validQuotes = a.quotes.filter((q) => norm(q).length >= 3 && haystack.includes(norm(q)));
      let aiConf = a.confidence;
      if (validQuotes.length === 0) { aiConf = Math.min(aiConf, 0.5); notes.push('AI gave no quote that really appears in the listing; confidence capped'); }
      if (!a.track) {
        track = null; confidence = Math.min(confidence, 0.4); method = 'ai'; notes.push('AI says the listing does not clearly fit one module');
      } else if (rules.top && rules.top === a.track) {
        track = a.track; confidence = Math.min(1, Math.max(aiConf, rules.conf) + 0.1); method = 'rules+ai'; notes.push(`AI agrees: ${a.rationale}`);
      } else if (rules.top && rules.top !== a.track) {
        track = a.track; confidence = 0.4; method = 'rules+ai'; notes.push(`AI (${a.track}) disagrees with keywords (${rules.top}); a human must decide`);
      } else {
        track = a.track; confidence = Math.min(aiConf, 0.8); method = 'ai'; notes.push(`AI only: ${a.rationale}`); // AI alone is never fully trusted
      }
    }
  }

  const assign = track !== null && confidence >= minConf;
  const outcome: 'auto_assigned' | 'needs_manual' = assign ? 'auto_assigned' : 'needs_manual';
  const why = assign ? notes.join('; ') : `${notes.join('; ')}; confidence ${confidence.toFixed(2)} is below ${minConf}, so a human chooses the module`;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO ai_classifications (gig_id, proposed_track_id, confidence, rationale, alternatives, model, prompt_version, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [gigId, track, confidence, why.slice(0, 2000), JSON.stringify(rules.scores), model, 'v1', outcome]);
    if (assign) {
      const missing = (Array.isArray(g.missing_fields) ? (g.missing_fields as string[]) : []).filter((f) => f !== 'track_id');
      const [upd] = await conn.query(
        `UPDATE gigs SET track_id = ?, track_confidence = ?, track_set_by = ?,
           field_provenance = JSON_SET(COALESCE(field_provenance, JSON_OBJECT()), '$.track_id', ?),
           missing_fields = ?, data_completeness = ?, current_version = current_version + 1
         WHERE id = ? AND track_id IS NULL`,
        [track, confidence, method === 'rules' ? 'rule' : 'ai', method === 'rules' ? 'rule' : 'ai',
         JSON.stringify(missing), missing.length === 0 ? 'complete' : 'partial', gigId]);
      if ((upd as { affectedRows: number }).affectedRows === 1) {
        await conn.query(
          "INSERT INTO gig_versions (gig_id, version_no, change_origin, changed_fields, snapshot) VALUES (?, ?, 'system', ?, ?)",
          [gigId, g.current_version + 1, JSON.stringify({ track_id: { old: null, new: track } }), JSON.stringify({ track_id: track, method, confidence })]);
      }
    }
    await conn.query(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor_type, details) VALUES ('gig', ?, 'classified', 'discovery_agent', ?)",
      [gigId, JSON.stringify({ outcome, track, confidence, method })]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  return { gigId, externalId: g.external_gig_id, title: g.title, outcome, track: assign ? track : null, confidence, method, why };
}

// Every gig that has no module yet
export async function classifyAll(): Promise<ClassifyResult[]> {
  const [rows] = await pool.query('SELECT id FROM gigs WHERE track_id IS NULL ORDER BY id');
  const out: ClassifyResult[] = [];
  for (const r of rows as { id: number }[]) {
    try { const res = await classifyGig(r.id); if (res) out.push(res); }
    catch (e) { console.error(`  gig ${r.id}: classification failed: ${(e as Error).message}`); }
  }
  return out;
}
