// Heuristic fact extraction from brochure page text. Everything produced here is a developer
// marketing claim with a page reference; confidence reflects only how the text was attributed
// to a project, not whether the claim is true.
import { cleanText } from "@/lib/normalize";
import type { Line } from "./pdf-table";

export type FactCategory = "location" | "configuration" | "amenity" | "payment_plan" | "handover" | "price_claim";

export interface ExtractedFact {
  category: FactCategory;
  value: string;
  extractedText: string;
}

const CONFIG_RE = /\b(studios?|(\d)\s*[-‑]?\s*(?:bed(?:room)?s?|br|bhk)\b)/gi;
const PAYMENT_RE = /(\d+(?:\.\d+)?\s*%\s*(?:monthly|per\s+month|payment\s+plan|post[-\s]?handover|on\s+booking|down\s*payment)[^.\n]{0,60}|\d+\s*\/\s*\d+\s+payment\s+plan|payment\s+plan[^.\n]{0,80})/gi;
const LOCATION_RE = /\b(?:[Ll]ocated\s+(?:in|at)|[Ss]ituated\s+(?:in|at)|[Ii]n\s+the\s+heart\s+of|[Nn]estled\s+in|[Aa]ddress(?:ed)?\s*:)\s+([A-Z][^.,;\n]{2,60})/g;
const HANDOVER_RE = /\b(?:handover|completion|ready\s+by)\b[^.\n]{0,60}?\b(Q[1-4]\s*[-‑]?\s*20\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d{2}|20\d{2})\b/gi;
const PRICE_RE = /\b(?:starting\s+(?:from|at)|prices?\s+(?:from|starting)|from)\s+AED\s*[\d,.]+\s*(?:k|m|mn|million|billion)?\b/gi;
const AMENITY_HEADING = /^(amenities|facilities|features(\s*&\s*amenities)?|amenities\s*&\s*facilities|lifestyle\s+amenities|key\s+features)\b/i;

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index) + 1, index - 160, 0);
  const endDot = text.indexOf(".", index);
  const end = Math.min(endDot === -1 ? text.length : endDot + 1, index + 200);
  return cleanText(text.slice(start, end));
}

function normalizeConfig(match: string): string {
  if (/^studio/i.test(match)) return "Studio";
  const n = /(\d)/.exec(match)?.[1];
  return n ? `${n} bedroom` : cleanText(match);
}

export function extractBrochureFacts(lines: Line[]): ExtractedFact[] {
  const text = lines.map((l) => l.text).join("\n");
  const facts: ExtractedFact[] = [];
  const push = (f: ExtractedFact) => {
    if (!facts.some((x) => x.category === f.category && x.value.toLowerCase() === f.value.toLowerCase())) facts.push(f);
  };

  for (const m of text.matchAll(CONFIG_RE)) push({ category: "configuration", value: normalizeConfig(m[0]), extractedText: sentenceAround(text, m.index ?? 0) });
  for (const m of text.matchAll(PAYMENT_RE)) push({ category: "payment_plan", value: cleanText(m[0]).slice(0, 120), extractedText: sentenceAround(text, m.index ?? 0) });
  for (const m of text.matchAll(LOCATION_RE)) push({ category: "location", value: cleanText(m[1]), extractedText: sentenceAround(text, m.index ?? 0) });
  for (const m of text.matchAll(HANDOVER_RE)) push({ category: "handover", value: cleanText(m[1]).toUpperCase().replace(/\s+/g, " "), extractedText: sentenceAround(text, m.index ?? 0) });
  for (const m of text.matchAll(PRICE_RE)) push({ category: "price_claim", value: cleanText(m[0]), extractedText: sentenceAround(text, m.index ?? 0) });

  // Amenities: short lines that follow an "Amenities"-style heading.
  for (let i = 0; i < lines.length; i++) {
    if (!AMENITY_HEADING.test(lines[i].text)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 41); j++) {
      const t = lines[j].text.replace(/^[•●▪\-–*·]\s*/, "");
      const words = t.split(/\s+/).length;
      if (!t || words > 8 || t.length > 60 || /[.!?]$/.test(t) || AMENITY_HEADING.test(t)) break;
      push({ category: "amenity", value: t, extractedText: `${lines[i].text}: ${t}` });
    }
  }
  return facts;
}
