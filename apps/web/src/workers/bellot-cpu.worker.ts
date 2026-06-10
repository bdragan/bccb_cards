import {
  type BellotAction,
  type BellotCpuOptions,
  type BellotState,
  chooseBellotCpuAction,
} from "@card-games/game-core";

export type BellotCpuWorkerRequest = {
  requestId: number;
  state: BellotState;
  cpuPlayerId: string;
  options: BellotCpuOptions;
};

export type BellotCpuWorkerResponse = {
  requestId: number;
  action?: BellotAction;
  error?: string;
};

type BellotCpuWorkerScope = {
  onmessage:
    | ((event: MessageEvent<BellotCpuWorkerRequest>) => void)
    | null;
  postMessage: (message: BellotCpuWorkerResponse) => void;
};

const worker = self as unknown as BellotCpuWorkerScope;

worker.onmessage = (event: MessageEvent<BellotCpuWorkerRequest>) => {
  const { requestId, state, cpuPlayerId, options } = event.data;

  try {
    const action = chooseBellotCpuAction(state, cpuPlayerId, options);

    worker.postMessage({
      requestId,
      action,
    } satisfies BellotCpuWorkerResponse);
  } catch (err) {
    worker.postMessage({
      requestId,
      error: err instanceof Error ? err.message : "CPU action failed",
    } satisfies BellotCpuWorkerResponse);
  }
};
