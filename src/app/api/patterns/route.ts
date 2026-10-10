import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import { queryThreats, latestSubmissionIds } from "@/lib/threat-views";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Patterns are computed strictly from stored register data — never invented. */

const STOPWORDS = new Set(
  "the,a,an,and,or,of,to,in,for,on,with,by,from,as,at,is,are,was,were,be,been,being,has,have,had,do,does,did,will,would,should,could,can,may,might,must,shall,this,that,these,those,it,its,they,them,their,we,you,your,our,he,she,his,her,all,any,each,other,into,over,under,between,through,during,before,after,above,below,up,down,out,off,again,further,then,once,here,there,when,where,which,while,who,whom,not,no,nor,only,own,same,so,than,too,very,just,also,use,used,using,ensure,make,sure,need,needs,needed,add,added,including,include,within,without,via,per,etc,eg,ie,recommendation,recommendations,recommended,review,please".split(
    ","
  )
);

interface PairPattern {
  stride: string;
  component: string;
  threatCount: number;
  projects: number;
  reviews: number;
  display: string;
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const submissionIds = latestSubmissionIds();
    const totalReviews = submissionIds.length;

    const threats =
      submissionIds.length > 0
        ? queryThreats(
            `t.submission_id IN (${submissionIds.map(() => "?").join(",")})`,
            ...submissionIds
          )
        : [];

    const totalProjects = new Set(threats.map((t) => t.project_id)).size;

    // STRIDE × component pairs.
    const pairMap = new Map<string, { stride: string; component: string; threats: number; projects: Set<string>; reviews: Set<number> }>();
    const strideMap = new Map<string, { threats: number; projects: Set<string>; reviews: Set<number> }>();
    const componentMap = new Map<string, { threats: number; projects: Set<string>; reviews: Set<number> }>();

    for (const t of threats) {
      const stride = t.stride_category?.trim() || "Not provided";
      const component = t.component?.trim() || "Not provided";
      const pairKey = `${stride}\u0000${component}`;

      const p = pairMap.get(pairKey) ?? { stride, component, threats: 0, projects: new Set(), reviews: new Set() };
      p.threats++;
      p.projects.add(t.project_name);
      p.reviews.add(t.submission_id);
      pairMap.set(pairKey, p);

      const s = strideMap.get(stride) ?? { threats: 0, projects: new Set(), reviews: new Set() };
      s.threats++;
      s.projects.add(t.project_name);
      s.reviews.add(t.submission_id);
      strideMap.set(stride, s);

      const c = componentMap.get(component) ?? { threats: 0, projects: new Set(), reviews: new Set() };
      c.threats++;
      c.projects.add(t.project_name);
      c.reviews.add(t.submission_id);
      componentMap.set(component, c);
    }

    const pairs: PairPattern[] = [...pairMap.values()]
      .filter((p) => p.stride !== "Not provided" && p.component !== "Not provided")
      .sort((a, b) => b.reviews.size - a.reviews.size || b.threats - a.threats)
      .slice(0, 25)
      .map((p) => ({
        stride: p.stride,
        component: p.component,
        threatCount: p.threats,
        projects: p.projects.size,
        reviews: p.reviews.size,
        display: `${p.stride} on ${p.component} appears in ${p.reviews.size} of ${totalReviews} reviews (${p.threats} threats, ${p.projects.size} projects)`,
      }));

    const stride = [...strideMap.entries()]
      .sort((a, b) => b[1].reviews.size - a[1].reviews.size)
      .map(([label, v]) => ({
        label,
        threatCount: v.threats,
        projects: v.projects.size,
        reviews: v.reviews.size,
        display: `${label} appears in ${v.reviews.size} of ${totalReviews} reviews`,
      }));

    const components = [...componentMap.entries()]
      .sort((a, b) => b[1].reviews.size - a[1].reviews.size)
      .slice(0, 25)
      .map(([label, v]) => ({
        label,
        threatCount: v.threats,
        projects: v.projects.size,
        reviews: v.reviews.size,
        display: `${label} appears in ${v.reviews.size} of ${totalReviews} reviews`,
      }));

    // Recommendation themes: frequent non-stopword tokens across recommendations.
    const recoRows =
      submissionIds.length > 0
        ? all<{ id: number; submission_id: number; text: string }>(
            `SELECT id, submission_id, text FROM recommendations
             WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})`,
            ...submissionIds
          )
        : [];

    const tokenReviews = new Map<string, Set<number>>();
    for (const r of recoRows) {
      const tokens = new Set(
        r.text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((tok) => tok.length >= 4 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok))
      );
      for (const tok of tokens) {
        const set = tokenReviews.get(tok) ?? new Set<number>();
        set.add(r.submission_id);
        tokenReviews.set(tok, set);
      }
    }
    const recoThemes = [...tokenReviews.entries()]
      .filter(([, set]) => set.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 25)
      .map(([token, set]) => ({
        theme: token,
        reviews: set.size,
        display: `Recommendations mentioning "${token}" appear in ${set.size} of ${totalReviews} reviews`,
      }));

    return NextResponse.json({
      ok: true,
      data: {
        totalProjects,
        totalReviews,
        pairs,
        stride,
        components,
        recoThemes,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
