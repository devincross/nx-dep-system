import { Injectable, Logger } from '@nestjs/common';
import type { ReconciliationRun } from '@org/database';
import type { DataSourcePort, MapperPort } from '../domain/ports/data-source.port.js';
import type { OrderEntity } from '../domain/entities/index.js';
import { DepSyncAdapter } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { ReconciliationRepository } from '../infrastructure/repositories/reconciliation.repository.js';
import { extractAppleSerials, diffDeviceSets } from './dep-order-details.util.js';

const BATCH_SIZE = 100;

export interface ProcessRunDeps {
  run: ReconciliationRun;
  reconRepo: ReconciliationRepository;
  /** Configured with setDb and NO change repository — corrections stay silent
   * so they never trigger the downstream auto-push / OV path. */
  orderRepo: OrderRepository;
  zohoAdapter: DataSourcePort;
  mapper: MapperPort;
  depAdapter: DepSyncAdapter;
}

/**
 * Processes one reconciliation run to completion (or until it errors / is
 * canceled). Resumable: it always continues from the run's durable
 * cursorOrderId and upserts findings idempotently on (runId, orderId), so a
 * crash mid-run is recovered by simply calling this again.
 */
@Injectable()
export class ReconcileRunUseCase {
  private readonly logger = new Logger(ReconcileRunUseCase.name);

  async processRun(deps: ProcessRunDeps): Promise<void> {
    const { reconRepo, orderRepo, zohoAdapter, mapper, depAdapter } = deps;
    const run = deps.run;

    try {
      if (run.status === 'pending') {
        const total = await reconRepo.countAllOrders();
        await reconRepo.markRunning(run.id, total);
      }

      // Crawl Zoho once and index by external order id. Re-done on resume
      // (cheap relative to the whole run) so no large blob needs persisting.
      const zohoIndex = await this.buildZohoIndex(zohoAdapter, mapper);
      await reconRepo.setZohoIndexed(run.id);
      this.logger.log(`Reconcile run ${run.runId}: indexed ${zohoIndex.size} Zoho orders`);

      let cursor = run.cursorOrderId;
      for (;;) {
        // Respect an external cancel between batches.
        const fresh = await reconRepo.getRunByRunId(run.runId);
        if (!fresh || fresh.status === 'canceled') {
          this.logger.log(`Reconcile run ${run.runId}: stopped (status ${fresh?.status})`);
          return;
        }

        const batch = await reconRepo.nextOrderBatch(cursor, BATCH_SIZE);
        if (batch.length === 0) {
          await reconRepo.recomputeCounts(run.id, run.runId);
          await reconRepo.complete(run.id);
          this.logger.log(`Reconcile run ${run.runId}: complete`);
          return;
        }

        const orderNumbers = batch.map(
          (o) => o.depOrderId || o.externalOrderId || String(o.id),
        );

        // One Apple call per batch. A systemic error (auth/malformed) carries
        // errorCode — treat it as fatal and DON'T advance the cursor so the
        // next tick retries. Orders simply not found come back absent (not an
        // error).
        const { response } = await depAdapter.showOrderDetails(orderNumbers);
        if (response.errorCode) {
          throw new Error(
            `Apple show-order-details failed: ${response.errorCode} ${response.errorMessage ?? ''}`.trim(),
          );
        }
        const appleByOrder = extractAppleSerials(response);

        let batchErrors = 0;
        for (const order of batch) {
          try {
            await this.processOrder(order, run.runId, zohoIndex, appleByOrder, orderRepo, reconRepo);
          } catch (err) {
            batchErrors++;
            this.logger.error(
              `Reconcile run ${run.runId}: order ${order.id} failed: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

        cursor = batch[batch.length - 1].id;
        await reconRepo.advanceCursor(run.id, cursor);
        await reconRepo.incrementErrorOrders(run.id, batchErrors);
        await reconRepo.recomputeCounts(run.id, run.runId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Reconcile run ${run.runId} errored: ${msg}`);
      await reconRepo.fail(run.id, msg);
    }
  }

  private async processOrder(
    order: { id: number; externalOrderId: string | null; depOrderId: string | null; accountId: number },
    runId: string,
    zohoIndex: Map<string, OrderEntity>,
    appleByOrder: Map<string, string[]>,
    orderRepo: OrderRepository,
    reconRepo: ReconciliationRepository,
  ): Promise<void> {
    const orderNumber = order.depOrderId || order.externalOrderId || String(order.id);
    const zohoEntity = order.externalOrderId ? zohoIndex.get(order.externalOrderId) : undefined;

    const before = await reconRepo.getOrderSerials(order.id);

    let ourDevices = before;
    let zohoAdded: string[] = [];
    let zohoRemoved: string[] = [];
    let correctionApplied = false;

    if (zohoEntity) {
      // Auto-correct our DB to match Zoho. orderRepo has NO change repository,
      // so this does not emit order_changes / trigger the downstream push.
      await orderRepo.upsert(zohoEntity, order.accountId);
      const after = await reconRepo.getOrderSerials(order.id);
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      zohoAdded = after.filter((s) => !beforeSet.has(s));
      zohoRemoved = before.filter((s) => !afterSet.has(s));
      correctionApplied = zohoAdded.length > 0 || zohoRemoved.length > 0;
      ourDevices = after;
    }

    const zohoDevices = zohoEntity ? zohoEntity.items.map((i) => i.serialNumber) : null;
    const appleDevices = appleByOrder.has(orderNumber) ? appleByOrder.get(orderNumber)! : null;

    const diff = diffDeviceSets({ our: ourDevices, zoho: zohoDevices, apple: appleDevices });

    await reconRepo.upsertFinding({
      runId,
      orderId: order.id,
      orderNumber,
      externalOrderId: order.externalOrderId,
      ourDevices: diff.our,
      zohoDevices: diff.zoho,
      appleDevices: diff.apple,
      zohoMatch: diff.zohoMatch,
      appleMatch: diff.appleMatch,
      zohoAdded,
      zohoRemoved,
      zohoCorrectionApplied: correctionApplied,
      missingFromApple: diff.missingFromApple,
      extraInApple: diff.extraInApple,
      recommendedAction: diff.recommendedAction,
      severity: diff.severity,
    });
  }

  private async buildZohoIndex(
    zohoAdapter: DataSourcePort,
    mapper: MapperPort,
  ): Promise<Map<string, OrderEntity>> {
    const index = new Map<string, OrderEntity>();
    const result = await zohoAdapter.fetchOrders();
    for (const raw of result.data) {
      // Skip return/cancellation records that some mappers divert from the
      // order flow — they are not orders to index.
      if (mapper.mapReturn?.(raw)) continue;
      const entity = mapper.mapOrder(raw);
      if (entity.externalOrderId) index.set(entity.externalOrderId, entity);
    }
    return index;
  }
}
