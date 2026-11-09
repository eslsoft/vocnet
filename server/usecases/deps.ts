import type {
  AgentKeyCrypto,
  AgentRepo,
  AuthVerifier,
  Clock,
  FactRepo,
  FeedbackRepo,
  IdGenerator,
  JevReviewer,
  LlmReviewer,
  NodeRepo,
  RateLimiter,
  ReviewQueue,
} from './ports'

// The dependency bundle assembled in composition.ts. Use cases take a Pick of it.
export interface Deps {
  nodes: NodeRepo
  facts: FactRepo
  feedback: FeedbackRepo
  agents: AgentRepo
  jev: JevReviewer
  llm: LlmReviewer
  reviewQueue: ReviewQueue
  /** Caps public feedback per client address. */
  feedbackLimiter: RateLimiter
  authVerifier: AuthVerifier
  agentKeys: AgentKeyCrypto
  /** OIDC subjects allowed to act as admins. */
  adminSubjects: ReadonlySet<string>
  clock: Clock
  ids: IdGenerator
}
