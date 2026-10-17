import type { Risk } from "../types";

// The four-tier scale from the Standard Risk Matrix Color Mapping Reference (assets/, DECISIONS 31):
// green, yellow, orange, red, after ISO/IEC 31010 Annex B.29 and ANSI/ASSP Z590.3. Colour is never used
// alone: every rating also shows its letter code and name (the reference's dual-coding rule).
export type RiskLevel = {
  risk: Risk;
  code: string;
  colour: string;
  meaning: string;
  escalation: string;
};

// Highest first: the order for filters, tables and the heatmap.
export const RISK_LEVELS: RiskLevel[] = [
  {
    risk: "Critical",
    code: "C",
    colour: "Red",
    meaning: "Severe or catastrophic threat that could cause major failure, safety incidents or loss of key systems.",
    escalation: "Immediate executive board intervention. Affected operations may be halted.",
  },
  {
    risk: "High",
    code: "H",
    colour: "Orange",
    meaning: "Unacceptable exposure under normal conditions. Needs a formal risk treatment plan.",
    escalation: "Escalated to the department head. Needs explicit mitigation target dates and allocated budget.",
  },
  {
    risk: "Medium",
    code: "M",
    colour: "Yellow",
    meaning: "Tolerable, but needs ongoing tracking and baseline controls to stop it escalating.",
    escalation: "Assigned to an operational lead or supervisor. Reviewed periodically with active control tracking.",
  },
  {
    risk: "Low",
    code: "L",
    colour: "Green",
    meaning: "Acceptable or broadly tolerable. Needs only standard monitoring.",
    escalation: "Managed through routine procedures. No special resources or executive reporting.",
  },
];

export const RISKS: Risk[] = RISK_LEVELS.map((l) => l.risk);

export function riskLevel(r: Risk): RiskLevel {
  return RISK_LEVELS.find((l) => l.risk === r)!;
}

// 0 for Critical up to 3 for Low, so sorting by rank puts the most serious first.
export function riskRank(r: Risk): number {
  return RISKS.indexOf(r);
}

// Import files are matched without regard to case; "Extreme" is the reference's other name for Critical.
export function parseRisk(raw: string): Risk | null {
  const v = raw.trim().toLowerCase();
  if (v === "extreme") return "Critical";
  return RISKS.find((r) => r.toLowerCase() === v) ?? null;
}
