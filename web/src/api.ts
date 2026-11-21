const j = async <T>(r: Response): Promise<T> => { const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); return b as T; };
export const get = <T>(p: string) => fetch(p).then(r => j<T>(r));
export const post = <T>(p: string, body: unknown = {}) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => j<T>(r));
