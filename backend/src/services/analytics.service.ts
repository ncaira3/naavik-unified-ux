import { pool } from '../config/database.js';

type Point = { siteId: string; latitude: number; longitude: number };

function seededPick<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  const used = new Set<number>();
  while (out.length < n && used.size < arr.length) {
    const idx = Math.floor(Math.random() * arr.length);
    if (used.has(idx)) continue;
    used.add(idx);
    out.push(arr[idx]);
  }
  return out;
}

function dist2(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dx = a.latitude - b.latitude;
  const dy = a.longitude - b.longitude;
  return dx * dx + dy * dy;
}

function kmeans(points: Point[], k: number, iters = 10) {
  if (points.length === 0) return [];
  const kk = Math.max(2, Math.min(k, points.length));
  let centroids = seededPick(points, kk).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < iters; iter += 1) {
    // assign
    for (let i = 0; i < points.length; i += 1) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = dist2(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignments[i] = best;
    }

    // update
    const sums = centroids.map(() => ({ lat: 0, lon: 0, n: 0 }));
    for (let i = 0; i < points.length; i += 1) {
      const c = assignments[i];
      sums[c].lat += points[i].latitude;
      sums[c].lon += points[i].longitude;
      sums[c].n += 1;
    }
    centroids = centroids.map((c, idx) => (sums[idx].n ? { latitude: sums[idx].lat / sums[idx].n, longitude: sums[idx].lon / sums[idx].n } : c));
  }

  const clusters = centroids.map((centroid, idx) => ({
    clusterId: idx,
    centroid,
    members: [] as Point[],
  }));
  for (let i = 0; i < points.length; i += 1) {
    clusters[assignments[i]].members.push(points[i]);
  }
  return clusters
    .map((c) => ({ ...c, size: c.members.length }))
    .sort((a, b) => b.size - a.size);
}

export class AnalyticsService {
  static async clusterSites(input: { dateId?: string; siteIds?: string[]; k: number }) {
    const dateId = input.dateId ? String(input.dateId).slice(0, 10) : undefined;
    const siteIds = Array.isArray(input.siteIds) ? input.siteIds : undefined;

    const params: any[] = [];
    let where = '';
    if (siteIds?.length) {
      params.push(siteIds);
      where += ` WHERE "SiteID" = ANY($${params.length}::text[])`;
    }

    // Use filtered_sites as the stable geospatial source (latest row per SiteID).
    // dateId is currently optional; when present, we bias to <= dateId then pick latest.
    if (dateId) {
      params.push(dateId);
      where += where ? ` AND "DateID" <= $${params.length}` : ` WHERE "DateID" <= $${params.length}`;
    }

    const sql = `
      SELECT DISTINCT ON ("SiteID")
        "SiteID" AS site_id,
        "Latitude" AS latitude,
        "Longitude" AS longitude
      FROM filtered_sites
      ${where}
      ORDER BY "SiteID", "DateID" DESC
      LIMIT 1400
    `;

    const result = await pool.query(sql, params);
    const points: Point[] = (result.rows || [])
      .map((r: any) => ({
        siteId: String(r.site_id || '').trim(),
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
      }))
      .filter((p) => p.siteId && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

    const clusters = kmeans(points, input.k, 10);
    return {
      k: input.k,
      dateId: dateId || null,
      pointCount: points.length,
      clusters,
    };
  }
}

