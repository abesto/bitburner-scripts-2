import { NS } from '@ns';

import { fields, match, TypeNames, variantModule, VariantOf } from 'variant';

import * as colors from '/colors';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PORTS } from '/ports';

import { ServerPort } from '../common/ServerPort';
import { db } from '../Database/client';
import { JobId } from '../Scheduler/types';
import { HwgwBatchVizRequest, JobKind, SERVICE_ID, toHwgwBatchVizRequest } from './types';

const JobState = variantModule({
  planned: fields<{
    jobId: JobId;
    kind: JobKind;
    plannedStart: number;
    plannedEnd: number;
  }>(),
  running: fields<{
    jobId: JobId;
    kind: JobKind;
    plannedStart: number;
    plannedEnd: number;
    start: number;
  }>(),
  finished: fields<{
    jobId: JobId;
    kind: JobKind;
    plannedStart: number;
    plannedEnd: number;
    start: number;
    end: number;
  }>(),
});
type JobState<T extends TypeNames<typeof JobState> = undefined> = VariantOf<
  typeof JobState,
  T
>;

export class HwgwBatchVizService {
  private readonly batches: Map<JobId, Map<JobKind, JobState>> = new Map();
  private readonly fmt: Fmt;
  private lastUpdate = 0;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly width = 140,
    private readonly showBatchCount = 15
  ) {
    this.fmt = new Fmt(ns);
  }

  async handleRequest(request: HwgwBatchVizRequest) {
    match(request, {
      plan: ({ jobId, plannedStart, plannedEnd, kind }) => {
        const job = JobState.planned({
          jobId,
          plannedStart,
          plannedEnd,
          kind,
        });
        if (!this.batches.has(jobId)) {
          this.batches.set(jobId, new Map());
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.batches.get(jobId)!.set(kind, job);
      },

      start: ({ jobId, timestamp, kind }) => {
        const batch = this.batches.get(jobId);
        if (batch === undefined) {
          //this.log.terror("Job not found", { jobId, kind, request: "start" });
          return;
        }
        const job = batch.get(kind);
        if (job === undefined) {
          //this.log.terror("Job not found", { jobId, kind, request: "start" });
          return;
        }
        match(job, {
          planned: ({ jobId, plannedStart, plannedEnd, kind }) => {
            batch.set(
              kind,
              JobState.running({
                jobId,
                plannedStart,
                plannedEnd,
                kind,
                start: timestamp,
              })
            );
          },
          running: () => {
            this.log.terror("Job already running", {
              jobId,
              request: "planned",
            });
          },
          finished: () => {
            this.log.error("Job already finished", {
              jobId,
              request: "planned",
            });
          },
        });
      },

      finished: ({ jobId, timestamp, kind }) => {
        const batch = this.batches.get(jobId);
        if (batch === undefined) {
          //this.log.terror("Job not found", { jobId, kind, request: "start" });
          return;
        }
        const job = batch.get(kind);
        if (job === undefined) {
          //this.log.terror("Job not found", { jobId, kind, request: "start" });
          return;
        }
        match(job, {
          planned: () => {
            /*
              this.log.error("Job  not running", {
                jobId,
                request: "finished",
              });
              */
          },
          running: ({ jobId, plannedStart, plannedEnd, kind, start }) => {
            batch.set(
              kind,
              JobState.finished({
                jobId,
                plannedStart,
                plannedEnd,
                kind,
                start,
                end: timestamp,
              })
            );
          },
          finished: () => {
            //this.log.error(`Job ${jobId} already finished`);
          },
        });
      },
    });
  }

  async listen(): Promise<void> {
    const port = new ServerPort(
      this.ns,
      this.log,
      PORTS[SERVICE_ID],
      toHwgwBatchVizRequest
    );

    this.log.info(`Listening on port ${port.portNumber}`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const memdb = await db(this.ns, this.log);
      const spacing = memdb.config.hwgw.spacing;
      const request = await port.read({
        timeout: spacing,
        throwOnTimeout: false,
      });
      if (request !== null) {
        await this.handleRequest(request);
      }

      /*
      this.log.tdebug("Batches", {
        batches: Array.from(this.batches.entries()).map(([jobId, jobs]) => ({
          jobId,
          jobs: Array.from(jobs.keys()),
        })),
      });
      */

      // UI!
      const now = Math.round(Date.now());
      if (now - this.lastUpdate <= spacing) {
        continue;
      }
      this.lastUpdate = now;

      const howCentered = (job: JobState) => {
        const center =
          (job.plannedEnd + job.plannedStart) *
          memdb.config.hwgw.batchViz.centerBias;
        return Math.abs(center - now);
      };

      const batches = Array.from(this.batches.values()).filter((batch) => {
        return batch.has("hack-weaken");
      });
      batches.sort((a, b) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const aCentered = howCentered(a.get("hack-weaken")!);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const bCentered = howCentered(b.get("hack-weaken")!);
        return aCentered - bCentered;
      });
      const shownBatches = batches.slice(0, this.showBatchCount);
      const emptyLines = ((this.showBatchCount - shownBatches.length) * 4) / 2;
      shownBatches.sort((a, b) => {
        return (
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          a.get("hack-weaken")!.plannedStart -
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          b.get("hack-weaken")!.plannedStart
        );
      });

      if (shownBatches.length === 0) {
        this.log.debug("No batches to show");
        continue;
      }
      const earliest = Array.from(shownBatches[0].values()).reduce(
        (min, job) => Math.min(min, job.plannedStart),
        Infinity
      );
      const latest = Array.from(shownBatches[shownBatches.length - 1].values())
        .map((job) => (job.type === "finished" ? job.end : job.plannedEnd))
        .reduce((max, end) => Math.max(max, end), -Infinity);
      //const duration = Math.min(latest - earliest, this.width * spacing);
      const duration = latest - earliest;
      const chartStart = now - duration / 2;
      const chartEnd = chartStart + duration;
      const chartStep = duration / this.width;

      for (const [jobId, batch] of this.batches) {
        let oldCount = 0;
        for (const [, job] of batch) {
          const end = job.type === "finished" ? job.end : job.plannedEnd;
          if (end < chartStart) {
            oldCount += 1;
          }
        }
        if (oldCount === 4) {
          this.batches.delete(jobId);
        }
      }

      this.ns.clearLog();
      for (let i = 0; i < emptyLines; i++) {
        this.ns.printf(" ");
      }

      const jobColors = {
        hack: colors.green,
        grow: colors.red,
        "hack-weaken": colors.cyan,
        "grow-weaken": colors.magenta,
      };

      const charPlanned = "░";
      const charRunning = "█";
      const charEarly = "▄";
      const charLate = "▀";

      for (const batch of shownBatches) {
        for (const kind of [
          "hack",
          "hack-weaken",
          "grow",
          "grow-weaken",
        ] as const) {
          const job = batch.get(kind);
          if (job === undefined) {
            this.ns.printf(" ");
            continue;
          }
          const jobColor = jobColors[job.kind];
          const chars: string[] = [];
          let time = chartStart;

          const to = (t: number, c: string) => {
            for (; time < t && time < chartEnd; time += chartStep) {
              chars.push(jobColor(c));
            }
          };

          to(job.plannedStart, " ");
          if (job.type === "planned") {
            to(job.plannedEnd, charPlanned);
          } else if (job.type === "running") {
            to(job.start, charPlanned);
            to(Math.min(now, job.plannedEnd), charRunning);
            to(now, charLate);
            to(job.plannedEnd, charPlanned);
          } else if (job.type === "finished") {
            to(job.start, charPlanned);
            to(Math.min(job.end, job.plannedEnd), charRunning);
            to(job.plannedEnd, charEarly);
            to(job.end, charLate);
          }

          this.ns.printf("%s", chars.slice(0, this.width).join(""));
        }
      }

      for (let i = 0; i < emptyLines; i++) {
        this.ns.printf(" ");
      }

      const startStr = this.fmt.timestamp(chartStart);
      const endStr = this.fmt.timestamp(chartEnd);

      this.ns.printf(
        "%s",
        startStr +
          " ".repeat(this.width - endStr.length - startStr.length) +
          endStr
      );
      this.ns.printf("%s", ".".repeat(this.width));
      this.log.info("Legend", {
        hack: jobColors.hack(charRunning),
        grow: jobColors.grow(charRunning),
        "hack-weaken": jobColors["hack-weaken"](charRunning),
        "grow-weaken": jobColors["grow-weaken"](charRunning),
        planned: charPlanned,
        running: charRunning,
        early: charEarly,
        late: charLate,
        ".": this.fmt.float(chartStep / 1000) + "s",
      });
    }
  }
}
