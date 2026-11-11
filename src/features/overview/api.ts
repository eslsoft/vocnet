import { consoleStatsSchema } from '@shared/monitor'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export async function getConsoleStats() {
  return decodeApiResponse(await rpc.manage.v1.stats.$get(), consoleStatsSchema)
}
