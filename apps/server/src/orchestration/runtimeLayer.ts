import { Layer } from "effect";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { ManagedAttachmentRepositoryLive } from "../persistence/Layers/ManagedAttachments";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery";
import { TerminalLayerLive } from "../terminal/runtimeLayer";
import { ProjectWorkspaceStoreLive } from "../projectWorkspace/Layers/ProjectWorkspaceStore";

export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
  ManagedAttachmentRepositoryLive,
);

export const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(ManagedAttachmentRepositoryLive),
);

export const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

// WP4 (Decision 0002): the engine settles Project terminals pre-commit and
// deletes Project workspace state inside the deletion command's transaction,
// so it needs the shared terminal runtime and the workspace store. The same
// `TerminalLayerLive` reference used by the WS/`DevServerManager` compositions
// keeps the memoized `TerminalManager` shared across the whole server graph.
export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationInfrastructureLayerLive),
    Layer.provide(TerminalLayerLive),
    Layer.provide(ProjectWorkspaceStoreLive),
  ),
);
