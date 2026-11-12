import type { CacheStorage as WorkersCacheStorage } from '@cloudflare/workers-types'
import { webCryptoAgentKeys } from '@server/adapters/agent-keys'
import { createAuthVerifier } from '@server/adapters/auth/verifier'
import { createEdgeCache } from '@server/adapters/edge-cache'
import { createRateLimiter } from '@server/adapters/rate-limiter'
import { createAgentRepo } from '@server/adapters/repos/agents'
import { createFactRepo } from '@server/adapters/repos/facts'
import { createMonitorRepo } from '@server/adapters/repos/monitor'
import { createNodeRepo } from '@server/adapters/repos/nodes'
import { createPublicViewRepo } from '@server/adapters/repos/public-view'
import { createReferenceRepo } from '@server/adapters/repos/reference'
import { createTicketRepo } from '@server/adapters/repos/tickets'
import { createTopicRepo } from '@server/adapters/repos/topics'
import { createWorkRepo } from '@server/adapters/repos/work'
import { createReviewQueue } from '@server/adapters/review-queue'
import { sharedConcurrencyLimit } from '@server/adapters/reviewers/concurrency'
import { createJevReviewer } from '@server/adapters/reviewers/jev'
import { createLlmReviewer } from '@server/adapters/reviewers/llm'
import { createLunaReviewer } from '@server/adapters/reviewers/luna'
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
  const jev = createJevReviewer({ ...review.gateway, model: review.jevModel })
  const jevLimit = sharedConcurrencyLimit('jev', review.concurrency.jev)
  const llm = createLlmReviewer({ ...review.gateway, model: review.llmModel })
  const llmLimit = sharedConcurrencyLimit('llm', review.concurrency.llm)
  return {
    nodes: createNodeRepo(db),
    facts: createFactRepo(db),
    topics: createTopicRepo(db),
    tickets: createTicketRepo(db),
    agents: createAgentRepo(db),
    work: createWorkRepo(db),
    monitor: createMonitorRepo(db),
    reference: createReferenceRepo(db),
    publicViews: createPublicViewRepo(db),
    decision: {
      jev: { ask: (questions, state) => jevLimit(() => jev.ask(questions, state)) },
      luna: createLunaReviewer(review.decisions),
    },
    llm: { judge: (prompt) => llmLimit(() => llm.judge(prompt)) },
    reviewQueue: createReviewQueue(env.REVIEW_QUEUE),
    feedbackLimiter: createRateLimiter(env.FEEDBACK_RATE_LIMITER),
    readLimiter: createRateLimiter(env.READ_RATE_LIMITER),
    // The DOM lib also declares `caches`; the Workers runtime's has the colo cache as `default`.
    responseCache: createEdgeCache((caches as unknown as WorkersCacheStorage).default),
    authVerifier: createAuthVerifier(getAuthConfig(env)),
    agentKeys: webCryptoAgentKeys,
    adminSubjects: getAdminSubjects(env),
    clock: systemClock,
    ids: uuidGenerator,
  }
}
