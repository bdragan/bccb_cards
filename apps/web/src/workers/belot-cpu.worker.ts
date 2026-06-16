import {
  type BelotAction,
  type BelotCpuOptions,
  type BelotState,
  chooseBelotCpuAction,
} from "@card-games/game-core";

export type BelotCpuWorkerRequest = {
  requestId: number;
  state: BelotState;
  cpuPlayerId: string;
  options: BelotCpuOptions;
};

export type BelotCpuWorkerResponse = {
  requestId: number;
  action?: BelotAction;
  error?: string;
};

type BelotCpuWorkerScope = {
  onmessage:
    | ((event: MessageEvent<BelotCpuWorkerRequest>) => void)
    | null;
  postMessage: (message: BelotCpuWorkerResponse) => void;
};

const worker = self as unknown as BelotCpuWorkerScope;

worker.onmessage = (event: MessageEvent<BelotCpuWorkerRequest>) => {
  const { requestId, state, cpuPlayerId, options } = event.data;

  try {
    const action = chooseBelotCpuAction(state, cpuPlayerId, options);

    worker.postMessage({
      requestId,
      action,
    } satisfies BelotCpuWorkerResponse);
  } catch (err) {
    worker.postMessage({
      requestId,
      error: err instanceof Error ? err.message : "CPU action failed",
    } satisfies BelotCpuWorkerResponse);
  }
};
