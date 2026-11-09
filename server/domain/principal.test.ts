import type { AgentId } from '@shared/agents'
import { describe, expect, it } from 'vitest'
import { isAgentKey, mayActOn, principalRef } from './principal'
import { normalizeTerm, textKey } from './term'

const agent = { kind: 'agent' as const, agentId: 'a1' as AgentId, name: 'bot' }

describe('principals', () => {
  it('records admins and agents as distinct refs', () => {
    expect(principalRef({ kind: 'admin', sub: 's1' })).toBe('admin:s1')
    expect(principalRef(agent)).toBe('agent:a1')
  })

  it('lets admins act on anything and agents only on their own work', () => {
    expect(mayActOn({ kind: 'admin', sub: 's1' }, 'agent:other')).toBe(true)
    expect(mayActOn(agent, 'agent:a1')).toBe(true)
    expect(mayActOn(agent, 'agent:other')).toBe(false)
  })

  it('recognizes agent keys by prefix', () => {
    expect(isAgentKey('vn_agent_abc')).toBe(true)
    expect(isAgentKey('eyJhbGciOi')).toBe(false)
  })
})

describe('terms', () => {
  it('normalizes spelling but keeps case, and folds case only for dedupe keys', () => {
    expect(normalizeTerm('  ice   cream ')).toBe('ice cream')
    expect(normalizeTerm('English')).toBe('English')
    expect(normalizeTerm('café')).toBe('café')
    expect(textKey(' Ice  Cream ')).toBe('ice cream')
  })
})
