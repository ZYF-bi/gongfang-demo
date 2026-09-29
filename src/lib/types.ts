export type Project = {
  id: string;
  name: string;
  original_prompt: string;
  applied_changes: string[];
  html: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "updated_at" | "revision"
>;
export type Candidate = Pick<
  Project,
  "id" | "name" | "original_prompt" | "applied_changes" | "html"
>;
export type GenerateInput = {
  requestId: string;
  projectId: string;
  prompt: string;
  revision: number;
};
export type GenerationResult = {
  requestId: string;
  saved: boolean;
  candidate?: Candidate;
  project?: Project;
  message?: string;
  code?: string;
};
