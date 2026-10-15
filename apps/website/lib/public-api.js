const API_BASE = (process.env.API_PUBLIC_BASE_URL || 'http://localhost:4000/public/v1').replace(/\/+$/, '');
const REVALIDATE_SECONDS = Math.max(0, Number(process.env.ISR_REVALIDATE_SECONDS || 300));

export async function getPublicGigs(filters = {}) {
  const url = new URL(`${API_BASE}/gigs`);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!response.ok) {
      return {
        data: [],
        page: Number(filters.page || 1),
        pageSize: Number(filters.pageSize || 12),
        total: 0,
        error: `The opportunities service returned HTTP ${response.status}.`,
      };
    }
    return await response.json();
  } catch {
    return {
      data: [],
      page: Number(filters.page || 1),
      pageSize: Number(filters.pageSize || 12),
      total: 0,
      error: 'Could not connect to the opportunities API. Make sure the API is running on port 4000.',
    };
  }
}

export async function getPublicModules() {
  try {
    const response = await fetch(`${API_BASE}/modules`, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!response.ok) throw new Error('Module service unavailable');
    const result = await response.json();
    return Array.isArray(result.data) ? result.data : [];
  } catch {
    // Fallback keeps the filters usable if the module endpoint is temporarily unavailable.
    return [
      { id: 'M1', name: 'AI Video / Reels' },
      { id: 'M2', name: 'AI Design / Visual' },
      { id: 'M3', name: 'AI Data Annotation / Evaluation' },
      { id: 'M4', name: 'AI Coding / Development' },
      { id: 'M5', name: 'AI Marketing / Growth' },
      { id: 'M6', name: 'AI Automation / Agents' },
    ];
  }
}

export async function getPublicGig(id) {
  try {
    const response = await fetch(`${API_BASE}/gigs/${encodeURIComponent(id)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (response.status === 404) return { data: null, notFound: true };
    if (!response.ok) return { data: null, error: `The opportunities service returned HTTP ${response.status}.` };
    return { data: await response.json() };
  } catch {
    return { data: null, error: 'Could not connect to the opportunities API. Make sure the API is running on port 4000.' };
  }
}

export function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
