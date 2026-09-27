/**
 * vm/portfolio/config.ts — the IAM Portfolio instructor configuration.
 *
 * One source of truth: omari-lab/11-IAM-PORTFOLIO/ollama-instructor.config.json.
 * The workspace builder copies it to IAM-Portfolio-Labs/.ollama-instructor/,
 * and this module imports the very same file, so the system prompt the app
 * sends and the one on disk in the learner's workspace can never drift apart.
 */
import raw from '../../../omari-lab/11-IAM-PORTFOLIO/ollama-instructor.config.json';

export type PhaseId = 'iga' | 'am' | 'pam';

export interface PortfolioProject {
  id: string;
  number: number;
  phase: PhaseId;
  folder: string;
  title: string;
  objective: string;
  /** The real-world lab environment (cloud tenant, VM, IdP...). */
  labSetup: string;
  /** What to build, as the real-world brief states it. */
  execution: string;
  /** The artifact that goes in the portfolio. */
  portfolioDeliverable: string;
  deliverables: string[];
  reviewFocus: string[];
  /** The part of the project that runs on the real DC01 VM, if any. */
  vm: { supported: boolean; host: string; summary: string; tasks: string[] };
}

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
}

export interface PortfolioConfig {
  ollama: {
    endpoint: string;
    tagsPath: string;
    chatPath: string;
    preferredModels: string[];
    options: Record<string, number>;
    keepAlive: string;
  };
  verification: { successMessage: string; failureMessage: string };
  systemPrompt: string[];
  rubric: RubricCriterion[];
  phases: { id: PhaseId; title: string }[];
  projects: PortfolioProject[];
}

export const PORTFOLIO = raw as unknown as PortfolioConfig;

/** The exact system prompt sent to Ollama in this workspace. */
export const SYSTEM_PROMPT = PORTFOLIO.systemPrompt.join('\n');

export function projectById(id: string): PortfolioProject | undefined {
  return PORTFOLIO.projects.find((p) => p.id === id);
}
