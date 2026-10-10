/**
 * Shared read-side views for the data API routes (Agent C).
 * Threat rows enriched with project/reviewer names and their links.
 */

import { all } from "@/db";
import type { ThreatRow, LinkRow } from "@/db/schema";

export interface ThreatListRow extends ThreatRow {
  project_id: number;
  project_name: string;
  reviewer_id: number;
  reviewer_name: string;
  review_date: string;
  version: number;
}

const THREAT_JOIN = `
  FROM threats t
  JOIN submissions s ON s.id = t.submission_id
  JOIN projects p ON p.id = s.project_id
  JOIN reviewers r ON r.id = s.reviewer_id
`;

/**
 * Query threats with project/reviewer context. `where` is a SQL fragment
 * against aliases t/s/p/r (trusted, built by the caller — never raw input).
 */
export function queryThreats(where = "1=1", ...params: (string | number | null | undefined)[]): ThreatListRow[] {
  return all<ThreatListRow>(
    `SELECT t.*,
            p.id AS project_id, p.name AS project_name,
            r.id AS reviewer_id, r.name AS reviewer_name,
            s.review_date, s.version
     ${THREAT_JOIN}
     WHERE ${where}
     ORDER BY (t.rank_score IS NULL), t.rank_score DESC, t.id ASC`,
    ...params
  );
}

export interface LinkView extends LinkRow {
  reco_text: string;
  threat_ref: string;
  threat_title: string;
}

/** Links (with recommendation text) for one or more threat ids. */
export function queryLinksForThreats(threatIds: number[]): LinkView[] {
  if (!threatIds.length) return [];
  const placeholders = threatIds.map(() => "?").join(",");
  return all<LinkView>(
    `SELECT l.*, rc.text AS reco_text, t.threat_ref AS threat_ref, t.title AS threat_title
     FROM links l
     JOIN recommendations rc ON rc.id = l.recommendation_id
     JOIN threats t ON t.id = l.threat_id
     WHERE l.threat_id IN (${placeholders})
     ORDER BY l.id ASC`,
    ...threatIds
  );
}

export function groupLinksByThreat(links: LinkView[]): Map<number, LinkView[]> {
  const map = new Map<number, LinkView[]>();
  for (const l of links) {
    const arr = map.get(l.threat_id) ?? [];
    arr.push(l);
    map.set(l.threat_id, arr);
  }
  return map;
}

export interface LinkCounts {
  total: number;
  accepted: number;
  proposed: number;
  rejected: number;
}

export function linkCounts(links: LinkView[]): LinkCounts {
  const c: LinkCounts = { total: links.length, accepted: 0, proposed: 0, rejected: 0 };
  for (const l of links) {
    if (l.decision === "accepted") c.accepted++;
    else if (l.decision === "rejected") c.rejected++;
    else c.proposed++;
  }
  return c;
}

export interface ThreatView extends ThreatListRow {
  /** Links with a human decision (accepted/rejected). */
  decided_links: LinkView[];
  link_counts: LinkCounts;
}

/** Attach decided links + counts to a list of threat rows. */
export function enrichThreats(rows: ThreatListRow[]): ThreatView[] {
  const links = queryLinksForThreats(rows.map((t) => t.id));
  const byThreat = groupLinksByThreat(links);
  return rows.map((t) => {
    const allLinks = byThreat.get(t.id) ?? [];
    return {
      ...t,
      decided_links: allLinks.filter((l) => l.decision !== "proposed"),
      link_counts: linkCounts(allLinks),
    };
  });
}

/**
 * Latest submission id per project (used everywhere "current posture"
 * must not double-count re-uploaded versions).
 */
export function latestSubmissionIds(projectId?: number): number[] {
  const rows = projectId
    ? all<{ id: number }>(
        `SELECT s.id FROM submissions s
         JOIN (SELECT project_id, MAX(version) AS mv FROM submissions WHERE project_id = ? GROUP BY project_id) l
           ON l.project_id = s.project_id AND s.version = l.mv
         WHERE s.project_id = ?`,
        projectId,
        projectId
      )
    : all<{ id: number }>(
        `SELECT s.id FROM submissions s
         JOIN (SELECT project_id, MAX(version) AS mv FROM submissions GROUP BY project_id) l
           ON l.project_id = s.project_id AND s.version = l.mv`
      );
  return rows.map((r) => r.id);
}

/** Threats the reviewer has visibly responded to: ≥1 link with decision != rejected. */
export function hasResponse(links: LinkView[]): boolean {
  return links.some((l) => l.decision !== "rejected");
}
