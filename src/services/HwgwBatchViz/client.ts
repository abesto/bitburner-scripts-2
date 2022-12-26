import { PORTS } from '/ports';

import { BaseNoResponseClient } from '../common/BaseNoResponseClient';
import { HwgwBatchVizRequest, JobKind, SERVICE_ID } from './types';

export class HwgwBatchVizClient extends BaseNoResponseClient<HwgwBatchVizRequest> {
  protected requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  plan(params: {
    jobId: string;
    kind: JobKind;
    plannedStart: number;
    plannedEnd: number;
  }): Promise<void> {
    return this.send(HwgwBatchVizRequest.plan(params), {
      backoff: false,
    });
  }

  start(params: { jobId: string; kind: JobKind }): Promise<void> {
    return this.send(
      HwgwBatchVizRequest.start({ ...params, timestamp: Date.now() }),
      { backoff: false }
    );
  }

  finished(params: { jobId: string; kind: JobKind }): Promise<void> {
    return this.send(
      HwgwBatchVizRequest.finished({ ...params, timestamp: Date.now() }),
      {
        backoff: false,
      }
    );
  }
}
