import { randomUUID } from "node:crypto";
import type { Db } from "./db/client.js";
import type { Logger } from "./log.js";
import type { ImageProvider, QaProvider } from "./openai/providers.js";
import type { Publisher } from "./publish/publisher.js";
import type { RepoSource } from "./repo/source.js";
import type { BlobStore } from "./storage/blobs.js";
import { ContentService } from "./content/chapters.js";
import { loadStudioConfig } from "./content/config.js";

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionTtlHours: number;
}

/** Everything the studio needs, injected so tests can swap real services for mocks. */
export interface StudioDeps {
  db: Db;
  blobs: BlobStore;
  repo: RepoSource;
  images: ImageProvider | null;
  qa: QaProvider | null;
  publisher: Publisher | null;
  clock: Clock;
  logger: Logger;
  auth: AuthConfig;
  cronSecret: string;
  /** Master switch for paid OpenAI requests (STUDIO_GENERATION_ENABLED). */
  generationEnabled: boolean;
  /** Asks the platform to run another worker step soon (fire and forget). */
  kick: (reason: string) => void;
  workerId: string;
  leaseMs: number;
  newId: () => string;
  /** Opaque identifier sent to OpenAI as safety_identifier. */
  safetyIdentifier: string;
  missingConfig: string[];
}

export function defaultIds() {
  return { newId: () => randomUUID(), workerId: `w-${randomUUID().slice(0, 8)}` };
}

const contentCache = new WeakMap<RepoSource, { at: number; value: Promise<ContentService> }>();

/** Content (config, prompts, scripts) is re-read from GitHub at most once a minute per instance. */
export function content(deps: Pick<StudioDeps, "repo" | "clock">, fresh = false): Promise<ContentService> {
  const now = deps.clock.now().getTime();
  const cached = contentCache.get(deps.repo);
  if (!fresh && cached && now - cached.at < 60_000) return cached.value;
  const value = loadStudioConfig(deps.repo).then((cfg) => new ContentService(deps.repo, cfg));
  value.catch(() => contentCache.delete(deps.repo));
  contentCache.set(deps.repo, { at: now, value });
  return value;
}
