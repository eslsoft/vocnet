import type {
  AgentKeyCrypto,
  AgentRepo,
  AuthVerifier,
  Clock,
  DecisionReviewers,
  FactRepo,
  IdGenerator,
  LlmReviewer,
  MediaStore,
  MonitorRepo,
  NodeRepo,
  PublicViewRepo,
  RateLimiter,
  ReferenceRepo,
  ResponseCache,
  ReviewQueue,
  ServiceRepo,
  TicketRepo,
  TopicRepo,
  WorkRepo,
} from './ports'

// The dependency bundle assembled in composition.ts. Use cases take a Pick of it.
export interface Deps {
  nodes: NodeRepo
  facts: FactRepo
  topics: TopicRepo
  tickets: TicketRepo
  agents: AgentRepo
  services: ServiceRepo
  work: WorkRepo
  monitor: MonitorRepo
  reference: ReferenceRepo
  publicViews: PublicViewRepo
  /** Pictures and other media files, by the SHA-256 of their bytes. */
  media: MediaStore
  /** The decision models: Jev and OpenAI's Decisions API (luna). */
  decision: DecisionReviewers
  llm: LlmReviewer
  reviewQueue: ReviewQueue
  /** Caps public feedback per client address. */
  feedbackLimiter: RateLimiter
  /** Caps public reads per client address. */
  readLimiter: RateLimiter
  /** Caps the public reads of each service that reads with its key. */
  serviceReadLimiter: RateLimiter
  /** The edge cache public lists are kept in for their max-age. */
  responseCache: ResponseCache
  authVerifier: AuthVerifier
  agentKeys: AgentKeyCrypto
  /** OIDC subjects allowed to act as admins. */
  adminSubjects: ReadonlySet<string>
  clock: Clock
  ids: IdGenerator
}
