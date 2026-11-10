import { webCryptoAgentKeys } from '@server/adapters/agent-keys'
import { createAuthVerifier } from '@server/adapters/auth/verifier'
import { createRateLimiter } from '@server/adapters/rate-limiter'
import { createAgentRepo } from '@server/adapters/repos/agents'
import { createFactRepo } from '@server/adapters/repos/facts'
import { createFeedbackRepo } from '@server/adapters/repos/feedback'
import { createNodeRepo } from '@server/adapters/repos/nodes'
import { createPublicViewRepo } from '@server/adapters/repos/public-view'
import { createReferenceRepo } from '@server/adapters/repos/reference'
import { createTopicRepo } from '@server/adapters/repos/topics'
import { createWorkRepo } from '@server/adapters/repos/work'
import { createReviewQueue } from '@server/adapters/review-queue'
import { createJevReviewer } from '@server/adapters/reviewers/jev'
import { createLlmReviewer } from '@server/adapters/reviewers/llm'
import { systemClock, uuidGenerator } from '@server/adapters/system'
import { getAdminSubjects, getAuthConfig, getReviewConfig } from '@server/config'
import { createDb } from '@server/db/client'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'

// The only place adapters are constructed. Request-free, so the fetch, queue, and
// scheduled entries share it; a cheap plain object.
export function createDeps(env: Env): Deps {
  const db = createDb(env)
  const review = getReviewConfig(env)
  return {
    nodes: createNodeRepo(db),
    facts: createFactRepo(db),
    topics: createTopicRepo(db),
    feedback: createFeedbackRepo(db),
    agents: createAgentRepo(db),
    work: createWorkRepo(db),
    reference: createReferenceRepo(db),
    publicViews: createPublicViewRepo(db),
    jev: createJevReviewer({ ...review.gateway, model: review.jevModel }),
    llm: createLlmReviewer({ ...review.gateway, model: review.llmModel }),
    reviewQueue: createReviewQueue(env.REVIEW_QUEUE),
    feedbackLimiter: createRateLimiter(env.FEEDBACK_RATE_LIMITER),
    authVerifier: createAuthVerifier(getAuthConfig(env)),
    agentKeys: webCryptoAgentKeys,
    adminSubjects: getAdminSubjects(env),
    clock: systemClock,
    ids: uuidGenerator,
  }
}
