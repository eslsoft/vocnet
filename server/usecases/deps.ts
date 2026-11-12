import type {
  AgentKeyCrypto,
  AgentRepo,
  AuthVerifier,
  Clock,
  DecisionReviewers,
  FactRepo,
  IdGenerator,
  LlmReviewer,
  MonitorRepo,
  NodeRepo,
  PublicViewRepo,
  RateLimiter,
  ReferenceRepo,
  ResponseCache,
  ReviewQueue,
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
  work: WorkRepo
  monitor: MonitorRepo
  reference: ReferenceRepo
  publicViews: PublicViewRepo
  /** The decision models: Jev and OpenAI's Decisions API (luna). */
  decision: DecisionReviewers
  llm: LlmReviewer
  reviewQueue: ReviewQueue
  /** Caps public feedback per client address. */
  feedbackLimiter: RateLimiter
  /** Caps public reads per client address. */
  readLimiter: RateLimiter
  /** The edge cache public lists are kept in for their max-age. */
  responseCache: ResponseCache
  authVerifier: AuthVerifier
  agentKeys: AgentKeyCrypto
  /** OIDC subjects allowed to act as admins. */
  adminSubjects: ReadonlySet<string>
  clock: Clock
  ids: IdGenerator
}
