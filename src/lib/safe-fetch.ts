/**
 * Safe client-side fetch wrapper — never returns undefined data.
 * All client pages should use this to prevent crashes when APIs return errors.
 */

export async function safeFetch<T = any>(url: string, options?: RequestInit): Promise<T[]> {
  try {
    const res = await fetch(url, options);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

export async function safeFetchOne<T = any>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}
